const crypto = require('crypto')
const fs = require('fs')
const path = require('path')

const root = __dirname
const launcherAssets = path.join(root, '..', 'HeliosLauncher', 'app', 'assets')
const uiRoot = path.join(root, 'launcher-ui')
const base = 'https://albuquerquelm.github.io/minecraftmods'
const maxBytes = 95 * 1024 * 1024

function walk(dir, prefix){
    const files = []
    if(!fs.existsSync(dir)){
        return files
    }
    for(const entry of fs.readdirSync(dir, { withFileTypes: true })){
        const rel = prefix ? prefix + '/' + entry.name : entry.name
        const full = path.join(dir, entry.name)
        if(entry.isDirectory()){
            files.push(...walk(full, rel))
        } else if(entry.isFile()){
            files.push({ rel: rel.replace(/\\/g, '/'), full })
        }
    }
    return files
}

function md5(file){
    const hash = crypto.createHash('md5')
    hash.update(fs.readFileSync(file))
    return hash.digest('hex')
}

function copyTree(src, dest){
    fs.mkdirSync(dest, { recursive: true })
    for(const entry of fs.readdirSync(src, { withFileTypes: true })){
        const from = path.join(src, entry.name)
        const to = path.join(dest, entry.name)
        if(entry.isDirectory()){
            copyTree(from, to)
        } else if(entry.isFile()){
            fs.copyFileSync(from, to)
        }
    }
}

if(fs.existsSync(launcherAssets)){
    copyTree(path.join(launcherAssets, 'images'), path.join(uiRoot, 'assets', 'images'))
    fs.mkdirSync(path.join(uiRoot, 'assets', 'css'), { recursive: true })
    fs.copyFileSync(path.join(launcherAssets, 'css', 'launcher.css'), path.join(uiRoot, 'assets', 'css', 'launcher.css'))
    fs.mkdirSync(path.join(uiRoot, 'assets', 'lang'), { recursive: true })
    fs.copyFileSync(path.join(launcherAssets, 'lang', '_custom.toml'), path.join(uiRoot, 'assets', 'lang', '_custom.toml'))
}

const themePath = path.join(uiRoot, 'theme.json')
if(!fs.existsSync(themePath)){
    fs.writeFileSync(themePath, JSON.stringify({
        background: 'assets/images/backgrounds/Capa Youtube.png',
        logo: 'assets/images/Perfil Youtube.png'
    }, null, 2))
}

const uiFiles = walk(uiRoot, '').filter(file => file.rel !== 'manifest.json')
const uiManifest = {
    files: uiFiles.map(file => ({
        path: file.rel,
        size: fs.statSync(file.full).size,
        md5: md5(file.full)
    }))
}
fs.writeFileSync(path.join(uiRoot, 'manifest.json'), JSON.stringify(uiManifest, null, 2))

const contentRoots = ['mods', 'config', 'data']
const skipped = []
const modules = []
for(const folder of contentRoots){
    for(const file of walk(path.join(root, folder), folder)){
        const size = fs.statSync(file.full).size
        if(size > maxBytes){
            skipped.push(file.rel + ' (' + Math.round(size / 1024 / 1024) + ' MB)')
            continue
        }
        const hash = md5(file.full)
        const encoded = file.rel.split('/').map(encodeURIComponent).join('/')
        modules.push({
            id: file.rel,
            name: path.posix.basename(file.rel),
            type: 'File',
            artifact: {
                size,
                MD5: hash,
                path: file.rel,
                url: base + '/' + encoded + '?v=' + hash
            }
        })
    }
}

const distro = {
    version: '1.0.0',
    servers: [{
        id: 'side-mine-server',
        name: 'Sidequest Server',
        description: 'Servidor oficial do Sidequest RPG. Quests toda semana.',
        icon: 'assets/images/Perfil%20Youtube.png',
        version: '1.0.0',
        address: 'stamina-marriages.tun.ply.gg',
        minecraftVersion: '26.2',
        javaOptions: { supported: '>=25.x', suggestedMajor: 25 },
        mainServer: true,
        autoconnect: true,
        modules
    }]
}
fs.writeFileSync(path.join(root, 'distribution.json'), JSON.stringify(distro, null, 2))
fs.writeFileSync(path.join(root, '.nojekyll'), '')
console.log('UI files:', uiManifest.files.length)
console.log('Modules:', modules.length)
if(skipped.length){
    console.log('Skipped over 95 MB:')
    for(const item of skipped){
        console.log(' - ' + item)
    }
}
