const crypto = require('crypto')
const fs = require('fs-extra')
const path = require('path')
const got = require('got')

const UI_BASE = 'https://albuquerquelm.github.io/minecraftmods/launcher-ui/'
const DEFAULT_THEME = {
    background: 'assets/images/backgrounds/Capa Youtube.png',
    logo: 'assets/images/Perfil Youtube.png'
}

function userDataDir(){
    const electron = require('electron')
    if(electron.app && typeof electron.app.getPath === 'function'){
        try {
            return electron.app.getPath('userData')
        } catch(err) {
            // The renderer process has no app path until remote is used.
        }
    }
    return require('@electron/remote').app.getPath('userData')
}

function remoteUiDir(){
    return path.join(userDataDir(), 'remote-ui')
}

function md5File(file){
    return new Promise(resolve => {
        if(!fs.existsSync(file)){
            resolve('')
            return
        }
        const hash = crypto.createHash('md5')
        fs.createReadStream(file)
            .on('data', chunk => hash.update(chunk))
            .on('error', () => resolve(''))
            .on('end', () => resolve(hash.digest('hex')))
    })
}

function encodeRelative(relative){
    return relative.split('/').map(encodeURIComponent).join('/')
}

async function downloadFile(url, dest){
    const tmp = dest + '.download'
    await fs.ensureDir(path.dirname(dest))
    const response = await got.get(url, {
        responseType: 'buffer',
        timeout: 20000,
        headers: { 'cache-control': 'no-cache' }
    })
    await fs.writeFile(tmp, response.body)
    await fs.move(tmp, dest, { overwrite: true })
}

async function syncLauncherUi(){
    const root = remoteUiDir()
    try {
        const response = await got.get(UI_BASE + 'manifest.json?v=' + Date.now(), {
            responseType: 'json',
            timeout: 8000,
            headers: { 'cache-control': 'no-cache' }
        })
        const manifest = response.body
        for(const file of manifest.files || []){
            const relative = String(file.path || '').replace(/\\/g, '/')
            if(relative === '' || relative.includes('..')){
                continue
            }
            const dest = path.join(root, relative)
            if(await md5File(dest) === file.md5){
                continue
            }
            const url = UI_BASE + encodeRelative(relative) + '?v=' + file.md5
            await downloadFile(url, dest)
            if(file.md5 && await md5File(dest) !== file.md5){
                await fs.remove(dest)
            }
        }
    } catch(err) {
        console.warn('Could not refresh the launcher interface.', err && err.message ? err.message : err)
    }
    return root
}

function publicAsset(relative){
    const normalized = String(relative || '').replace(/\\/g, '/')
    const file = path.join(remoteUiDir(), normalized)
    if(normalized !== '' && fs.existsSync(file)){
        return 'sidemine://app/' + encodeRelative(normalized)
    }
    return normalized
}

function readTheme(){
    const themeFile = path.join(remoteUiDir(), 'theme.json')
    if(!fs.existsSync(themeFile)){
        return DEFAULT_THEME
    }
    try {
        return Object.assign({}, DEFAULT_THEME, fs.readJsonSync(themeFile))
    } catch(err) {
        return DEFAULT_THEME
    }
}

function applyRemoteUi(){
    if(typeof document === 'undefined'){
        return
    }
    const theme = readTheme()
    const css = path.join(remoteUiDir(), 'assets', 'css', 'launcher.css')
    if(fs.existsSync(css)){
        const link = document.querySelector('link[href*="launcher.css"]')
        if(link){
            link.href = 'sidemine://app/assets/css/launcher.css'
        }
    }
    const background = publicAsset(theme.background)
    if(background.startsWith('sidemine://')){
        document.body.style.backgroundImage = `url('${background}')`
        document.body.style.backgroundPosition = 'center center'
        document.body.style.backgroundRepeat = 'no-repeat'
        document.body.style.backgroundSize = 'cover'
    }
    const logo = publicAsset(theme.logo)
    if(logo.startsWith('sidemine://')){
        for(const img of document.querySelectorAll('img')){
            const src = img.getAttribute('src') || ''
            if(src.includes('Perfil')){
                img.src = logo
            }
        }
    }
}

function registerRemoteProtocol(){
    const { protocol, net } = require('electron')
    protocol.handle('sidemine', (request) => {
        const root = path.resolve(remoteUiDir())
        let relative = decodeURIComponent(new URL(request.url).pathname)
        if(relative.startsWith('/')){
            relative = relative.slice(1)
        }
        const file = path.resolve(root, relative)
        const prefix = root.endsWith(path.sep) ? root : root + path.sep
        if(file !== root && !file.startsWith(prefix)){
            return new Response(null, { status: 403 })
        }
        return net.fetch(require('url').pathToFileURL(file).href)
    })
}

module.exports = {
    syncLauncherUi,
    applyRemoteUi,
    publicAsset,
    registerRemoteProtocol,
    remoteUiDir
}
