const { app, BrowserWindow, ipcMain, dialog, Menu } = require("electron");
const path = require("path");
const fs = require("fs");
const chokidar = require("chokidar");

const isDev = !app.isPackaged;

let mainWindow = null;
let currentFilePath = null;
let fileWatcher = null;
let unsavedChanges = false;

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
    updateTitle();
    addRecentFile(filePath);
    watchFile(filePath);
    mainWindow.webContents.send("file-opened", { content, filePath });
  } catch (err) {
    await showAppError("Error Opening File", `Could not read file:\n${err.message}`);
  }
}

async function saveFile() {
  if (!currentFilePath) return saveFileAs();
  try {
    const content = await getEditorContent();
    if (content === null) return false;
    stopWatching(); // pause watcher so we don't trigger external-change
    fs.writeFileSync(currentFilePath, content, "utf-8");
    unsavedChanges = false;
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
