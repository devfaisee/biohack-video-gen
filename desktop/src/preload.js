const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktopAPI', {
  getMode: () => ipcRenderer.invoke('get-mode'),
  getRailwayUrl: () => ipcRenderer.invoke('get-railway-url'),
  getLocalUrl: () => ipcRenderer.invoke('get-local-url'),
  getServerStatus: () => ipcRenderer.invoke('get-server-status'),
  switchMode: (mode) => ipcRenderer.invoke('switch-mode', mode),
  openOutputFolder: () => ipcRenderer.invoke('open-output-folder'),
  getOutputVideos: () => ipcRenderer.invoke('get-output-videos'),
  openFile: (filePath) => ipcRenderer.invoke('open-file', filePath),
  showItemInFolder: (filePath) => ipcRenderer.invoke('show-item-in-folder', filePath),
  onServerLog: (callback) => {
    ipcRenderer.on('server-log', (event, msg) => callback(msg));
    return () => ipcRenderer.removeAllListeners('server-log');
  },
  isElectron: true,
});
