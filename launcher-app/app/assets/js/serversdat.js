const fs = require('fs-extra')
const path = require('path')
const zlib = require('zlib')

const TAG = {
    END: 0,
    BYTE: 1,
    SHORT: 2,
    INT: 3,
    LONG: 4,
    FLOAT: 5,
    DOUBLE: 6,
    BYTE_ARRAY: 7,
    STRING: 8,
    LIST: 9,
    COMPOUND: 10,
    INT_ARRAY: 11,
    LONG_ARRAY: 12
}

class Reader {
    constructor(buffer){
        this.buffer = buffer
        this.offset = 0
    }

    u8(){
        return this.buffer.readUInt8(this.offset++)
    }

    i8(){
        return this.buffer.readInt8(this.offset++)
    }

    u16(){
        const value = this.buffer.readUInt16BE(this.offset)
        this.offset += 2
        return value
    }

    i16(){
        const value = this.buffer.readInt16BE(this.offset)
        this.offset += 2
        return value
    }

    i32(){
        const value = this.buffer.readInt32BE(this.offset)
        this.offset += 4
        return value
    }

    i64(){
        const value = this.buffer.readBigInt64BE(this.offset)
        this.offset += 8
        return value
    }

    f32(){
        const value = this.buffer.readFloatBE(this.offset)
        this.offset += 4
        return value
    }

    f64(){
        const value = this.buffer.readDoubleBE(this.offset)
        this.offset += 8
        return value
    }

    bytes(length){
        const value = this.buffer.subarray(this.offset, this.offset + length)
        this.offset += length
        return Buffer.from(value)
    }

    string(){
        const length = this.u16()
        return this.bytes(length).toString('utf8')
    }

    payload(type){
        switch(type){
            case TAG.BYTE: return this.i8()
            case TAG.SHORT: return this.i16()
            case TAG.INT: return this.i32()
            case TAG.LONG: return this.i64()
            case TAG.FLOAT: return this.f32()
            case TAG.DOUBLE: return this.f64()
            case TAG.BYTE_ARRAY: return this.bytes(this.i32())
            case TAG.STRING: return this.string()
            case TAG.LIST: {
                const elementType = this.u8()
                const length = this.i32()
                const items = []
                for(let i = 0; i < length; i++){
                    items.push(this.payload(elementType))
                }
                return { elementType, items }
            }
            case TAG.COMPOUND: {
                const value = {}
                for(;;){
                    const childType = this.u8()
                    if(childType === TAG.END){
                        break
                    }
                    const name = this.string()
                    value[name] = { type: childType, value: this.payload(childType) }
                }
                return value
            }
            case TAG.INT_ARRAY: {
                const length = this.i32()
                const items = []
                for(let i = 0; i < length; i++){
                    items.push(this.i32())
                }
                return items
            }
            case TAG.LONG_ARRAY: {
                const length = this.i32()
                const items = []
                for(let i = 0; i < length; i++){
                    items.push(this.i64())
                }
                return items
            }
            default:
                throw new Error(`Unsupported NBT tag ${type}`)
        }
    }
}

function writeString(value){
    const body = Buffer.from(value, 'utf8')
    const header = Buffer.alloc(2)
    header.writeUInt16BE(body.length)
    return Buffer.concat([header, body])
}

