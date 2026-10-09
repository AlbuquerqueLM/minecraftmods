const fs = require('fs-extra')
const path = require('path')
const toml = require('toml')
const merge = require('lodash.merge')

let lang

exports.loadLanguage = function(id){
    lang = merge(lang || {}, toml.parse(fs.readFileSync(path.join(__dirname, '..', 'lang', `${id}.toml`))) || {})
}

exports.query = function(id, placeHolders){
    let query = id.split('.')
    let res = lang
    for(let q of query){
        res = res[q]
    }
    let text = res === lang ? '' : res
    if (placeHolders) {
        Object.entries(placeHolders).forEach(([key, value]) => {
            text = text.replace(`{${key}}`, value)
        })
    }
    return text
}

exports.queryJS = function(id, placeHolders){
    return exports.query(`js.${id}`, placeHolders)
}

exports.queryEJS = function(id, placeHolders){
    return exports.query(`ejs.${id}`, placeHolders)
}

exports.setupLanguage = function(){
    lang = {}
    // Load Language Files
    exports.loadLanguage('en_US')
    // Uncomment this when translations are ready
    //exports.loadLanguage('xx_XX')

    // Load Custom Language File for Launcher Customizer
    exports.loadLanguage('_custom')
    exports.loadRemoteLanguage()
}

exports.loadRemoteLanguage = function(){
    const file = remoteLangPath()
    if(file == null || !fs.existsSync(file)){
        return
    }
    lang = merge(lang || {}, toml.parse(fs.readFileSync(file, 'utf8')) || {})
}

function remoteLangPath(){
    try {
        const electron = require('electron')
        if(electron.app && typeof electron.app.getPath === 'function'){
            return path.join(electron.app.getPath('userData'), 'remote-ui', 'assets', 'lang', '_custom.toml')
        }
    } catch(err) {
        // Renderer resolves the path below.
    }
    try {
        const remote = require('@electron/remote')
        return path.join(remote.app.getPath('userData'), 'remote-ui', 'assets', 'lang', '_custom.toml')
    } catch(err) {
        return null
    }
}