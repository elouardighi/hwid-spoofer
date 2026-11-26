const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getStatus: () => ipcRenderer.invoke('get-status'),
  spoofBios: () => ipcRenderer.invoke('spoof-bios'),
  spoofSmbios: () => ipcRenderer.invoke('spoof-smbios'),
  spoofDisks: () => ipcRenderer.invoke('spoof-disks'),
  spoofNetwork: () => ipcRenderer.invoke('spoof-network'),
  spoofUsb: () => ipcRenderer.invoke('spoof-usb'),
  fullSpoof: (name) => ipcRenderer.invoke('full-spoof', name),
  backup: (name) => ipcRenderer.invoke('backup', name),
  restore: (name) => ipcRenderer.invoke('restore', name),
  verify: () => ipcRenderer.invoke('verify'),
  listProfiles: () => ipcRenderer.invoke('list-profiles'),
  showFolder: () => ipcRenderer.invoke('show-folder'),
  snapshot: () => ipcRenderer.invoke('snapshot'),
  compare: () => ipcRenderer.invoke('compare'),
  onProgress: (callback) => ipcRenderer.on('progress', (event, data) => callback(data)),
});
