const crypto = require('crypto')
const fs = require('fs-extra')
const http = require('http')
const https = require('https')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { LoggerUtil } = require('helios-core')

const logger = LoggerUtil.getLogger('NeoForgeLaunch')

const NEOFORGE_VERSION = '26.2.0.88'
const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases/'
const CENTRAL = 'https://repo1.maven.org/maven2/'
const FABRIC_MAVEN = 'https://maven.fabricmc.net/'

function versionJsonPath(){
    const candidates = [
        path.join(__dirname, '..', 'neoforge', 'NeoForge 26.2.json'),
        path.join(process.resourcesPath || '', 'client-standard', 'NeoForge 26.2.json'),
        path.join(__dirname, '..', '..', '..', 'Padrão Client-Side', 'NeoForge 26.2.json')
    ]
    for(const candidate of candidates){
        if(candidate && fs.existsSync(candidate)){
            return candidate
        }
    }
    throw new Error('Não encontrei o NeoForge 26.2.json.')
}

function mavenPath(artifactPath){
    return String(artifactPath || '').replace(/\\/g, '/').replace(/^libraries\//, '')
}

function officialUrl(artifactPath, currentUrl){
    const rel = mavenPath(artifactPath)
    let host = ''
    try {
        host = new URL(currentUrl).host
    } catch {
        host = ''
    }
    if(host === 'libraries.minecraft.net' || host.endsWith('mojang.com')){
        return currentUrl
    }
    if(rel.startsWith('net/neoforged/')){
        return NEOFORGE_MAVEN + rel
    }
    if(rel.startsWith('net/fabricmc/')){
        return FABRIC_MAVEN + rel
    }
    return CENTRAL + rel
}

function compareVersions(left, right){
    const a = String(left).split('.').map((part) => parseInt(part, 10) || 0)
    const b = String(right).split('.').map((part) => parseInt(part, 10) || 0)
    const length = Math.max(a.length, b.length)
    for(let i = 0; i < length; i++){
        const av = a[i] || 0
        const bv = b[i] || 0
        if(av > bv){
            return 1
        }
        if(av < bv){
            return -1
        }
    }
    return 0
}

function osMatches(osRule){
    if(!osRule){
        return true
    }
    if(osRule.name){
        const names = { windows: 'win32', osx: 'darwin', linux: 'linux' }
        if(names[osRule.name] !== process.platform){
            return false
        }
    }
    if(osRule.arch){
        const arch = { x86: 'ia32', amd64: 'x64', arm64: 'arm64' }
        if((arch[osRule.arch] || osRule.arch) !== process.arch){
            return false
        }
    }
    if(osRule.versionRange){
        const current = os.release()
        if(osRule.versionRange.min && compareVersions(current, osRule.versionRange.min) < 0){
            return false
        }
        if(osRule.versionRange.max && compareVersions(current, osRule.versionRange.max) > 0){
            return false
        }
    }
    return true
}

function allowedByRules(rules){
    if(!rules || rules.length === 0){
        return true
    }
    let action = 'disallow'
    for(const rule of rules){
        if(rule.features){
            continue
        }
        if(osMatches(rule.os)){
            action = rule.action || 'allow'
        }
    }
    return action === 'allow'
}

function nativeMatchesArch(artifactPath){
    const base = path.posix.basename(mavenPath(artifactPath))
    if(!base.includes('natives-')){
        return true
    }
    const arch = process.arch
    const platform = process.platform
    if(platform === 'win32'){
        if(base.includes('natives-windows-arm64')){
            return arch === 'arm64'
        }
        if(base.includes('natives-windows-x86')){
            return arch === 'ia32'
        }
        if(base.includes('natives-windows')){
            return arch === 'x64'
        }
        return false
    }
    if(platform === 'darwin'){
        if(base.includes('natives-macos-arm64')){
            return arch === 'arm64'
        }
        if(base.includes('natives-macos')){
            return arch === 'x64'
        }
        return false
    }
    if(base.includes('natives-linux-arm64') || base.includes('natives-linux-aarch')){
        return arch === 'arm64'
    }
    if(base.includes('natives-linux')){
        return arch === 'x64' || arch === 'ia32'
    }
    return false
}

function sha1File(file){
    const hash = crypto.createHash('sha1')
    hash.update(fs.readFileSync(file))
    return hash.digest('hex')
}

function fetchBuffer(url, redirects = 0){
    return new Promise((resolve, reject) => {
        if(redirects > 5){
            reject(new Error('Muitos redirecionamentos ao baixar ' + url))
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
                reject(new Error('HTTP ' + res.statusCode + ' em ' + url))
                return
            }
            const chunks = []
            res.on('data', (chunk) => chunks.push(chunk))
            res.on('end', () => resolve(Buffer.concat(chunks)))
        })
        req.setTimeout(180000, () => req.destroy(new Error('Tempo esgotado ao baixar ' + url)))
        req.on('error', reject)
    })
}