function writePayload(type, value){
    switch(type){
        case TAG.BYTE: {
            const buffer = Buffer.alloc(1)
            buffer.writeInt8(value)
            return buffer
        }
        case TAG.SHORT: {
            const buffer = Buffer.alloc(2)
            buffer.writeInt16BE(value)
            return buffer
        }
        case TAG.INT: {
            const buffer = Buffer.alloc(4)
            buffer.writeInt32BE(value)
            return buffer
        }
        case TAG.LONG: {
            const buffer = Buffer.alloc(8)
            buffer.writeBigInt64BE(value)
            return buffer
        }
        case TAG.FLOAT: {
            const buffer = Buffer.alloc(4)
            buffer.writeFloatBE(value)
            return buffer
        }
        case TAG.DOUBLE: {
            const buffer = Buffer.alloc(8)
            buffer.writeDoubleBE(value)
            return buffer
        }
        case TAG.BYTE_ARRAY: {
            const header = Buffer.alloc(4)
            header.writeInt32BE(value.length)
            return Buffer.concat([header, value])
        }
        case TAG.STRING:
            return writeString(value)
        case TAG.LIST: {
            const header = Buffer.alloc(5)
            header.writeUInt8(value.elementType)
            header.writeInt32BE(value.items.length, 1)
            return Buffer.concat([header, ...value.items.map(item => writePayload(value.elementType, item))])
        }
        case TAG.COMPOUND: {
            const parts = []
            for(const [name, child] of Object.entries(value)){
                parts.push(Buffer.from([child.type]))
                parts.push(writeString(name))
                parts.push(writePayload(child.type, child.value))
            }
            parts.push(Buffer.from([TAG.END]))
            return Buffer.concat(parts)
        }
        case TAG.INT_ARRAY: {
            const header = Buffer.alloc(4)
            header.writeInt32BE(value.length)
            const body = Buffer.alloc(value.length * 4)
            value.forEach((item, index) => body.writeInt32BE(item, index * 4))
            return Buffer.concat([header, body])
        }
        case TAG.LONG_ARRAY: {
            const header = Buffer.alloc(4)
            header.writeInt32BE(value.length)
            const body = Buffer.alloc(value.length * 8)
            value.forEach((item, index) => body.writeBigInt64BE(item, index * 8))
            return Buffer.concat([header, body])
        }
        default:
            throw new Error(`Unsupported NBT tag ${type}`)
    }
}

function readServers(buffer){
    let uncompressed = buffer
    try {
        uncompressed = zlib.gunzipSync(buffer)
    } catch(err) {
        uncompressed = buffer
    }
    const reader = new Reader(uncompressed)
    const type = reader.u8()
    if(type !== TAG.COMPOUND){
        throw new Error('servers.dat root is not a compound')
    }
    const name = reader.string()
    return { name, value: reader.payload(TAG.COMPOUND) }
}

function writeServers(root, compress){
    const body = Buffer.concat([
        Buffer.from([TAG.COMPOUND]),
        writeString(root.name || ''),
        writePayload(TAG.COMPOUND, root.value)
    ])
    return compress ? zlib.gzipSync(body) : body
}

function isGzip(buffer){
    return buffer.length >= 2 && buffer[0] === 0x1f && buffer[1] === 0x8b
}

function buildServersDat(serverName, serverAddress){
    const nameBuf = Buffer.from(serverName, 'utf8')
    const addrBuf = Buffer.from(serverAddress, 'utf8')
    const header = Buffer.from([
        0x0a, 0x00, 0x00,
        0x09, 0x00, 0x07, 0x73, 0x65, 0x72, 0x76, 0x65, 0x72, 0x73,
        0x0a, 0x00, 0x00, 0x00, 0x01
    ])
    const ipTagHeader = Buffer.from([0x08, 0x00, 0x02, 0x69, 0x70])
    const ipLenBuf = Buffer.alloc(2)
    ipLenBuf.writeUInt16BE(addrBuf.length)
    const nameTagHeader = Buffer.from([0x08, 0x00, 0x04, 0x6e, 0x61, 0x6d, 0x65])
    const nameLenBuf = Buffer.alloc(2)
    nameLenBuf.writeUInt16BE(nameBuf.length)
    const footer = Buffer.from([0x00, 0x00])
    return Buffer.concat([
        header,
        ipTagHeader, ipLenBuf, addrBuf,
        nameTagHeader, nameLenBuf, nameBuf,
        footer
    ])
}

