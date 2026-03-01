const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");
const { DEFAULT_SETTINGS, loadSettings, updateSettings } = require("./settings");

const isDev = !app.isPackaged;

let mainWindow = null;
let currentFilePath = null;
let fileWatcher = null;
let unsavedChanges = false;
let currentSettings = DEFAULT_SETTINGS;

function getBackupPath() {
  return path.join(app.getPath("userData"), "unsaved-backup.json");
}

function readBackup() {
  const backupPath = getBackupPath();
  try {
    if (fs.existsSync(backupPath)) {
      return JSON.parse(fs.readFileSync(backupPath, "utf-8"));
    }
  } catch {}
  return null;
}

function writeBackup(payload) {
  const backupPath = getBackupPath();
  try {
    fs.writeFileSync(backupPath, JSON.stringify(payload, null, 2), "utf-8");
  } catch {}
}

function clearBackup() {
  const backupPath = getBackupPath();
  try {
    if (fs.existsSync(backupPath)) fs.unlinkSync(backupPath);
  } catch {}
}

// ─── Recent files ──────────────────────────────────────────────────

const RECENT_FILES_PATH = path.join(app.getPath("userData"), "recent-files.json");
const MAX_RECENT = 10;

function loadRecentFiles() {
  try {
    if (fs.existsSync(RECENT_FILES_PATH)) {
      return JSON.parse(fs.readFileSync(RECENT_FILES_PATH, "utf-8"));
    }
  } catch {}
  return [];
}

function saveRecentFiles(files) {
  fs.writeFileSync(RECENT_FILES_PATH, JSON.stringify(files, null, 2));
}

function addRecentFile(filePath) {
  let recent = loadRecentFiles();
  recent = recent.filter((f) => f !== filePath);
  recent.unshift(filePath);
  if (recent.length > MAX_RECENT) recent = recent.slice(0, MAX_RECENT);
  saveRecentFiles(recent);
}

// ─── File watching ─────────────────────────────────────────────────

function watchFile(filePath) {
  if (fileWatcher) fileWatcher.close();
  fileWatcher = chokidar.watch(filePath, { ignoreInitial: true });
  fileWatcher.on("change", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("file-changed-externally", filePath);
    }
  });
}

function stopWatching() {
  if (fileWatcher) {
    fileWatcher.close();
    fileWatcher = null;
  }
}

// ─── Window title ──────────────────────────────────────────────────

function updateTitle() {
  if (!mainWindow) return;
  const name = currentFilePath ? path.basename(currentFilePath) : "Untitled";
  const modified = unsavedChanges ? " •" : "";
  mainWindow.setTitle(`${name}${modified} — hledger Editor`);
}

// ─── Menu ──────────────────────────────────────────────────────────

function buildMenu() {
  Menu.setApplicationMenu(null);
}

// ─── File operations ───────────────────────────────────────────────

