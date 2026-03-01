const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Main → Renderer events
  onFileOpened: (callback) => {
    ipcRenderer.on("file-opened", (_, data) => callback(data));
  },
  onFileSaved: (callback) => {
    ipcRenderer.on("file-saved", (_, filePath) => callback(filePath));
  },
  onFileChangedExternally: (callback) => {
    ipcRenderer.on("file-changed-externally", (_, filePath) => callback(filePath));
  },
  onRequestContent: (callback) => {
    ipcRenderer.on("request-content", (_, responseChannel) => callback(responseChannel));
  },

  // Renderer → Main
  sendContent: (channel, content) => {
    ipcRenderer.send(channel, content);
  },
  notifyContentChanged: () => {
    ipcRenderer.send("content-changed");
  },
  reloadFile: () => {
    ipcRenderer.send("reload-file");
  },

  // Renderer → Main (invoke/handle pattern)
  getRecentFiles: () => ipcRenderer.invoke("get-recent-files"),
});
