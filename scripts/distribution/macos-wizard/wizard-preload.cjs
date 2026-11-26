'use strict';
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sentryWizard', {
  getInitialState: () => ipcRenderer.invoke('wizard:initial-state'),
  getProviderStatus: () => ipcRenderer.invoke('wizard:provider-status'),
  startSetup: (options) => ipcRenderer.invoke('wizard:start', options),
  saveProviders: (entries) => ipcRenderer.invoke('wizard:save-providers', entries),
  launchDesktop: () => ipcRenderer.invoke('wizard:launch-desktop'),
  onProgress: (cb) => {
    const fn = (_evt, data) => cb(data);
    ipcRenderer.on('wizard:progress', fn);
    return () => ipcRenderer.removeListener('wizard:progress', fn);
  },
  onLog: (cb) => {
    const fn = (_evt, line) => cb(line);
    ipcRenderer.on('wizard:log', fn);
    return () => ipcRenderer.removeListener('wizard:log', fn);
  },
});
