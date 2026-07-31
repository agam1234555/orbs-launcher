const { contextBridge, ipcRenderer, clipboard } = require('electron');

contextBridge.exposeInMainWorld('orbsAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  getLucideIcons: () => ipcRenderer.invoke('get-lucide-icons'),

  sendActiveItem: (item) => ipcRenderer.send('active-item-changed', item),
  sendReleaseTrigger: () => ipcRenderer.send('release-trigger'),

  onShowWheel: (callback) => ipcRenderer.on('show-wheel', (_event, data) => callback(data)),
  onConfigReloaded: (callback) => ipcRenderer.on('config-reloaded', (_event, config) => callback(config)),

  copyToClipboard: (text) => clipboard.writeText(text),

  // Settings window API
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  pickAppTarget: () => ipcRenderer.invoke('pick-app-target'),
  getInstalledApps: () => ipcRenderer.invoke('get-installed-apps'),
  closeSettings: () => ipcRenderer.send('close-settings'),
  getAutoStart: () => ipcRenderer.invoke('get-autostart'),
  setAutoStart: (enabled) => ipcRenderer.invoke('set-autostart', enabled),
  getAppIcon: (targetPath) => ipcRenderer.invoke('get-app-icon', targetPath),
});
