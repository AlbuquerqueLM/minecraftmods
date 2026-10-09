const fs = require('fs-extra')
const path = require('path')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('ClientStandard')

function standardRoot(){
    const packaged = path.join(process.resourcesPath || '', 'client-standard')
    if(fs.existsSync(path.join(packaged, 'mods'))){
        return packaged
    }
    return path.join(__dirname, '..', '..', '..', 'Padrão Client-Side')
}

function listRelativeFiles(dir){
    const files = []
    if(!fs.existsSync(dir)){
        return files
    }
    const walk = (current, relative) => {
        for(const entry of fs.readdirSync(current, { withFileTypes: true })){
            const rel = relative ? path.join(relative, entry.name) : entry.name
            const full = path.join(current, entry.name)
            if(entry.isDirectory()){
                walk(full, rel)
            } else if(entry.isFile()){
                files.push(rel)
            }
        }
    }
    walk(dir, '')
    return files
}

function copyPreservingTime(src, dest){
    fs.ensureDirSync(path.dirname(dest))
    fs.copySync(src, dest, { overwrite: true, preserveTimestamps: true })
}

function seedFile(src, dest){
    if(fs.existsSync(dest)){
        return false
    }
    copyPreservingTime(src, dest)
    return true
}

function mirrorDirectory(srcDir, destDir){
    let copied = 0
    for(const rel of listRelativeFiles(srcDir)){
        if(seedFile(path.join(srcDir, rel), path.join(destDir, rel))){
            copied++
        }
    }
    return copied
}

function syncMods(srcMods, destMods){
    fs.ensureDirSync(destMods)
    const jars = fs.readdirSync(srcMods).filter(name => name.toLowerCase().endsWith('.jar'))
    let copied = 0
    for(const name of jars){
        if(seedFile(path.join(srcMods, name), path.join(destMods, name))){
            copied++
        }
    }
    for(const name of fs.readdirSync(destMods)){
        const full = path.join(destMods, name)
        if(!fs.statSync(full).isFile()){
            continue
        }
        if(name.toLowerCase().endsWith('.jar.disabled')){
            fs.removeSync(full)
        }
    }
    return copied
}

function applyKeybinds(standardOptions, destOptions){
    const standardText = fs.readFileSync(standardOptions, 'utf8')
    const keys = new Map()
    for(const line of standardText.split(/\r?\n/)){
        if(!line.startsWith('key_')){
            continue
        }
        const separator = line.indexOf(':')
        if(separator > 0){
            keys.set(line.slice(0, separator), line)
        }
    }
    if(!fs.existsSync(destOptions)){
        fs.ensureDirSync(path.dirname(destOptions))
        fs.copySync(standardOptions, destOptions, { preserveTimestamps: true })
        return keys.size
    }
    const raw = fs.readFileSync(destOptions, 'utf8')
    const newline = raw.includes('\r\n') ? '\r\n' : '\n'
    const seen = new Set()
    const out = raw.split(/\r?\n/).map(line => {
        if(!line.startsWith('key_')){
            return line
        }
        const separator = line.indexOf(':')
        if(separator < 0){
            return line
        }
        const id = line.slice(0, separator)
        seen.add(id)
        return keys.has(id) ? keys.get(id) : line
    })
    for(const [id, line] of keys){
        if(!seen.has(id)){
            out.push(line)
        }
    }
    while(out.length > 0 && out[out.length - 1] === ''){
        out.pop()
    }
    fs.writeFileSync(destOptions, out.join(newline) + newline)
    return keys.size
}

function syncNow(gameDir){
    const root = standardRoot()
    if(!fs.existsSync(path.join(root, 'mods'))){
        logger.warn('Pasta padrão do cliente não encontrada: ' + root)
        return
    }
    fs.ensureDirSync(gameDir)
    const modsCopied = syncMods(path.join(root, 'mods'), path.join(gameDir, 'mods'))
    const configCopied = mirrorDirectory(path.join(root, 'config'), path.join(gameDir, 'config'))
    let dataCopied = 0
    const dataDir = path.join(root, 'data')
    if(fs.existsSync(dataDir)){
        dataCopied = mirrorDirectory(dataDir, path.join(gameDir, 'data'))
    }
    const options = path.join(root, 'options.txt')
    let keybinds = 0
    if(fs.existsSync(options)){
        keybinds = applyKeybinds(options, path.join(gameDir, 'options.txt'))
    }
    logger.info(`Padrão do cliente aplicado. mods=${modsCopied} config=${configCopied} data=${dataCopied} teclas=${keybinds}`)
}

let chain = Promise.resolve()

function syncClientStandard(gameDir){
    const job = chain.then(() => syncNow(gameDir))
    chain = job.catch(err => {
        logger.error('Falha ao alinhar o padrão do cliente.', err)
    })
    return job
}

module.exports = {
    syncClientStandard,
    standardRoot
}
