const {ipcRenderer}  = require('electron')
const fs             = require('fs-extra')
const os             = require('os')
const path           = require('path')

const ConfigManager  = require('./configmanager')
const { DistroAPI }  = require('./distromanager')
const LangLoader     = require('./langloader')
const { LoggerUtil } = require('helios-core')
// eslint-disable-next-line no-unused-vars
const { HeliosDistribution } = require('helios-core/common')

const logger = LoggerUtil.getLogger('Preloader')

logger.info('Loading..')

// Load ConfigManager
ConfigManager.load()

// Yuck!
// TODO Fix this
DistroAPI['commonDir'] = ConfigManager.getCommonDirectory()
DistroAPI['instanceDir'] = ConfigManager.getInstanceDirectory()

// Load Strings
LangLoader.setupLanguage()

/**
 * 
 * @param {HeliosDistribution} data 
 */
function onDistroLoad(data){
    if(data != null){
        
        // Resolve the selected server if its value has yet to be set.
        if(ConfigManager.getSelectedServer() == null || data.getServerById(ConfigManager.getSelectedServer()) == null){
            logger.info('Determining default selected server..')
            ConfigManager.setSelectedServer(data.getMainServer().rawServer.id)
            ConfigManager.save()
        }
    }
    ipcRenderer.send('distributionIndexDone', data != null)
}

// Seed a local index so the UI can open before GitHub Pages is published.
// A successful remote download still replaces this file.
const bundledDistro = path.join(__dirname, '..', 'distribution.json')
const localDistro = path.join(ConfigManager.getLauncherDirectory(), 'distribution.json')
try {
    if(!fs.existsSync(localDistro) && fs.existsSync(bundledDistro)){
        fs.ensureDirSync(path.dirname(localDistro))
        fs.copySync(bundledDistro, localDistro)
        logger.info('Installed bundled Side-Mine distribution index.')
    }
    if(fs.existsSync(localDistro)){
        const distro = fs.readJsonSync(localDistro)
        let changed = false
        for(const server of distro.servers || []){
            if(server.id === 'side-mine-server' && server.address === 'side-mine.com'){
                server.name = 'Sidequest Server'
                server.address = 'stamina-marriages.tun.ply.gg'
                changed = true
            }
        }
        if(changed){
            fs.writeJsonSync(localDistro, distro, { spaces: 4 })
            logger.info('Updated Sidequest server address in the local distribution index.')
        }
    }
} catch(err) {
    logger.warn('Could not install bundled distribution index.', err)
}

// Ensure Distribution is downloaded and cached.
DistroAPI.getDistribution()
    .then(heliosDistro => {
        logger.info('Loaded distribution index.')

        onDistroLoad(heliosDistro)
    })
    .catch(err => {
        logger.info('Failed to load an older version of the distribution index.')
        logger.info('Application cannot run.')
        logger.error(err)

        onDistroLoad(null)
    })

// Clean up temp dir incase previous launches ended unexpectedly. 
fs.remove(path.join(os.tmpdir(), ConfigManager.getTempNativeFolder()), (err) => {
    if(err){
        logger.warn('Error while cleaning natives directory', err)
    } else {
        logger.info('Cleaned natives directory.')
    }
})