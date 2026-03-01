const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const SETTINGS_VERSION = 1;

const DEFAULT_SETTINGS = {
  version: SETTINGS_VERSION,
  theme: {
    id: "dark",
    fontSize: 13,
    lineHeight: 21,
  },
  editor: {
    showDirtyMarkers: true,
    autoSave: false,
    autoSaveDelayMs: 1500,
  },
  safety: {
    backupEnabled: true,
    backupIntervalSec: 30,
    keepBackups: 20,
  },
  shortcuts: {
    "file.open": "Ctrl+O",
    "file.save": "Ctrl+S",
    "file.saveAs": "Ctrl+Shift+S",
    "file.new": "Ctrl+N",
    "help.hotkeys": "F1",
    "editor.find": "Ctrl+F",
    "editor.replace": "Ctrl+H",
    "editor.gotoLine": "Ctrl+G",
    "app.settings": "Ctrl+,",
  },
};

function getSettingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, patch) {
  if (!isObject(base) || !isObject(patch)) return patch;
  const merged = { ...base };
  for (const key of Object.keys(patch)) {
    const baseValue = merged[key];
    const patchValue = patch[key];
    if (isObject(baseValue) && isObject(patchValue)) {
      merged[key] = deepMerge(baseValue, patchValue);
    } else {
      merged[key] = patchValue;
    }
  }
  return merged;
}

function clampNumber(value, min, max, fallback) {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function sanitizeSettings(raw) {
  const merged = deepMerge(DEFAULT_SETTINGS, isObject(raw) ? raw : {});

  merged.version = SETTINGS_VERSION;
  merged.theme.id = String(merged.theme.id || "dark");
  merged.theme.fontSize = clampNumber(merged.theme.fontSize, 10, 24, DEFAULT_SETTINGS.theme.fontSize);
  merged.theme.lineHeight = clampNumber(merged.theme.lineHeight, 16, 36, DEFAULT_SETTINGS.theme.lineHeight);

  merged.editor.showDirtyMarkers = Boolean(merged.editor.showDirtyMarkers);
  merged.editor.autoSave = Boolean(merged.editor.autoSave);
  merged.editor.autoSaveDelayMs = clampNumber(
    merged.editor.autoSaveDelayMs,
    250,
    10000,
    DEFAULT_SETTINGS.editor.autoSaveDelayMs
  );

  merged.safety.backupEnabled = Boolean(merged.safety.backupEnabled);
  merged.safety.backupIntervalSec = clampNumber(
    merged.safety.backupIntervalSec,
    5,
    300,
    DEFAULT_SETTINGS.safety.backupIntervalSec
  );
  merged.safety.keepBackups = clampNumber(merged.safety.keepBackups, 1, 200, DEFAULT_SETTINGS.safety.keepBackups);

  if (!isObject(merged.shortcuts)) merged.shortcuts = { ...DEFAULT_SETTINGS.shortcuts };

  return merged;
}

function loadSettings() {
  const settingsPath = getSettingsPath();
  try {
    if (fs.existsSync(settingsPath)) {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      return sanitizeSettings(parsed);
    }
  } catch {}
  return sanitizeSettings(DEFAULT_SETTINGS);
}

function saveSettings(settings) {
  const settingsPath = getSettingsPath();
  const sanitized = sanitizeSettings(settings);
  fs.writeFileSync(settingsPath, JSON.stringify(sanitized, null, 2), "utf-8");
  return sanitized;
}

function updateSettings(patch) {
  const current = loadSettings();
  const next = deepMerge(current, isObject(patch) ? patch : {});
  return saveSettings(next);
}

module.exports = {
  DEFAULT_SETTINGS,
  getSettingsPath,
  loadSettings,
  saveSettings,
  updateSettings,
};