function resolveOfficialServer(distributionFile, serverId){
    const distro = JSON.parse(fs.readFileSync(distributionFile, 'utf8'))
    const servers = distro.servers || []
    const server = servers.find((item) => item.id === serverId)
        || servers.find((item) => item.mainServer)
        || servers[0]
    if(!server || !server.address || !server.name){
        throw new Error('distribution.json não tem o endereço do servidor')
    }
    return { name: server.name, address: server.address }
}

const OFFICIAL_MARKER = 'side-mine-official.json'

function markerPath(dataDirPath){
    return path.join(dataDirPath, OFFICIAL_MARKER)
}

function readOfficialMarker(dataDirPath){
    const file = markerPath(dataDirPath)
    if(!fs.existsSync(file)){
        return null
    }
    try {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'))
        if(data && data.name && data.address){
            return { name: data.name, address: data.address }
        }
    } catch(err) {
        return null
    }
    return null
}

function writeOfficialMarker(dataDirPath, serverName, serverAddress){
    fs.writeFileSync(markerPath(dataDirPath), JSON.stringify({
        name: serverName,
        address: serverAddress
    }), 'utf8')
}

function matchesIdentity(server, identity){
    if(!identity){
        return false
    }
    return stringValue(server, 'name') === identity.name || stringValue(server, 'ip') === identity.address
}

function injectDynamicServer(dataDirPath, serverName, serverAddress){
    if(!serverName || !serverAddress){
        return
    }
    const serversDatPath = path.join(dataDirPath, 'servers.dat')
    fs.ensureDirSync(dataDirPath)
    const current = { name: serverName, address: serverAddress }
    const previous = readOfficialMarker(dataDirPath)
    if(!fs.existsSync(serversDatPath)){
        fs.writeFileSync(serversDatPath, buildServersDat(serverName, serverAddress))
        writeOfficialMarker(dataDirPath, serverName, serverAddress)
        console.log('[Side-Mine] Servidor ' + serverName + ' (' + serverAddress + ') injetado com sucesso no servers.dat!')
        return
    }
    try {
        const original = fs.readFileSync(serversDatPath)
        const root = readServers(original)
        if(!root.value.servers || root.value.servers.type !== TAG.LIST){
            fs.writeFileSync(serversDatPath, buildServersDat(serverName, serverAddress))
            writeOfficialMarker(dataDirPath, serverName, serverAddress)
            return
        }
        const list = root.value.servers.value
        if(!list || list.elementType !== TAG.COMPOUND){
            fs.writeFileSync(serversDatPath, buildServersDat(serverName, serverAddress))
            writeOfficialMarker(dataDirPath, serverName, serverAddress)
            return
        }
        const kept = previous
            ? list.items.filter((server) => !matchesIdentity(server, previous) && !matchesIdentity(server, current))
            : []
        list.items = [{
            name: { type: TAG.STRING, value: serverName },
            ip: { type: TAG.STRING, value: serverAddress }
        }, ...kept]
        fs.writeFileSync(serversDatPath, writeServers(root, isGzip(original)))
        writeOfficialMarker(dataDirPath, serverName, serverAddress)
        console.log('[Side-Mine] Servidor ' + serverName + ' (' + serverAddress + ') substituiu o anterior no servers.dat!')
    } catch(err) {
        console.error('[Side-Mine] Erro ao injetar o servidor dinâmico:', err)
    }
}

function stringValue(compound, key){
    const tag = compound?.[key]
    return tag && tag.type === TAG.STRING ? tag.value : ''
}

/**
 * Substitui o servidor oficial anterior pelo endereço atual do distribution.json.
 *
 * @param {string} gameDir Instance directory that contains servers.dat.
 * @param {string} name Server name shown in the multiplayer screen.
 * @param {string} address Host, or host:port.
 */
function ensureSidequestServer(gameDir, name, address){
    injectDynamicServer(gameDir, name, address)
}

module.exports = {
    ensureSidequestServer,
    injectDynamicServer,
    resolveOfficialServer,
    readServers,
    buildServersDat
}