async function ensureFile(dest, url, expectedSha1){
    if(fs.existsSync(dest)){
        if(!expectedSha1 || sha1File(dest) === expectedSha1){
            return false
        }
        await fs.remove(dest)
    }
    const payload = await fetchBuffer(url)
    if(expectedSha1){
        const hash = crypto.createHash('sha1').update(payload).digest('hex')
        if(hash !== expectedSha1){
            throw new Error('SHA1 divergente em ' + path.basename(dest))
        }
    }
    await fs.ensureDir(path.dirname(dest))
    const tmp = dest + '.download'
    await fs.writeFile(tmp, payload)
    await fs.move(tmp, dest, { overwrite: true })
    return true
}

async function mapPool(items, limit, worker){
    let index = 0
    const size = Math.max(1, Math.min(limit, items.length || 1))
    await Promise.all(Array.from({ length: size }, async () => {
        while(index < items.length){
            const current = index++
            await worker(items[current], current)
        }
    }))
}

function collectArgs(groups){
    const args = []
    for(const group of groups || []){
        if(typeof group === 'string'){
            args.push(group)
            continue
        }
        if(!allowedByRules(group.rules)){
            continue
        }
        const values = group.values || (group.value != null ? [group.value] : [])
        for(const value of values){
            if(value != null && !String(value).startsWith('-Xms') && !String(value).startsWith('-Xmx')){
                args.push(String(value))
            }
        }
    }
    return args
}

function substitute(value, vars){
    return String(value).replace(/\$\{([^}]+)\}/g, (_, key) => vars[key] != null ? String(vars[key]) : '')
}

function quoteArg(value){
    const text = String(value)
    if(text === ''){
        return '""'
    }
    if(/[\s"]/.test(text) || text.includes('\\')){
        return '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
    }
    return text
}

function urlStatus(url, redirects = 0){
    return new Promise((resolve, reject) => {
        if(redirects > 5){
            reject(new Error('Muitos redirecionamentos ao consultar ' + url))
            return
        }
        const lib = url.startsWith('http://') ? http : https
        const req = lib.request(url, { method: 'HEAD', headers: { 'User-Agent': 'Side-Mine' } }, (res) => {
            res.resume()
            if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
                urlStatus(new URL(res.headers.location, url).toString(), redirects + 1).then(resolve, reject)
                return
            }
            resolve(res.statusCode)
        })
        req.setTimeout(30000, () => req.destroy(new Error('Tempo esgotado ao consultar ' + url)))
        req.on('error', reject)
        req.end()
    })
}

async function ensurePatchedClient(javaExe, commonDir, librariesDir, vanillaClient){
    const rel = 'net/neoforged/minecraft-client-patched/' + NEOFORGE_VERSION + '/minecraft-client-patched-' + NEOFORGE_VERSION + '.jar'
    const patched = path.join(librariesDir, ...rel.split('/'))
    if(fs.existsSync(patched) && fs.statSync(patched).size > 1000000){
        markClientDist(patched)
        return patched
    }
    const profiles = path.join(commonDir, 'launcher_profiles.json')
    if(!fs.existsSync(profiles)){
        await fs.writeJson(profiles, {
            profiles: {
                'side-mine': { name: 'Side-Mine', type: 'custom', lastVersionId: '26.2' }
            },
            selectedProfile: 'side-mine'
        })
    }
    if(!fs.existsSync(vanillaClient)){
        throw new Error('O client.jar da Mojang não foi baixado.')
    }
    const installer = path.join(commonDir, 'neoforge-' + NEOFORGE_VERSION + '-installer.jar')
    const installerUrl = NEOFORGE_MAVEN + 'net/neoforged/neoforge/' + NEOFORGE_VERSION + '/neoforge-' + NEOFORGE_VERSION + '-installer.jar'
    await ensureFile(installer, installerUrl, null)
    await new Promise((resolve, reject) => {
        const child = spawn(javaExe, ['-jar', installer, '--install-client', commonDir], { cwd: commonDir })
        let output = ''
        child.stdout.on('data', (chunk) => { output += chunk.toString() })
        child.stderr.on('data', (chunk) => { output += chunk.toString() })
        child.on('error', reject)
        child.on('exit', (code) => {
            if(code === 0){
                resolve()
            } else {
                reject(new Error('O instalador do NeoForge falhou (' + code + '). ' + output.slice(-500)))
            }
        })
    })
    if(!fs.existsSync(patched)){
        throw new Error('O instalador oficial não gerou o cliente corrigido do NeoForge.')
    }
    markClientDist(patched)
    return patched
}

