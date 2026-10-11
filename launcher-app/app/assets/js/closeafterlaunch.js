const EXIT_DELAY_MS = 2500

/**
 * Fecha o launcher só se o processo do jogo continuar vivo.
 * Um crash imediato cancela o fechamento e devolve a mensagem.
 *
 * @param {import('child_process').ChildProcess} gameProcess
 * @param {{ quit: () => void, onFailure: (message: string) => void, delayMs?: number }} hooks
 */
function scheduleLauncherExit(gameProcess, hooks){
    const delayMs = hooks.delayMs == null ? EXIT_DELAY_MS : hooks.delayMs
    if(!gameProcess || !gameProcess.pid){
        hooks.onFailure('O Java não chegou a iniciar.')
        return
    }

    let settled = false
    const timer = setTimeout(() => {
        if(settled || gameProcess.exitCode != null || gameProcess.killed){
            return
        }
        settled = true
        try {
            gameProcess.unref()
        } catch(err) {
            // O processo já foi solto no disparo.
        }
        hooks.quit()
    }, delayMs)

    const keepOpen = (message) => {
        if(settled){
            return
        }
        settled = true
        clearTimeout(timer)
        hooks.onFailure(message)
    }

    gameProcess.once('error', (err) => {
        keepOpen(err && err.message ? err.message : 'O Java não iniciou.')
    })
    gameProcess.once('exit', (code) => {
        const detail = code == null ? '' : ' (código ' + code + ')'
        keepOpen('O Minecraft encerrou antes de abrir' + detail + '.')
    })
}

module.exports = { scheduleLauncherExit, EXIT_DELAY_MS }
