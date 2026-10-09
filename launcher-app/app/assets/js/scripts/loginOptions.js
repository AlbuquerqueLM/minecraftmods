const loginOptionsCancelContainer = document.getElementById('loginOptionCancelContainer')
const loginOptionsCancelButton = document.getElementById('loginOptionCancelButton')
const loginNickForm = document.getElementById('loginNickForm')
const loginNickField = document.getElementById('loginNickField')
const loginNickError = document.getElementById('loginNickError')
const loginNickButton = document.getElementById('loginNickButton')

let loginOptionsViewOnLoginSuccess
let loginOptionsViewOnLoginCancel
let loginOptionsViewOnCancel
let loginOptionsViewCancelHandler

const NICK_PATTERN = /^[A-Za-z0-9_]{3,16}$/

function loginOptionsCancelEnabled(val){
    if(val){
        $(loginOptionsCancelContainer).show()
    } else {
        $(loginOptionsCancelContainer).hide()
    }
}

function showNickError(message){
    loginNickError.innerHTML = message || ''
    if(message){
        loginNickField.setAttribute('error', '')
    } else {
        loginNickField.removeAttribute('error')
    }
}

loginNickForm.onsubmit = (e) => {
    e.preventDefault()
    const nick = loginNickField.value.trim()
    if(!NICK_PATTERN.test(nick)){
        showNickError(Lang.queryJS('loginOptions.nickInvalid'))
        return
    }
    showNickError('')
    loginNickButton.disabled = true

    const account = AuthManager.addOfflineAccount(nick)
    updateSelectedAccount(account)
    const destination = loginOptionsViewOnLoginSuccess
    switchView(getCurrentView(), destination, 500, 500, async () => {
        if(destination === VIEWS.settings){
            await prepareSettings()
        }
        loginOptionsViewOnLoginSuccess = VIEWS.landing
        loginOptionsViewOnLoginCancel = VIEWS.loginOptions
        loginOptionsViewCancelHandler = null
        loginNickField.value = ''
        loginNickButton.disabled = false
    })
}

loginOptionsCancelButton.onclick = () => {
    switchView(getCurrentView(), loginOptionsViewOnCancel, 500, 500, () => {
        loginNickField.value = ''
        showNickError('')
        if(loginOptionsViewCancelHandler != null){
            loginOptionsViewCancelHandler()
            loginOptionsViewCancelHandler = null
        }
    })
}
