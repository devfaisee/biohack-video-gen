const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getMode: () => ipcRenderer.invoke('get-mode'),
  getRailwayUrl: () => ipcRenderer.invoke('get-railway-url'),
  getLocalUrl: () => ipcRenderer.invoke('get-local-url'),
  switchMode: (mode) => ipcRenderer.invoke('switch-mode', mode),
  cancelGeneration: () => ipcRenderer.invoke('cancel-generation'),
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  getOutputVideos: () => ipcRenderer.invoke('get-output-videos'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  onServerLog: (callback) => {
    const handler = (event, msg) => callback(msg);
    ipcRenderer.on('server-log', handler);
    return () => ipcRenderer.removeListener('server-log', handler);
  },
  isElectron: true,
});
