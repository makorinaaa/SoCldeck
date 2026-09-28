const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('probe', { invoke: () => ipcRenderer.invoke('security-probe') });