function requestRendererDialog(kind, payload = {}, timeoutMs = 20000) {
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve(null);
  const responseChannel = `app-dialog-response-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    ipcMain.once(responseChannel, (_, value) => done(value));
    mainWindow.webContents.send("app-dialog-request", { kind, payload, responseChannel });
    setTimeout(() => done(null), timeoutMs);
  });
}

async function showAppError(title, message) {
  await requestRendererDialog("error", { title, message });
}

async function confirmUnsaved() {
  if (!unsavedChanges) return true;
  const action = await requestRendererDialog("unsaved", {
    title: "Unsaved Changes",
    message: "You have unsaved changes. What would you like to do?",
  });
  if (action === "save") {
    return await saveFile();
  }
  if (action === "discard") return true;
  return false;
}

async function newFile() {
  if (!(await confirmUnsaved())) return;
  currentFilePath = null;
  unsavedChanges = false;
  clearBackup();
  stopWatching();
  updateTitle();
  mainWindow.webContents.send("file-opened", {
    content: "",
    filePath: null,
  });
}

async function openFileDialog() {
  if (!(await confirmUnsaved())) return;
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: "Open Journal File",
    filters: [
      { name: "hledger Journal", extensions: ["journal", "hledger", "j"] },
      { name: "All Files", extensions: ["*"] },
    ],
    properties: ["openFile"],
  });
  if (canceled || filePaths.length === 0) return;
  await openFile(filePaths[0]);
}

async function openFile(filePath) {
  if (!(await confirmUnsaved())) return;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    currentFilePath = filePath;
    unsavedChanges = false;
    clearBackup();
    updateTitle();
    addRecentFile(filePath);
    watchFile(filePath);
    mainWindow.webContents.send("file-opened", { content, filePath });
  } catch (err) {
    await showAppError("Error Opening File", `Could not read file:\n${err.message}`);
  }
}

function hasAllowedJournalExtension(filePath) {
  const ext = path.extname(filePath || "").toLowerCase();
  return ext === ".journal" || ext === ".hledger" || ext === ".j";
}

async function openFileFromDrop(filePath) {
  if (!filePath || typeof filePath !== "string") {
    await showAppError("Drop Error", "No file path was provided.");
    return false;
  }
  if (!hasAllowedJournalExtension(filePath)) {
    await showAppError("Unsupported File", "Only .journal, .hledger, or .j files can be dropped.");
    return false;
  }
  if (!fs.existsSync(filePath)) {
    await showAppError("File Not Found", `Dropped file does not exist:\n${filePath}`);
    return false;
  }
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) {
    await showAppError("Unsupported Drop", "Please drop a file, not a folder.");
    return false;
  }

  await openFile(filePath);
  return true;
}

async function saveFile() {
  if (!currentFilePath) return saveFileAs();
  try {
    const content = await getEditorContent();
    if (content === null) return false;
    stopWatching(); // pause watcher so we don't trigger external-change
    fs.writeFileSync(currentFilePath, content, "utf-8");
    unsavedChanges = false;
    clearBackup();
    updateTitle();
    watchFile(currentFilePath); // resume
    mainWindow.webContents.send("file-saved", currentFilePath);
    return true;
  } catch (err) {
    await showAppError("Error Saving File", `Could not save:\n${err.message}`);
    return false;
  }
}

async function saveFileAs() {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: "Save Journal As",
    defaultPath: currentFilePath || "finances.journal",
    filters: [
      { name: "hledger Journal", extensions: ["journal"] },
      { name: "All Files", extensions: ["*"] },
    ],
  });
  if (canceled || !filePath) return false;
  currentFilePath = filePath;
  addRecentFile(filePath);
  return saveFile();
}

function getEditorContent() {
  return new Promise((resolve) => {
    const responseChannel = `editor-content-${Date.now()}`;
    ipcMain.once(responseChannel, (_, content) => resolve(content));
    mainWindow.webContents.send("request-content", responseChannel);
    // Timeout fallback
    setTimeout(() => resolve(null), 3000);
  });
}

// ─── IPC handlers ──────────────────────────────────────────────────

ipcMain.on("content-changed", () => {
  if (!unsavedChanges) {
    unsavedChanges = true;
    updateTitle();
  }
});

ipcMain.handle("get-recent-files", () => loadRecentFiles());
ipcMain.handle("file:new", () => newFile());
ipcMain.handle("file:open", () => openFileDialog());
ipcMain.handle("file:save", () => saveFile());
ipcMain.handle("file:save-as", () => saveFileAs());
ipcMain.handle("file:open-path", (_, filePath) => openFileFromDrop(filePath));

ipcMain.on("window:minimize", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize();
});

ipcMain.on("window:toggle-maximize", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});

ipcMain.on("window:close", () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
});

ipcMain.handle("window:is-maximized", () => {
  if (!mainWindow || mainWindow.isDestroyed()) return false;
  return mainWindow.isMaximized();
});
ipcMain.handle("settings:get", () => currentSettings);
ipcMain.handle("settings:update", (_, patch) => {
  currentSettings = updateSettings(patch);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("settings-updated", currentSettings);
  }
  return currentSettings;
});
ipcMain.handle("backup:write", (_, payload) => {
  writeBackup({
    timestamp: Date.now(),
    text: payload?.text || "",
    filePath: payload?.filePath || null,
  });
  return true;
});
ipcMain.handle("backup:clear", () => {
  clearBackup();
  return true;
});

function parseIncludeTarget(raw) {
  const withoutComment = raw.replace(/\s+;.*$/, "").trim();
  if (!withoutComment) return null;
  const quoted = withoutComment.match(/^["'](.+)["']$/);
  return quoted ? quoted[1] : withoutComment;
}

function resolveIncludes(content, baseFilePath, visited = new Set(), out = []) {
  if (!baseFilePath) return out;
  const baseDir = path.dirname(baseFilePath);
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^\s*include\s+(.+)$/i);
    if (!m) continue;
    const target = parseIncludeTarget(m[1]);
    if (!target) continue;

    const resolved = path.resolve(baseDir, target);
    if (!fs.existsSync(resolved)) continue;

    let realPath;
    try {
      realPath = fs.realpathSync(resolved);
    } catch {
      realPath = resolved;
    }
    if (visited.has(realPath)) continue;
    visited.add(realPath);

    let includedContent = "";
    try {
      includedContent = fs.readFileSync(realPath, "utf-8");
    } catch {
      continue;
    }

    out.push({ filePath: realPath, content: includedContent });
    resolveIncludes(includedContent, realPath, visited, out);
  }
  return out;
}

ipcMain.handle("resolve-includes", (_, payload) => {
  const content = payload?.content || "";
  const filePath = payload?.filePath || null;
  if (!filePath) return [];
  return resolveIncludes(content, filePath);
});

ipcMain.on("reload-file", () => {
  if (currentFilePath && fs.existsSync(currentFilePath)) {
    const content = fs.readFileSync(currentFilePath, "utf-8");
    mainWindow.webContents.send("file-opened", { content, filePath: currentFilePath });
    unsavedChanges = false;
    updateTitle();
  }
});

// ─── Window creation ───────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 700,
    minHeight: 500,
    backgroundColor: "#1a1d23",
    title: "hledger Editor",
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }

  mainWindow.on("close", async (e) => {
    if (unsavedChanges) {
      e.preventDefault();
      if (await confirmUnsaved()) {
        unsavedChanges = false; // prevent re-trigger
        mainWindow.close();
      }
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
    stopWatching();
  });

  buildMenu();
}

// ─── App lifecycle ─────────────────────────────────────────────────

app.whenReady().then(() => {
  currentSettings = loadSettings();
  createWindow();

  const envLedgerFile = process.env.LEDGER_FILE;
  // Handle file association: opened via double-click on .journal file
  const fileArg = process.argv.find(
    (arg) => arg.endsWith(".journal") || arg.endsWith(".hledger") || arg.endsWith(".j")
  );
  if (envLedgerFile && fs.existsSync(envLedgerFile)) {
    mainWindow.webContents.once("did-finish-load", () => {
      openFile(path.resolve(envLedgerFile));
    });
  } else if (fileArg && fs.existsSync(fileArg)) {
    // Wait for renderer to be ready
    mainWindow.webContents.once("did-finish-load", () => {
      openFile(path.resolve(fileArg));
    });
  }

  const backup = readBackup();
  if (backup && typeof backup.text === "string" && backup.text.length > 0) {
    mainWindow.webContents.once("did-finish-load", () => {
      mainWindow.webContents.send("backup-available", backup);
    });
  }
});

app.on("open-file", (e, filePath) => {
  e.preventDefault();
  if (mainWindow) {
    openFile(filePath);
  }
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