function markClientDist(jarPath){
    const AdmZip = require('adm-zip')
    const zip = new AdmZip(jarPath)
    const entry = zip.getEntry('META-INF/MANIFEST.MF')
    if(!entry){
        return
    }
    let text = entry.getData().toString('utf8')
    if(text.includes('Minecraft-Dists:')){
        return
    }
    text = text.replace(
        /Main-Class: net\.minecraft\.client\.Main\r?\n/,
        'Main-Class: net.minecraft.client.Main\r\nMinecraft-Dists: client\r\n'
    )
    zip.updateFile('META-INF/MANIFEST.MF', Buffer.from(text, 'utf8'))
    zip.writeZip(jarPath)
}

async function resolveNeoForgeJar(librariesDir){
    const base = NEOFORGE_MAVEN + 'net/neoforged/neoforge/' + NEOFORGE_VERSION + '/'
    const names = [
        'neoforge-' + NEOFORGE_VERSION + '-universal.jar',
        'neoforge-' + NEOFORGE_VERSION + '.jar',
        'neoforge-' + NEOFORGE_VERSION + '-client.jar'
    ]
    for(const name of names){
        const rel = 'net/neoforged/neoforge/' + NEOFORGE_VERSION + '/' + name
        const dest = path.join(librariesDir, ...rel.split('/'))
        if(fs.existsSync(dest) && fs.statSync(dest).size > 100000){
            return { url: base + name, path: rel }
        }
    }
    for(const name of names){
        const url = base + name
        const status = await urlStatus(url)
        if(status === 200){
            return { url, path: 'net/neoforged/neoforge/' + NEOFORGE_VERSION + '/' + name }
        }
    }
    throw new Error('NeoForge ' + NEOFORGE_VERSION + ' não está no Maven oficial.')
}

function playedGameDir(){
    const appData = process.env.APPDATA || ''
    return path.join(appData, '.minecraft', 'versions', 'NeoForge 26.2')
}

function templateClientDir(){
    const packaged = path.join(process.resourcesPath || '', 'client-standard')
    if(fs.existsSync(path.join(packaged, 'mods'))){
        return packaged
    }
    return path.join(__dirname, '..', '..', '..', 'Padrão Client-Side')
}

async function copyMissingTree(source, dest){
    if(!fs.existsSync(source)){
        return 0
    }
    let copied = 0
    const entries = await fs.readdir(source, { withFileTypes: true })
    for(const entry of entries){
        const from = path.join(source, entry.name)
        const to = path.join(dest, entry.name)
        if(entry.isDirectory()){
            copied += await copyMissingTree(from, to)
        } else if(entry.isFile() && !fs.existsSync(to)){
            await fs.ensureDir(path.dirname(to))
            await fs.copy(from, to, { overwrite: false, preserveTimestamps: true })
            copied++
        }
    }
    return copied
}

/**
 * Copia bibliotecas, assets e mods que já existem neste computador
 * para a pasta do Side-Mine. Arquivos que já estão lá não são substituídos.
 */
