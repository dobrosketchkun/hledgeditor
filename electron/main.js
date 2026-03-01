const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require("electron");
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
  buildMenu();
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
  const recentFiles = loadRecentFiles();

  const recentSubmenu =
    recentFiles.length > 0
      ? [
          ...recentFiles.map((f) => ({
            label: f,
            click: () => openFile(f),
          })),
          { type: "separator" },
          {
            label: "Clear Recent",
            click: () => {
              saveRecentFiles([]);
              buildMenu();
            },
          },
        ]
      : [{ label: "No recent files", enabled: false }];

  const template = [
    {
      label: "File",
      submenu: [
        {
          label: "New",
          accelerator: "CmdOrCtrl+N",
          click: () => newFile(),
        },
        {
          label: "Open...",
          accelerator: "CmdOrCtrl+O",
          click: () => openFileDialog(),
        },
        {
          label: "Open Recent",
          submenu: recentSubmenu,
        },
        { type: "separator" },
        {
          label: "Save",
          accelerator: "CmdOrCtrl+S",
          click: () => saveFile(),
        },
        {
          label: "Save As...",
          accelerator: "CmdOrCtrl+Shift+S",
          click: () => saveFileAs(),
        },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      label: "Edit",
      submenu: [
        { role: "undo" },
        { role: "redo" },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "selectAll" },
      ],
    },
    {
      label: "View",
      submenu: [
        { role: "zoomIn" },
        { role: "zoomOut" },
        { role: "resetZoom" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(isDev ? [{ type: "separator" }, { role: "toggleDevTools" }] : []),
      ],
    },
    {
      label: "Help",
      submenu: [
        {
          label: "hledger Documentation",
          click: () => shell.openExternal("https://hledger.org/"),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ─── File operations ───────────────────────────────────────────────

async function confirmUnsaved() {
  if (!unsavedChanges) return true;
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: "warning",
    buttons: ["Save", "Don't Save", "Cancel"],
    defaultId: 0,
    cancelId: 2,
    title: "Unsaved Changes",
    message: "You have unsaved changes. What would you like to do?",
  });
  if (response === 0) {
    await saveFile();
    return true;
  }
  if (response === 1) return true;
  return false; // Cancel
}

async function newFile() {
  if (!(await confirmUnsaved())) return;
  currentFilePath = null;
  unsavedChanges = false;
  stopWatching();
  updateTitle();
  mainWindow.webContents.send("file-opened", {
    content: "; New hledger journal\n\n",
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
  openFile(filePaths[0]);
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
    dialog.showErrorBox("Error Opening File", `Could not read file:\n${err.message}`);
  }
}

async function saveFile() {
  if (!currentFilePath) return saveFileAs();
  try {
    const content = await getEditorContent();
    if (content === null) return;
    stopWatching(); // pause watcher so we don't trigger external-change
    fs.writeFileSync(currentFilePath, content, "utf-8");
    unsavedChanges = false;
    updateTitle();
    watchFile(currentFilePath); // resume
    mainWindow.webContents.send("file-saved", currentFilePath);
  } catch (err) {
    dialog.showErrorBox("Error Saving File", `Could not save:\n${err.message}`);
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
  if (canceled || !filePath) return;
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

  // Handle file association: opened via double-click on .journal file
  const fileArg = process.argv.find(
    (arg) => arg.endsWith(".journal") || arg.endsWith(".hledger") || arg.endsWith(".j")
  );
  if (fileArg && fs.existsSync(fileArg)) {
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
