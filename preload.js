const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  updateTitlebarTheme: (theme) => ipcRenderer.send('update-titlebar-theme', theme),
  changeSourcesDir:    ()      => ipcRenderer.invoke('change-sources-dir'),
});
