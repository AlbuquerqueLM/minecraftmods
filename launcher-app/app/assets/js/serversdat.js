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

function writeServers(root){
    const body = Buffer.concat([
        Buffer.from([TAG.COMPOUND]),
        writeString(root.name || ''),
        writePayload(TAG.COMPOUND, root.value)
    ])
    return zlib.gzipSync(body)
}

function stringValue(compound, key){
    const tag = compound?.[key]
    return tag && tag.type === TAG.STRING ? tag.value : ''
}

/**
 * Keep a named server in Minecraft's multiplayer list.
 * Other entries are left in place. The address of the named server
 * is replaced with the value from the launcher settings.
 *
 * @param {string} gameDir Instance directory that contains servers.dat.
 * @param {string} name Server name shown in the multiplayer screen.
 * @param {string} address Host, or host:port.
 */
function ensureSidequestServer(gameDir, name, address){
    const file = path.join(gameDir, 'servers.dat')
    fs.ensureDirSync(gameDir)

    let root
    if(fs.existsSync(file)){
        root = readServers(fs.readFileSync(file))
    } else {
        root = { name: '', value: {} }
    }

    if(!root.value.servers || root.value.servers.type !== TAG.LIST){
        root.value.servers = {
            type: TAG.LIST,
            value: { elementType: TAG.COMPOUND, items: [] }
        }
    }

    const list = root.value.servers.value
    if(list.elementType !== TAG.COMPOUND){
        throw new Error('servers.dat servers list is not a compound list')
    }

    const existing = list.items.find(server => stringValue(server, 'name') === name)
    if(existing){
        existing.ip = { type: TAG.STRING, value: address }
    } else {
        list.items.unshift({
            name: { type: TAG.STRING, value: name },
            ip: { type: TAG.STRING, value: address }
        })
    }

    fs.writeFileSync(file, writeServers(root))
}

module.exports = {
    ensureSidequestServer,
    readServers
}