async function injectKnownInstall(options){
    const commonDir = options.commonDir
    const gameDir = options.gameDir
    const appData = process.env.APPDATA || ''
    const minecraft = path.join(appData, '.minecraft')
    const played = playedGameDir()
    const template = templateClientDir()
    let copied = 0

    copied += await copyMissingTree(path.join(minecraft, 'libraries'), path.join(commonDir, 'libraries'))
    copied += await copyMissingTree(path.join(minecraft, 'assets'), path.join(commonDir, 'assets'))

    const clientDest = path.join(commonDir, 'versions', '26.2', '26.2.jar')
    for(const jar of [
        path.join(played, 'NeoForge 26.2.jar'),
        path.join(template, 'NeoForge 26.2.jar')
    ]){
        if(!fs.existsSync(clientDest) && fs.existsSync(jar)){
            await fs.ensureDir(path.dirname(clientDest))
            await fs.copy(jar, clientDest)
            copied++
        }
    }

    for(const root of [played, template]){
        for(const folder of ['mods', 'config', 'data', 'defaultconfigs']){
            copied += await copyMissingTree(path.join(root, folder), path.join(gameDir, folder))
        }
        const optionsFile = path.join(root, 'options.txt')
        const optionsDest = path.join(gameDir, 'options.txt')
        if(fs.existsSync(optionsFile) && !fs.existsSync(optionsDest)){
            await fs.copy(optionsFile, optionsDest)
            copied++
        }
    }

    logger.info('Arquivos locais injetados:', copied)
    return copied
}

/**
 * Downloads Mojang/NeoForge libraries and starts the NeoForge 26.2 client.
 *
 * @returns {import('child_process').ChildProcess} The Minecraft process.
 */
