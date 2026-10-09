const { ipcRenderer } = require('electron')

function skinFromHref(href){
    let url
    try {
        url = new URL(href, 'https://ely.by')
    } catch {
        return null
    }
    if(!/(^|\.)ely\.by$/i.test(url.hostname) && !/skinsystem\.ely\.by$/i.test(url.hostname)){
        return null
    }
    const parts = url.pathname.split('/').filter(Boolean)
    if((parts[0] === 'skins' || parts[0] === 'skin') && parts[1] && parts[1] !== 'upload'){
        return {
            name: decodeURIComponent(parts[1]),
            href: url.toString()
        }
    }
    const login = url.searchParams.get('login') || url.searchParams.get('username') || url.searchParams.get('name')
    if(login){
        return { name: login, href: url.toString() }
    }
    return null
}

function pngFromNode(node){
    const image = node && node.querySelector ? node.querySelector('img') : null
    const src = (image && image.currentSrc) || (image && image.src) || ''
    if(/skinsystem\.ely\.by|ely\.by/i.test(src) && /\.png($|\?)/i.test(src)){
        return src
    }
    return ''
}

document.addEventListener('click', (event) => {
    const node = event.target && event.target.closest ? event.target.closest('a[href], button, [data-username], [data-skin]') : null
    if(!node){
        return
    }
    const href = node.href || node.getAttribute('data-href') || node.getAttribute('data-url') || ''
    const named = node.getAttribute('data-username') || node.getAttribute('data-skin') || ''
    const fromHref = href ? skinFromHref(href) : null
    const name = (fromHref && fromHref.name) || named
    if(!name){
        return
    }
    ipcRenderer.sendToHost('elyby-skin', {
        name,
        href: (fromHref && fromHref.href) || href,
        png: pngFromNode(node),
        variant: /slim|alex/i.test(node.className + ' ' + (node.textContent || '')) ? 'slim' : 'classic'
    })
}, true)
