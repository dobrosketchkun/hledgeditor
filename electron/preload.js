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
  onAppDialogRequest: (callback) => {
    ipcRenderer.on("app-dialog-request", (_, payload) => callback(payload));
  },
  onSettingsUpdated: (callback) => {
    ipcRenderer.on("settings-updated", (_, settings) => callback(settings));
  },
  onBackupAvailable: (callback) => {
    ipcRenderer.on("backup-available", (_, payload) => callback(payload));
  },

  // Renderer → Main
  sendContent: (channel, content) => {
    ipcRenderer.send(channel, content);
  },
  respondDialog: (channel, result) => {
    ipcRenderer.send(channel, result);
  },
  notifyContentChanged: () => {
    ipcRenderer.send("content-changed");
  },
  reloadFile: () => {
    ipcRenderer.send("reload-file");
  },

  // Renderer → Main (invoke/handle pattern)
  getRecentFiles: () => ipcRenderer.invoke("get-recent-files"),
  newFile: () => ipcRenderer.invoke("file:new"),
  openFile: () => ipcRenderer.invoke("file:open"),
  saveFile: () => ipcRenderer.invoke("file:save"),
  saveFileAs: () => ipcRenderer.invoke("file:save-as"),
  resolveIncludes: (content, filePath) => ipcRenderer.invoke("resolve-includes", { content, filePath }),
  minimizeWindow: () => ipcRenderer.send("window:minimize"),
  toggleMaximizeWindow: () => ipcRenderer.send("window:toggle-maximize"),
  closeWindow: () => ipcRenderer.send("window:close"),
  isWindowMaximized: () => ipcRenderer.invoke("window:is-maximized"),
  getSettings: () => ipcRenderer.invoke("settings:get"),
  updateSettings: (patch) => ipcRenderer.invoke("settings:update", patch),
  writeBackup: (payload) => ipcRenderer.invoke("backup:write", payload),
  clearBackup: () => ipcRenderer.invoke("backup:clear"),
});