async function launchNeoForge(options){
    await injectKnownInstall({ commonDir: options.commonDir, gameDir: options.gameDir })
    const version = await fs.readJson(versionJsonPath())
    const commonDir = options.commonDir
    const gameDir = options.gameDir
    const librariesDir = path.join(commonDir, 'libraries')
    const nativesDir = path.join(commonDir, 'natives')
    const assetsDir = path.join(commonDir, 'assets')
    await fs.ensureDir(gameDir)
    await fs.ensureDir(path.join(nativesDir, 'java'))
    await fs.ensureDir(path.join(nativesDir, 'jna'))
    await fs.ensureDir(path.join(nativesDir, 'lwjgl'))
    await fs.ensureDir(path.join(nativesDir, 'netty'))

    const downloads = []
    const client = version.downloads && version.downloads.client
    if(!client || !client.url){
        throw new Error('O manifesto do NeoForge não tem o client.jar da Mojang.')
    }
    const clientDest = path.join(commonDir, 'versions', '26.2', '26.2.jar')
    const templateClient = path.join(__dirname, '..', '..', '..', 'Padrão Client-Side', 'NeoForge 26.2.jar')
    if(!fs.existsSync(clientDest) && fs.existsSync(templateClient)){
        await fs.copy(templateClient, clientDest)
    }
    downloads.push({ dest: clientDest, url: client.url, sha1: client.sha1, label: 'Minecraft' })

    const classpath = []
    for(const library of version.libraries || []){
        if(!library.artifact || !allowedByRules(library.rules) || !nativeMatchesArch(library.artifact.path)){
            continue
        }
        const rel = mavenPath(library.artifact.path)
        const dest = path.join(librariesDir, ...rel.split('/'))
        const url = officialUrl(library.artifact.path, library.artifact.url)
        if(/tlauncher\.org/i.test(url)){
            throw new Error('Biblioteca bloqueada: ' + library.name)
        }
        downloads.push({ dest, url, sha1: library.artifact.sha1, label: library.name || rel })
        classpath.push(dest)
    }

    const neo = await resolveNeoForgeJar(librariesDir)
    const neoDest = path.join(librariesDir, ...neo.path.split('/'))
    downloads.push({ dest: neoDest, url: neo.url, sha1: null, label: 'NeoForge ' + NEOFORGE_VERSION })
    classpath.push(neoDest)

    const assetIndex = version.assetIndex
    const indexDest = path.join(assetsDir, 'indexes', assetIndex.id + '.json')
    downloads.push({ dest: indexDest, url: assetIndex.url, sha1: null, label: 'Índice de assets' })

    if(version.logging && version.logging.client && version.logging.client.file){
        const logFile = version.logging.client.file
        downloads.push({
            dest: path.join(assetsDir, 'log_configs', logFile.id),
            url: logFile.url,
            sha1: logFile.sha1,
            label: 'Log4j'
        })
    }

    let finished = 0
    const report = (label) => {
        finished++
        if(typeof options.onProgress === 'function'){
            options.onProgress(Math.min(99, Math.round(finished / downloads.length * 70)), label)
        }
    }

    await mapPool(downloads, 6, async (item) => {
        await ensureFile(item.dest, item.url, item.sha1)
        report(item.label)
    })

    const index = await fs.readJson(indexDest)
    const objects = Object.keys(index.objects || {}).map((name) => index.objects[name])
    let assetsDone = 0
    await mapPool(objects, 8, async (object) => {
        const dest = path.join(assetsDir, 'objects', object.hash.substring(0, 2), object.hash)
        const url = 'https://resources.download.minecraft.net/' + object.hash.substring(0, 2) + '/' + object.hash
        await ensureFile(dest, url, object.hash)
        assetsDone++
        if(assetsDone % 25 === 0 && typeof options.onProgress === 'function'){
            options.onProgress(70 + Math.round(assetsDone / objects.length * 29), 'Baixando recursos do Minecraft')
        }
    })

    if(!options.javaExe || !fs.existsSync(options.javaExe)){
        throw new Error('Java 25 não encontrado. Instale o Java pelo launcher e tente de novo.')
    }
    const patchedClient = await ensurePatchedClient(options.javaExe, commonDir, librariesDir, clientDest)
    classpath.push(patchedClient)

    const auth = options.authUser
    const logConfig = version.logging && version.logging.client
        ? path.join(assetsDir, 'log_configs', version.logging.client.file.id)
        : ''
    const vars = {
        auth_player_name: auth.displayName,
        version_name: version.id,
        game_directory: gameDir,
        assets_root: assetsDir,
        assets_index_name: assetIndex.id,
        auth_uuid: auth.uuid,
        auth_access_token: auth.accessToken,
        clientid: '',
        auth_xuid: '',
        user_type: auth.type === 'microsoft' ? 'msa' : (auth.type === 'offline' ? 'legacy' : 'mojang'),
        version_type: version.type || 'release',
        natives_directory: nativesDir,
        launcher_name: 'Side-Mine',
        launcher_version: options.versionLabel || '2.2.1',
        library_directory: librariesDir,
        classpath: classpath.join(path.delimiter),
        path: logConfig
    }

    const extraJvm = (options.extraJvm || []).filter((arg) => !/UseG1GC|G1NewSizePercent|G1ReservePercent|MaxGCPauseMillis|G1HeapRegionSize|UseZGC|UnlockExperimentalVMOptions/.test(arg))
    const jvmArgs = [
        '-Xms' + (options.minRam || '2G'),
        '-Xmx' + (options.maxRam || '4G'),
        ...extraJvm
    ]
    if(logConfig){
        jvmArgs.push(substitute(version.logging.client.argument || '-Dlog4j.configurationFile=${path}', vars))
    }
    jvmArgs.push(...collectArgs(version.arguments.default_user_jvm).map((arg) => substitute(arg, vars)))
    jvmArgs.push(...collectArgs(version.arguments.jvm).map((arg) => substitute(arg, vars)))

    const gameArgs = collectArgs(version.arguments.game).map((arg) => substitute(arg, vars))
    const args = [...jvmArgs, version.mainClass, ...gameArgs]
    const argFile = path.join(gameDir, 'side-mine-launch.args')
    await fs.writeFile(argFile, args.map(quoteArg).join('\n'), 'utf8')

    logger.info('Starting NeoForge', version.mainClass)
    const child = spawn(options.javaExe, ['@' + argFile], {
        cwd: gameDir,
        detached: !!options.detached
    })
    if(options.detached){
        child.unref()
    }
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (data) => {
        data.split(/\r?\n/).forEach((line) => {
            if(line){
                console.log('\x1b[32m[Minecraft]\x1b[0m ' + line)
            }
        })
    })
    child.stderr.on('data', (data) => {
        data.split(/\r?\n/).forEach((line) => {
            if(line){
                console.log('\x1b[31m[Minecraft]\x1b[0m ' + line)
            }
        })
    })
    child.on('close', (code) => {
        logger.info('Minecraft exited with code', code)
    })
    if(typeof options.onProgress === 'function'){
        options.onProgress(100, 'Abrindo o Minecraft')
    }
    return child
}

module.exports = { launchNeoForge, injectKnownInstall }
