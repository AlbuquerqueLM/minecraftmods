const fs = require('fs-extra')
const http = require('http')
const https = require('https')
const path = require('path')
const ConfigManager = require('./configmanager')

function fetchBuffer(url, redirects = 0){
    return new Promise((resolve, reject) => {
        if(redirects > 5){
            reject(new Error('Muitos redirecionamentos ao baixar a skin.'))
            return
        }
        const getter = url.startsWith('http://') ? http.get : https.get
        const req = getter(url, { headers: { 'User-Agent': 'Side-Mine' } }, (res) => {
            if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
                res.resume()
                fetchBuffer(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject)
                return
            }
            if(res.statusCode !== 200){
                res.resume()
                reject(new Error('HTTP ' + res.statusCode + ' ao baixar a skin.'))
                return
            }
            const chunks = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.setTimeout(30000, () => req.destroy(new Error('Tempo esgotado ao baixar a skin.')))
        req.on('error', reject)
    })
}

function skinFromUrl(href){
    let url
    try {
        url = new URL(href)
    } catch {
        return null
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if((parts[0] === 'skins' || parts[0] === 'skin') && parts[1] && parts[1] !== 'upload'){
        return { name: decodeURIComponent(parts[1]), href: url.toString(), variant: 'classic' }
    }
    return null
}

function pngUrlFor(selection){
    if(selection.png && /^https:\/\/([a-z0-9.-]+\.)?ely\.by\//i.test(selection.png)){
        return selection.png
    }
    return 'https://skinsystem.ely.by/skins/' + encodeURIComponent(selection.name) + '.png'
}

async function writeGameSkin(gameDir, account){
    const skin = account && account.skin
    if(!skin || !skin.file || !fs.existsSync(skin.file)){
        return false
    }
    const configDir = path.join(gameDir, 'config', 'skinrestorer')
    const skinsDir = path.join(configDir, 'skins')
    const savedDir = path.join(configDir, 'saved_skins')
    await fs.ensureDir(skinsDir)
    await fs.ensureDir(savedDir)
    const nickFile = path.join(skinsDir, account.displayName + '.png')
    await fs.copy(skin.file, nickFile, { overwrite: true })

    const configPath = path.join(configDir, 'config.json')
    const config = fs.existsSync(configPath) ? await fs.readJson(configPath) : {}
    config.storage = Object.assign({}, config.storage, { location: 'global' })
    config.join = Object.assign({ refreshSkin: true, applyDelay: 0 }, config.join)
    config.join.autoFetch = Object.assign({ enabled: true, overrideExisting: false, providers: ['mojang'] }, config.join.autoFetch, {
        overrideExisting: false
    })
    config.providers = config.providers || {}
    config.providers.ely_by = Object.assign({ enabled: true, name: 'ely.by', cache: { enabled: true, duration: 60 } }, config.providers.ely_by, {
        enabled: true
    })
    config.providers.collection = Object.assign({
        enabled: true,
        name: 'collection',
        cache: { enabled: true, duration: 604800 }
    }, config.providers.collection, {
        enabled: true,
        sources: [{ path: 'skins', variant: skin.variant === 'slim' ? 'slim' : 'classic' }]
    })
    await fs.writeJson(configPath, config, { spaces: 2 })
    await fs.writeJson(path.join(savedDir, account.uuid + '.json'), {
        provider: 'ely.by',
        argument: skin.name,
        variant: skin.variant === 'slim' ? 'slim' : 'classic'
    }, { spaces: 2 })
    return true
}

async function applyCatalogSkin(selection, gameDir){
    const account = ConfigManager.getSelectedAccount()
    if(account == null || account.type !== 'offline'){
        throw new Error('Indique o seu nick no rodapé antes de escolher uma skin.')
    }
    if(!selection || !selection.name){
        throw new Error('Essa página do Ely.by não tem uma skin identificável.')
    }
    const url = pngUrlFor(selection)
    const payload = await fetchBuffer(url)
    if(payload.length < 8 || payload[0] !== 0x89 || payload.toString('ascii', 1, 4) !== 'PNG'){
        throw new Error('O Ely.by não devolveu um PNG para ' + selection.name + '.')
    }
    const dest = path.join(ConfigManager.getLauncherDirectory(), 'skins', account.uuid + '.png')
    await fs.ensureDir(path.dirname(dest))
    await fs.writeFile(dest, payload)
    account.skin = {
        provider: 'ely.by',
        name: selection.name,
        url,
        file: dest,
        variant: selection.variant === 'slim' ? 'slim' : 'classic'
    }
    ConfigManager.save()
    if(gameDir){
        await writeGameSkin(gameDir, account)
    }
    return account.skin
}

async function installAccountSkin(gameDir, account){
    const selected = account || ConfigManager.getSelectedAccount()
    if(!selected || !selected.skin){
        return false
    }
    return writeGameSkin(gameDir, selected)
}

module.exports = {
    skinFromUrl,
    applyCatalogSkin,
    installAccountSkin
}
