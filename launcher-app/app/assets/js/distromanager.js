const { DistributionAPI } = require('helios-core/common')

const ConfigManager = require('./configmanager')

// Índice publicado em https://github.com/AlbuquerqueLM/minecraftmods
exports.REMOTE_DISTRO_URL = 'https://albuquerquelm.github.io/minecraftmods/distribution.json'

const api = new DistributionAPI(
    ConfigManager.getLauncherDirectory(),
    null, // Injected forcefully by the preloader.
    null, // Injected forcefully by the preloader.
    exports.REMOTE_DISTRO_URL,
    false
)

exports.DistroAPI = api