const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('fazilDesktop',Object.freeze({connect:serverUrl=>ipcRenderer.invoke('fazil:connect',serverUrl)}));
