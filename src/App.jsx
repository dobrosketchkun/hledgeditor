import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { parseJournal, collectAccounts, findTypoWarnings, highlightLine } from "./parser.js";
import { getTheme, themeCssVars, THEMES } from "./themes/index.js";

/* ─── styles ─────────────────────────────────────────────────────── */

const C = {
  bg: "var(--bg)",
  bgLight: "var(--bgLight)",
  gutter: "var(--gutter)",
  gutterText: "var(--gutterText)",
  gutterActive: "var(--gutterActive)",
  text: "var(--text)",
  cursor: "var(--cursor)",
  selection: "var(--selection)",
  selectionText: "var(--selectionText)",
  date: "var(--date)",
  desc: "var(--desc)",
  account: "var(--account)",
  amount: "var(--amount)",
  comment: "var(--comment)",
  status: "var(--status)",
  error: "var(--error)",
  errorBg: "var(--errorBg)",
  warning: "var(--warning)",
  warningBg: "var(--warningBg)",
  border: "var(--border)",
  panelBg: "var(--panelBg)",
  accent: "var(--accent)",
  accentSoft: "var(--accentSoft)",
  ghostText: "var(--ghostText)",
  banner: "var(--banner)",
  bannerBorder: "var(--bannerBorder)",
  overlay: "var(--overlay)",
};

const FONT = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace";
const DEFAULT_SETTINGS = {
  theme: { id: "dark", fontSize: 13, lineHeight: 21 },
  editor: { showDirtyMarkers: true, autoSave: false, autoSaveDelayMs: 1500 },
  safety: { backupEnabled: true, backupIntervalSec: 30, keepBackups: 20 },
  shortcuts: {
    "file.open": "Ctrl+O",
    "file.save": "Ctrl+S",
    "file.saveAs": "Ctrl+Shift+S",
    "file.new": "Ctrl+N",
    "help.hotkeys": "F1",
    "editor.find": "Ctrl+F",
    "editor.replace": "Ctrl+H",
    "editor.gotoLine": "Ctrl+G",
    "editor.gotoStart": "Ctrl+Home",
    "editor.gotoEnd": "Ctrl+End",
    "app.settings": "Ctrl+,",
    "editor.toggleComment": "Ctrl+/",
    "editor.toggleStatus": "Ctrl+Shift+Space",
    "editor.duplicateTransaction": "Ctrl+D",
    "app.templatePicker": "Ctrl+T",
    "app.templateManager": "Ctrl+Shift+T",
  },
  templates: [],
};
const COMMAND_LABELS = {
  "file.open": "Open file",
  "file.save": "Save",
  "file.saveAs": "Save as",
  "file.new": "New file",
  "help.hotkeys": "Open hotkeys help",
  "editor.find": "Find",
  "editor.replace": "Replace",
  "editor.gotoLine": "Go to line",
  "editor.gotoStart": "Go to start of file",
  "editor.gotoEnd": "Go to end of file",
  "editor.toggleComment": "Toggle comment",
  "editor.toggleStatus": "Toggle transaction status",
  "editor.duplicateTransaction": "Duplicate transaction",
  "app.templatePicker": "Insert template",
  "app.templateManager": "Manage templates",
  "app.settings": "Open settings",
};
const COMMAND_ORDER = [
  "file.open",
  "file.save",
  "file.saveAs",
  "file.new",
  "editor.find",
  "editor.replace",
  "editor.gotoLine",
  "editor.gotoStart",
  "editor.gotoEnd",
  "editor.toggleComment",
  "editor.toggleStatus",
  "editor.duplicateTransaction",
  "app.templatePicker",
  "app.templateManager",
  "app.settings",
  "help.hotkeys",
];

function mergeSettings(base, patch) {
  return {
    ...base,
    ...patch,
    theme: { ...base.theme, ...(patch?.theme || {}) },
    editor: { ...base.editor, ...(patch?.editor || {}) },
    safety: { ...base.safety, ...(patch?.safety || {}) },
    shortcuts: { ...base.shortcuts, ...(patch?.shortcuts || {}) },
    templates: patch?.templates ?? base.templates ?? [],
  };
}

function normalizeShortcut(input) {
  if (!input) return "";
  return String(input)
    .trim()
    .replace(/\s+/g, "")
    .replace(/CmdOrCtrl/gi, "Ctrl")
    .replace(/CtrlOrCmd/gi, "Ctrl")
    .replace(/Control/gi, "Ctrl")
    .replace(/Command/gi, "Meta");
}

function eventToShortcut(e) {
  const modifierKeys = new Set(["Control", "Shift", "Alt", "Meta"]);
  if (modifierKeys.has(e.key)) return "";
  const keyRaw = e.key.length === 1 ? e.key.toUpperCase() : e.key;
  let key = keyRaw;
  if (key === " ") key = "Space";
  if (key === "Escape") key = "Esc";
  if (key === "ArrowUp") key = "Up";
  if (key === "ArrowDown") key = "Down";
  if (key === "ArrowLeft") key = "Left";
  if (key === "ArrowRight") key = "Right";

  const parts = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return normalizeShortcut(parts.join("+"));
}

function formatShortcut(shortcut) {
  if (!shortcut) return "Unassigned";
  return shortcut.replaceAll("Meta", "Cmd");
}

function escapeRegexLiteral(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/* ─── Error Panel ────────────────────────────────────────────────── */

function ErrorPanel({ errors, warnings, onClickError, onAutofix, panelMode, setPanelMode }) {
  const items = [
    ...errors.map((e) => ({ ...e, type: "error" })),
    ...warnings.map((w) => ({ ...w, type: w.type || "warning" })),
  ].sort((a, b) => a.line - b.line);

  const PEEK = 3;
  const isCollapsed = panelMode === "collapsed";
  const isExpanded = panelMode === "expanded";
  const visible = isExpanded ? items : items.slice(0, PEEK);
  const hidden = items.length - PEEK;

  const badgeBg = items.length === 0 ? "#3a3f4b" : errors.length > 0 ? C.error : C.warning;
  const badgeClr = items.length === 0 ? C.gutterText : "#fff";

  return (
    <div style={{ background: C.panelBg, borderTop: `1px solid ${C.border}`, fontFamily: FONT, fontSize: 12, flexShrink: 0 }}>
      <div
        onClick={() => setPanelMode(isCollapsed ? "peek" : "collapsed")}
        style={{ padding: "7px 16px", color: C.gutterActive, borderBottom: isCollapsed ? "none" : `1px solid ${C.border}`, cursor: "pointer", userSelect: "none", display: "flex", alignItems: "center", gap: 8, transition: "background 0.1s" }}
        onMouseEnter={(e) => (e.currentTarget.style.background = C.bgLight)}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        <span style={{ fontSize: 10, transform: isCollapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 0.15s" }}>▸</span>
        <span style={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", fontSize: 11 }}>Problems</span>
        <span style={{ background: badgeBg, color: badgeClr, padding: "1px 8px", borderRadius: 10, fontSize: 10, fontWeight: 600 }}>{items.length}</span>
        <div style={{ flex: 1 }} />
        {isExpanded && hidden > 0 && (
          <span onClick={(e) => { e.stopPropagation(); setPanelMode("peek"); }} style={{ fontSize: 10, color: C.accent, cursor: "pointer", textTransform: "none", letterSpacing: 0 }}>Collapse</span>
        )}
      </div>

      {!isCollapsed && (
        <>
          <div style={{ overflowY: isExpanded ? "auto" : "hidden", maxHeight: isExpanded ? 180 : PEEK * 36 }}>
            {items.length === 0 && <div style={{ padding: "12px 16px", color: C.gutterText, fontStyle: "italic" }}>No problems. Your journal looks clean.</div>}
            {visible.map((item, idx) => (
              <div key={idx} style={{ padding: "6px 16px", display: "flex", alignItems: "center", gap: 10, cursor: "pointer", borderBottom: `1px solid ${C.border}`, color: C.text, height: 36, transition: "background 0.1s" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = C.bgLight)}
                onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
              >
                <span onClick={() => onClickError(item.line)} style={{ color: item.type === "error" ? C.error : C.warning, fontWeight: 700, fontSize: 10, minWidth: 10, flexShrink: 0 }}>
                  {item.type === "error" ? "●" : "▲"}
                </span>
                <span onClick={() => onClickError(item.line)} style={{ flex: 1, lineHeight: 1.4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.msg}
                </span>
                {item.type === "typo" && item.from && item.to && (
                  <button
                    onClick={(e) => { e.stopPropagation(); onAutofix(item.from, item.to); }}
                    style={{ background: "transparent", border: `1px solid ${C.accentSoft}`, color: C.accent, padding: "2px 10px", borderRadius: 4, fontSize: 10, fontFamily: FONT, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = C.accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accentSoft; }}
                  >Fix → {item.to.split(":").pop()}</button>
                )}
                <span onClick={() => onClickError(item.line)} style={{ color: C.gutterText, fontSize: 11, whiteSpace: "nowrap", flexShrink: 0 }}>Ln {item.line + 1}</span>
              </div>
            ))}
          </div>
          {!isExpanded && hidden > 0 && (
            <div onClick={() => setPanelMode("expanded")} style={{ padding: "5px 16px", textAlign: "center", fontSize: 10, color: C.accent, cursor: "pointer", borderTop: `1px solid ${C.border}`, fontWeight: 500, userSelect: "none", transition: "background 0.1s" }}
              onMouseEnter={(e) => (e.currentTarget.style.background = C.bgLight)}
              onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
            >+{hidden} more — click to show all</div>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Accounts Sidebar ───────────────────────────────────────────── */

function AccountsSidebar({ transactions, highlightedAccounts, onClickAccount }) {
  const counts = collectAccounts(transactions);
  const grouped = {};
  for (const [acct, count] of Object.entries(counts)) {
    const top = acct.split(":")[0];
    if (!grouped[top]) grouped[top] = [];
    grouped[top].push({ acct, count });
  }
  const order = ["assets", "liabilities", "equity", "income", "expenses", "revenue"];
  const sorted = Object.keys(grouped).sort((a, b) => {
    const ai = order.indexOf(a); const bi = order.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  const colors = { assets: "#98c379", liabilities: "#e06c75", equity: "#61afef", income: "#c678dd", revenue: "#c678dd", expenses: "#d19a66" };

  return (
    <div style={{ width: 240, background: C.panelBg, borderLeft: `1px solid ${C.border}`, overflowY: "auto", fontFamily: FONT, fontSize: 11, flexShrink: 0 }}>
      <div style={{ padding: "10px 14px", fontSize: 11, fontWeight: 600, color: C.gutterActive, textTransform: "uppercase", letterSpacing: "0.08em", borderBottom: `1px solid ${C.border}` }}>Accounts</div>
      {sorted.map((group) => (
        <div key={group} style={{ padding: "8px 0" }}>
          <div style={{ padding: "2px 14px 4px", fontWeight: 700, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", color: colors[group] || C.gutterActive }}>{group}</div>
          {grouped[group].sort((a, b) => a.acct.localeCompare(b.acct)).map(({ acct, count }) => {
            const isActive = highlightedAccounts.has(acct);
            return (
              <div
                key={acct}
                onClick={(e) => onClickAccount?.(acct, e)}
                style={{
                  padding: "2px 14px 2px 22px",
                  color: isActive ? C.accent : C.text,
                  display: "flex",
                  justifyContent: "space-between",
                  opacity: isActive ? 1 : count === 1 ? 0.6 : 1,
                  cursor: "pointer",
                  background: isActive ? C.accentSoft : "transparent",
                  borderLeft: isActive ? `3px solid ${C.accent}` : "3px solid transparent",
                  transition: "background 0.12s, border-color 0.12s",
                }}
                onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = C.bgLight; }}
                onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
              >
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{acct.replace(/^[^:]+:/, "")}</span>
                <span style={{ color: C.gutterText, flexShrink: 0 }}>{count}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/* ─── External Change Banner ─────────────────────────────────────── */

function ExternalChangeBanner({ onReload, onDismiss }) {
  return (
    <div style={{ background: C.banner, borderBottom: `1px solid ${C.bannerBorder}`, padding: "8px 16px", fontFamily: FONT, fontSize: 12, color: C.warning, display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
      <span style={{ flex: 1 }}>File changed on disk by another program.</span>
      <button onClick={onReload} style={{ background: C.warning, color: "#1a1d23", border: "none", padding: "3px 12px", borderRadius: 4, fontSize: 11, fontFamily: FONT, fontWeight: 600, cursor: "pointer" }}>Reload</button>
      <button onClick={onDismiss} style={{ background: "transparent", color: C.gutterActive, border: `1px solid ${C.border}`, padding: "3px 12px", borderRadius: 4, fontSize: 11, fontFamily: FONT, cursor: "pointer" }}>Ignore</button>
    </div>
  );
}

/* ─── Hotkeys Modal ──────────────────────────────────────────────── */

function HotkeysModal({ onClose, shortcuts }) {
  const hotkeys = COMMAND_ORDER.map((cmd) => [formatShortcut(shortcuts?.[cmd] || ""), COMMAND_LABELS[cmd] || cmd]);
  hotkeys.push(["Esc", "Close current modal/dialog"]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 30,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "90vw",
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          fontFamily: FONT,
        }}
      >
        <div
          style={{
            padding: "12px 14px",
            borderBottom: `1px solid ${C.border}`,
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          <span style={{ color: C.accent, fontWeight: 700 }}>Hotkeys</span>
          <div style={{ flex: 1 }} />
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              color: C.gutterActive,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              fontFamily: FONT,
              fontSize: 11,
              padding: "2px 8px",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        <div style={{ padding: "10px 14px 12px", color: C.text, fontSize: 12 }}>
          {hotkeys.map(([combo, desc]) => (
            <div key={combo} style={{ display: "flex", alignItems: "center", padding: "6px 0", borderBottom: `1px solid ${C.border}` }}>
              <span style={{ color: C.accent, width: 150, flexShrink: 0 }}>{combo}</span>
              <span>{desc}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── App Dialog Modal ───────────────────────────────────────────── */

function AppDialogModal({ request, onRespond }) {
  if (!request) return null;
  const { kind, payload } = request;

  const title = payload?.title || (kind === "error" ? "Error" : "Confirm");
  const message = payload?.message || "";
  const isError = kind === "error";

  return (
    <div
      onClick={() => onRespond(isError ? "ok" : "cancel")}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 40,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: "90vw",
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          fontFamily: FONT,
          color: C.text,
        }}
      >
        <div style={{ padding: "12px 14px", borderBottom: `1px solid ${C.border}`, fontWeight: 700, color: isError ? C.error : C.warning }}>
          {title}
        </div>
        <div style={{ padding: "12px 14px", fontSize: 12, lineHeight: 1.45, whiteSpace: "pre-wrap" }}>{message}</div>
        <div style={{ padding: "10px 14px 14px", display: "flex", justifyContent: "flex-end", gap: 8 }}>
          {isError ? (
            <button
              onClick={() => onRespond("ok")}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
            >
              OK
            </button>
          ) : (
            <>
              <button
                onClick={() => onRespond("save")}
                style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "5px 12px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
              >
                Save
              </button>
              <button
                onClick={() => onRespond("discard")}
                style={{ background: "transparent", color: C.warning, border: `1px solid ${C.warning}66`, borderRadius: 4, padding: "5px 12px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
              >
                Don&apos;t Save
              </button>
              <button
                onClick={() => onRespond("cancel")}
                style={{ background: "transparent", color: C.gutterActive, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 12px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsModal({ settingsDraft, onChange, onSave, onClose, onStartRecording, recordingCommand, recordingConflict, onOpenTemplateManager }) {
  if (!settingsDraft) return null;
  const shortcutEntries = COMMAND_ORDER
    .map((cmd) => [cmd, settingsDraft.shortcuts?.[cmd] || ""])
    .filter(([cmd]) => COMMAND_LABELS[cmd]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 50,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 760,
          maxWidth: "94vw",
          maxHeight: "90vh",
          overflow: "auto",
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          fontFamily: FONT,
          color: C.text,
          padding: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>Settings</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.gutterActive, borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}>Close</button>
        </div>

        <div style={{ borderTop: `1px solid ${C.border}`, paddingTop: 10 }}>
          <div style={{ fontSize: 11, color: C.gutterActive, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Appearance</div>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
            <label style={{ fontSize: 12 }}>
              Theme{" "}
              <select
                value={settingsDraft.theme.id}
                onChange={(e) => onChange({ theme: { id: e.target.value } })}
                style={{ marginLeft: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", fontFamily: FONT }}
              >
                {Object.keys(THEMES).map((id) => <option key={id} value={id}>{id}</option>)}
              </select>
            </label>
            <label style={{ fontSize: 12 }}>
              Font size{" "}
              <input
                type="number"
                min={10}
                max={24}
                value={settingsDraft.theme.fontSize}
                onChange={(e) => onChange({ theme: { fontSize: Number(e.target.value || 13) } })}
                style={{ width: 70, marginLeft: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", fontFamily: FONT }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              Line height{" "}
              <input
                type="number"
                min={16}
                max={36}
                value={settingsDraft.theme.lineHeight}
                onChange={(e) => onChange({ theme: { lineHeight: Number(e.target.value || 21) } })}
                style={{ width: 70, marginLeft: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", fontFamily: FONT }}
              />
            </label>
          </div>

          <div style={{ fontSize: 11, color: C.gutterActive, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Editing & Safety</div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, marginBottom: 10 }}>
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={settingsDraft.editor.autoSave} onChange={(e) => onChange({ editor: { autoSave: e.target.checked } })} /> Auto-save
            </label>
            <label style={{ fontSize: 12 }}>
              Auto-save delay (ms){" "}
              <input
                type="number"
                min={250}
                max={10000}
                value={settingsDraft.editor.autoSaveDelayMs}
                onChange={(e) => onChange({ editor: { autoSaveDelayMs: Number(e.target.value || 1500) } })}
                style={{ width: 90, marginLeft: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", fontFamily: FONT }}
              />
            </label>
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={settingsDraft.editor.showDirtyMarkers} onChange={(e) => onChange({ editor: { showDirtyMarkers: e.target.checked } })} /> Show unsaved line markers
            </label>
            <label style={{ fontSize: 12 }}>
              <input type="checkbox" checked={settingsDraft.safety.backupEnabled} onChange={(e) => onChange({ safety: { backupEnabled: e.target.checked } })} /> Crash-safe backup
            </label>
            <label style={{ fontSize: 12 }}>
              Backup interval (sec){" "}
              <input
                type="number"
                min={5}
                max={300}
                value={settingsDraft.safety.backupIntervalSec}
                onChange={(e) => onChange({ safety: { backupIntervalSec: Number(e.target.value || 30) } })}
                style={{ width: 90, marginLeft: 6, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "2px 6px", fontFamily: FONT }}
              />
            </label>
          </div>

          <div style={{ fontSize: 11, color: C.gutterActive, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Templates</div>
          <div style={{ marginBottom: 10 }}>
            <button
              onClick={onOpenTemplateManager}
              style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.accent, borderRadius: 4, padding: "4px 10px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}
            >Manage transaction templates</button>
          </div>

          <div style={{ fontSize: 11, color: C.gutterActive, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Shortcuts</div>
          <div style={{ marginBottom: 6, fontSize: 11, color: C.gutterText }}>
            Click Record and press your key combination.
          </div>
          {recordingConflict && (
            <div style={{ marginBottom: 6, padding: "6px 8px", borderRadius: 4, border: `1px solid ${C.warning}`, color: C.warning, fontSize: 11 }}>
              {recordingConflict}
            </div>
          )}
          <div style={{ maxHeight: 220, overflowY: "auto", border: `1px solid ${C.border}`, borderRadius: 6 }}>
            {shortcutEntries.map(([command, shortcut]) => (
              <div key={command} style={{ display: "flex", alignItems: "center", padding: "6px 8px", borderBottom: `1px solid ${C.border}`, gap: 8 }}>
                <span style={{ flex: 1, fontSize: 12 }}>{COMMAND_LABELS[command] || command}</span>
                <span style={{ width: 150, fontSize: 11, color: C.accent, textAlign: "right" }}>{formatShortcut(shortcut)}</span>
                <button
                  onClick={() => onStartRecording(command)}
                  style={{
                    minWidth: 90,
                    background: recordingCommand === command ? C.accent : "transparent",
                    color: recordingCommand === command ? "#fff" : C.gutterActive,
                    border: `1px solid ${recordingCommand === command ? C.accent : C.border}`,
                    borderRadius: 4,
                    padding: "4px 8px",
                    fontFamily: FONT,
                    fontSize: 11,
                    cursor: "pointer",
                  }}
                >
                  {recordingCommand === command ? "Press keys..." : "Record"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12, gap: 8 }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.gutterActive, borderRadius: 4, padding: "5px 10px", fontFamily: FONT, cursor: "pointer", fontSize: 11 }}>Cancel</button>
          <button onClick={onSave} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", fontFamily: FONT, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Save settings</button>
        </div>
      </div>
    </div>
  );
}

function TemplateManagerModal({ templates, onSave, onClose }) {
  const [draft, setDraft] = useState(() => (templates || []).map((t) => ({ ...t })));

  const addTemplate = () => {
    setDraft((prev) => [...prev, { id: Date.now().toString(36), name: "", shortcode: "", body: "" }]);
  };
  const updateField = (idx, field, value) => {
    setDraft((prev) => prev.map((t, i) => (i === idx ? { ...t, [field]: value } : t)));
  };
  const removeTemplate = (idx) => {
    setDraft((prev) => prev.filter((_, i) => i !== idx));
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: C.overlay, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 52 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxWidth: "94vw", maxHeight: "90vh", overflow: "auto", background: C.panelBg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", fontFamily: FONT, color: C.text, padding: 14 }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>Transaction Templates</span>
          <div style={{ flex: 1 }} />
          <button onClick={addTemplate} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "4px 10px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600, marginRight: 8 }}>+ Add template</button>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.gutterActive, borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}>Close</button>
        </div>

        <div style={{ maxHeight: "60vh", overflowY: "auto" }}>
          {draft.length === 0 && (
            <div style={{ padding: "20px 0", textAlign: "center", color: C.gutterText, fontSize: 12, fontStyle: "italic" }}>No templates yet. Click &quot;+ Add template&quot; to create one.</div>
          )}
          {draft.map((tmpl, idx) => (
            <div key={tmpl.id} style={{ border: `1px solid ${C.border}`, borderRadius: 6, padding: 10, marginBottom: 8 }}>
              <div style={{ display: "flex", gap: 8, marginBottom: 6, alignItems: "center" }}>
                <input
                  value={tmpl.name}
                  onChange={(e) => updateField(idx, "name", e.target.value)}
                  placeholder="Template name"
                  style={{ flex: 1, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: 12 }}
                />
                <span style={{ color: C.gutterText, fontSize: 12 }}>&gt;</span>
                <input
                  value={tmpl.shortcode}
                  onChange={(e) => updateField(idx, "shortcode", e.target.value.replace(/\s/g, ""))}
                  placeholder="shortcode"
                  style={{ width: 120, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: 12 }}
                />
                <button
                  onClick={() => removeTemplate(idx)}
                  style={{ background: "transparent", color: C.error, border: `1px solid ${C.error}33`, borderRadius: 4, padding: "4px 8px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}
                >Delete</button>
              </div>
              <textarea
                value={tmpl.body}
                onChange={(e) => updateField(idx, "body", e.target.value)}
                placeholder={"2025-01-01 Description\n    account:one  $100\n    account:two"}
                rows={4}
                style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 8px", fontFamily: FONT, fontSize: 12, resize: "vertical", lineHeight: "1.5", tabSize: 4 }}
              />
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10, gap: 8 }}>
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.gutterActive, borderRadius: 4, padding: "5px 10px", fontFamily: FONT, cursor: "pointer", fontSize: 11 }}>Cancel</button>
          <button onClick={() => onSave(draft)} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", fontFamily: FONT, cursor: "pointer", fontSize: 11, fontWeight: 600 }}>Save templates</button>
        </div>
      </div>
    </div>
  );
}

function TemplatePickerModal({ templates, onInsert, onClose }) {
  const [query, setQuery] = useState("");
  const [selIdx, setSelIdx] = useState(0);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = useMemo(() => {
    if (!query) return templates || [];
    const q = query.toLowerCase();
    return (templates || []).filter(
      (t) => t.name.toLowerCase().includes(q) || t.shortcode.toLowerCase().includes(q)
    );
  }, [templates, query]);

  useEffect(() => { setSelIdx(0); }, [filtered]);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); setSelIdx((i) => Math.min(i + 1, filtered.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelIdx((i) => Math.max(i - 1, 0)); return; }
    if (e.key === "Enter" && filtered.length > 0) {
      e.preventDefault();
      onInsert(filtered[selIdx], e.shiftKey);
      onClose();
    }
  };

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: C.overlay, display: "flex", alignItems: "flex-start", justifyContent: "center", paddingTop: "15vh", zIndex: 52 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: 480, maxWidth: "90vw", background: C.panelBg, border: `1px solid ${C.border}`, borderRadius: 8, boxShadow: "0 14px 40px rgba(0,0,0,0.45)", fontFamily: FONT, color: C.text }}
      >
        <div style={{ padding: "10px 12px", borderBottom: `1px solid ${C.border}` }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search templates..."
            style={{ width: "100%", background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 10px", fontFamily: FONT, fontSize: 12, outline: "none" }}
          />
        </div>
        <div style={{ maxHeight: 260, overflowY: "auto" }}>
          {filtered.length === 0 && (
            <div style={{ padding: "16px 12px", color: C.gutterText, fontSize: 12, fontStyle: "italic", textAlign: "center" }}>
              {(templates || []).length === 0 ? "No templates defined. Use Manage templates to create some." : "No matching templates."}
            </div>
          )}
          {filtered.map((tmpl, idx) => (
            <div
              key={tmpl.id}
              onClick={() => { onInsert(tmpl, false); onClose(); }}
              style={{
                padding: "8px 12px",
                cursor: "pointer",
                background: idx === selIdx ? C.accentSoft : "transparent",
                borderBottom: `1px solid ${C.border}`,
                display: "flex",
                alignItems: "center",
                gap: 10,
                transition: "background 0.1s",
              }}
              onMouseEnter={(e) => { setSelIdx(idx); e.currentTarget.style.background = C.accentSoft; }}
              onMouseLeave={(e) => { if (idx !== selIdx) e.currentTarget.style.background = "transparent"; }}
            >
              <span style={{ flex: 1, fontSize: 12 }}>{tmpl.name || "(unnamed)"}</span>
              <span style={{ color: C.gutterText, fontSize: 11 }}>&gt;{tmpl.shortcode}</span>
            </div>
          ))}
        </div>
        <div style={{ padding: "6px 12px", borderTop: `1px solid ${C.border}`, fontSize: 10, color: C.gutterText, display: "flex", gap: 16 }}>
          <span>Enter — insert at end</span>
          <span>Shift+Enter — insert at cursor</span>
          <span>Esc — close</span>
        </div>
      </div>
    </div>
  );
}

function SmallModal({ title, children, onClose, width = 460 }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 45,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "90vw",
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          boxShadow: "0 14px 40px rgba(0,0,0,0.45)",
          fontFamily: FONT,
          color: C.text,
          padding: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 10 }}>
          <span style={{ color: C.accent, fontWeight: 700 }}>{title}</span>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ background: "transparent", border: `1px solid ${C.border}`, color: C.gutterActive, borderRadius: 4, padding: "3px 8px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}>Close</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function DropOverlay({ active }) {
  if (!active) return null;
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: C.overlay,
        border: `2px dashed ${C.accent}`,
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          background: C.panelBg,
          border: `1px solid ${C.border}`,
          borderRadius: 8,
          padding: "14px 18px",
          fontFamily: FONT,
          color: C.text,
          fontSize: 13,
          boxShadow: "0 10px 28px rgba(0,0,0,0.38)",
        }}
      >
        Drop journal file to open
      </div>
    </div>
  );
}

/* ─── Find / Replace Bar ─────────────────────────────────────────── */

function FindReplaceBar({
  findQuery, setFindQuery, replaceQuery, setReplaceQuery,
  findUseRegex, setFindUseRegex, showReplace,
  onFindNext, onFindPrev, onReplaceCurrent, onReplaceAll,
  onClose, searchRegexError,
}) {
  const inputRef = useRef(null);
  const [pos, setPos] = useState({ x: -1, y: 12 });
  const dragRef = useRef(null);

  useEffect(() => {
    if (pos.x === -1) setPos((p) => ({ ...p, x: window.innerWidth - 490 }));
  }, [pos.x]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onMove = (e) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      dragRef.current = { x: e.clientX, y: e.clientY };
      setPos((p) => ({
        x: Math.max(0, p.x + dx),
        y: Math.max(0, p.y + dy),
      }));
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  const handleKeyDown = (e) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onFindNext(); }
    if (e.key === "Enter" && e.shiftKey) { e.preventDefault(); onFindPrev(); }
  };

  const btnBase = {
    background: "transparent",
    border: `1px solid ${C.border}`,
    borderRadius: 4,
    fontFamily: FONT,
    fontSize: 11,
    cursor: "pointer",
    padding: "4px 8px",
    color: C.gutterActive,
    flexShrink: 0,
  };

  return (
    <div
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 25,
        width: 460,
        maxWidth: "90vw",
        background: C.panelBg,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        boxShadow: "0 6px 24px rgba(0,0,0,0.35)",
        fontFamily: FONT,
        color: C.text,
        fontSize: 12,
      }}
    >
      {/* Drag handle / header */}
      <div
        onMouseDown={(e) => { dragRef.current = { x: e.clientX, y: e.clientY }; }}
        style={{
          padding: "6px 10px",
          display: "flex",
          alignItems: "center",
          cursor: "grab",
          userSelect: "none",
          borderBottom: `1px solid ${C.border}`,
        }}
      >
        <span style={{ color: C.accent, fontWeight: 700, fontSize: 11 }}>
          {showReplace ? "Find & Replace" : "Find"}
        </span>
        <div style={{ flex: 1 }} />
        <button onClick={onClose} style={{ ...btnBase, padding: "2px 7px" }}>Esc</button>
      </div>

      <div style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6 }}>
        {/* Find row */}
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <input
            ref={inputRef}
            value={findQuery}
            onChange={(e) => setFindQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Find"
            style={{
              flex: 1,
              background: C.bg,
              color: C.text,
              border: `1px solid ${C.border}`,
              borderRadius: 4,
              padding: "4px 8px",
              fontFamily: FONT,
              fontSize: 12,
              outline: "none",
            }}
          />
          <button
            disabled={!!searchRegexError}
            onClick={onFindPrev}
            title="Find previous (Shift+Enter)"
            style={{ ...btnBase, opacity: searchRegexError ? 0.45 : 1 }}
          >◂</button>
          <button
            disabled={!!searchRegexError}
            onClick={onFindNext}
            title="Find next (Enter)"
            style={{ ...btnBase, opacity: searchRegexError ? 0.45 : 1 }}
          >▸</button>
        </div>

        {/* Replace row */}
        {showReplace && (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              value={replaceQuery}
              onChange={(e) => setReplaceQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Replace with"
              style={{
                flex: 1,
                background: C.bg,
                color: C.text,
                border: `1px solid ${C.border}`,
                borderRadius: 4,
                padding: "4px 8px",
                fontFamily: FONT,
                fontSize: 12,
                outline: "none",
              }}
            />
            <button
              disabled={!!searchRegexError}
              onClick={onReplaceCurrent}
              title="Replace"
              style={{ ...btnBase, color: C.warning, borderColor: `${C.warning}66`, opacity: searchRegexError ? 0.45 : 1 }}
            >Replace</button>
            <button
              disabled={!!searchRegexError}
              onClick={onReplaceAll}
              title="Replace all"
              style={{ ...btnBase, background: C.accent, color: "#fff", border: "none", fontWeight: 600, opacity: searchRegexError ? 0.45 : 1 }}
            >All</button>
          </div>
        )}

        {/* Options row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <label style={{ fontSize: 11, color: C.gutterActive, display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={findUseRegex}
              onChange={(e) => setFindUseRegex(e.target.checked)}
            />
            Regex
          </label>
          {searchRegexError && (
            <span style={{ fontSize: 10, color: C.error }}>{searchRegexError}</span>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Custom Title Bar ───────────────────────────────────────────── */

function TitleBar({ filePath, onHelp, onSettings, isMaximized, onMinimize, onToggleMaximize, onClose }) {
  const displayPath = filePath || "Untitled";
  return (
    <div
      onDoubleClick={onToggleMaximize}
      style={{
        height: 34,
        background: C.panelBg,
        borderBottom: `1px solid ${C.border}`,
        display: "flex",
        alignItems: "center",
        paddingLeft: 10,
        fontFamily: FONT,
        WebkitAppRegion: "drag",
        userSelect: "none",
        flexShrink: 0,
      }}
    >
      <span style={{ color: C.accent, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>hledgeditor</span>
      <span style={{ color: C.gutterText, fontSize: 11, marginLeft: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "45vw" }}>
        {displayPath}
      </span>
      <div style={{ flex: 1 }} />
      <button
        onClick={onHelp}
        style={{ WebkitAppRegion: "no-drag", width: 24, height: 24, marginRight: 6, borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.gutterActive, fontFamily: FONT, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
        title="Hotkeys"
      >
        ?
      </button>
      <button
        onClick={onSettings}
        style={{ WebkitAppRegion: "no-drag", width: 24, height: 24, marginRight: 6, borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.gutterActive, fontFamily: FONT, fontWeight: 700, cursor: "pointer", fontSize: 12 }}
        title="Settings"
      >
        *
      </button>
      <button
        onClick={onMinimize}
        style={{ WebkitAppRegion: "no-drag", width: 34, height: 28, border: "none", background: "transparent", color: C.gutterActive, cursor: "pointer", fontSize: 12 }}
        title="Minimize"
      >
        _
      </button>
      <button
        onClick={onToggleMaximize}
        style={{ WebkitAppRegion: "no-drag", width: 34, height: 28, border: "none", background: "transparent", color: C.gutterActive, cursor: "pointer", fontSize: 12 }}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        {isMaximized ? "❐" : "□"}
      </button>
      <button
        onClick={onClose}
        style={{ WebkitAppRegion: "no-drag", width: 40, height: 28, border: "none", background: "transparent", color: C.error, cursor: "pointer", fontSize: 12 }}
        title="Close"
      >
        X
      </button>
    </div>
  );
}

function computeDirtyLines(currentText, baselineText) {
  const curr = currentText.split("\n");
  const base = baselineText.split("\n");
  const max = Math.max(curr.length, base.length);
  const dirty = new Set();
  for (let i = 0; i < max; i++) {
    if (curr[i] !== base[i] && i < curr.length) dirty.add(i);
  }
  return dirty;
}

function buildAccountSuggestionModel(fullText, cursorPos, accountNames, prevSuggest) {
  const text = String(fullText || "");
  const pos = Math.max(0, Math.min(cursorPos || 0, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const lineEndRaw = text.indexOf("\n", pos);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);

  if (!/^\s/.test(line)) return null;
  const commentPos = line.indexOf(";");
  const localPos = pos - lineStart;
  if (commentPos >= 0 && localPos > commentPos) return null;

  const lineNoComment = line.replace(/\s+;.*$/, "");
  const indentLen = ((lineNoComment.match(/^(\s*)/) || [""])[0]).length;
  let body = lineNoComment.slice(indentLen);
  let statusPrefixLen = 0;
  const statusMatch = body.match(/^([*!])\s+/);
  if (statusMatch) {
    statusPrefixLen = statusMatch[0].length;
    body = body.slice(statusPrefixLen);
  }

  let bodyCaret = localPos - indentLen - statusPrefixLen;
  if (bodyCaret < 0) return null;

  const amountSepPos = body.search(/\s{2,}/);
  const accountEnd = amountSepPos >= 0 ? amountSepPos : body.length;
  // If caret is after account token (eg user typed spaces), clamp to account end so suggestions still work.
  if (bodyCaret > accountEnd) bodyCaret = accountEnd;

  const typed = body.slice(0, bodyCaret);
  if (!typed || /\s/.test(typed)) return null;

  const typedLower = typed.toLowerCase();
  let matches = accountNames.filter((acct) => acct.toLowerCase().startsWith(typedLower));
  if (matches.length === 0) {
    // Fallback: match by last account segment prefix.
    matches = accountNames.filter((acct) => {
      const tail = acct.split(":").pop() || "";
      return tail.toLowerCase().startsWith(typedLower);
    });
  }

  // Sort matches to put exact matches at the end, so longer suggestions appear first
  matches.sort((a, b) => {
    const aExact = a.toLowerCase() === typedLower;
    const bExact = b.toLowerCase() === typedLower;
    if (aExact && !bExact) return 1;
    if (!aExact && bExact) return -1;
    return a.length - b.length || a.localeCompare(b);
  });

  // Filter out the exact match if it's the ONLY match, to avoid useless ghost state
  if (matches.length === 1 && matches[0].toLowerCase() === typedLower) {
    return null;
  }

  matches = matches.slice(0, 8);
  if (matches.length === 0) return null;

  const replaceStart = lineStart + indentLen + statusPrefixLen;
  const replaceEnd = replaceStart + accountEnd;
  const sameAnchor =
    prevSuggest &&
    prevSuggest.replaceStart === replaceStart &&
    prevSuggest.replaceEnd === replaceEnd &&
    prevSuggest.typed === typed;

  return {
    lineIdx: text.slice(0, lineStart).split("\n").length - 1,
    replaceStart,
    replaceEnd,
    typed,
    matches,
    selectedIndex: sameAnchor ? Math.min(prevSuggest.selectedIndex || 0, matches.length - 1) : 0,
  };
}

function sameAccountSuggestion(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.lineIdx !== b.lineIdx) return false;
  if (a.replaceStart !== b.replaceStart || a.replaceEnd !== b.replaceEnd) return false;
  if (a.typed !== b.typed) return false;
  if ((a.selectedIndex || 0) !== (b.selectedIndex || 0)) return false;
  const am = a.matches || [];
  const bm = b.matches || [];
  if (am.length !== bm.length) return false;
  for (let i = 0; i < am.length; i++) {
    if (am[i] !== bm[i]) return false;
  }
  return true;
}

function buildTemplateSuggestionModel(fullText, cursorPos, templates, prevSuggest) {
  if (!templates || templates.length === 0) return null;
  const text = String(fullText || "");
  const pos = Math.max(0, Math.min(cursorPos || 0, text.length));
  const lineStart = text.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
  const lineEndRaw = text.indexOf("\n", pos);
  const lineEnd = lineEndRaw === -1 ? text.length : lineEndRaw;
  const line = text.slice(lineStart, lineEnd);

  if (!line.startsWith(">")) return null;
  const localPos = pos - lineStart;
  const typed = line.slice(1, localPos);
  if (/\s/.test(typed)) return null;

  const typedLower = typed.toLowerCase();
  let matches = templates.filter(
    (t) => t.shortcode && t.shortcode.toLowerCase().startsWith(typedLower)
  );
  if (matches.length === 0) return null;
  matches = matches.slice(0, 8);

  const sameAnchor = prevSuggest && prevSuggest.replaceStart === lineStart && prevSuggest.typed === typed;

  return {
    lineIdx: text.slice(0, lineStart).split("\n").length - 1,
    replaceStart: lineStart,
    replaceEnd: lineEnd,
    typed,
    matches,
    selectedIndex: sameAnchor ? Math.min(prevSuggest.selectedIndex || 0, matches.length - 1) : 0,
  };
}

function renderLineWithFindHighlight(segments, lineStart, activeFindRange) {
  if (!activeFindRange || activeFindRange.start >= activeFindRange.end) {
    return segments.map((seg, idx) => ({
      key: `seg-${idx}`,
      cls: seg.cls || "",
      text: seg.text || "",
      activeFind: false,
    }));
  }

  const out = [];
  let abs = lineStart;
  let partIdx = 0;
  for (const seg of segments) {
    const cls = seg.cls || "";
    const text = seg.text || "";
    if (!text) continue;
    const segStart = abs;
    const segEnd = segStart + text.length;
    if (activeFindRange.end <= segStart || activeFindRange.start >= segEnd) {
      out.push({ key: `seg-${partIdx++}`, cls, text, activeFind: false });
      abs = segEnd;
      continue;
    }

    let local = 0;
    while (local < text.length) {
      const partAbs = segStart + local;
      const isMatch = partAbs >= activeFindRange.start && partAbs < activeFindRange.end;
      let nextAbsBoundary = segEnd;
      if (isMatch) {
        nextAbsBoundary = Math.min(segEnd, activeFindRange.end);
      } else if (activeFindRange.start > partAbs) {
        nextAbsBoundary = Math.min(segEnd, activeFindRange.start);
      }
      const take = nextAbsBoundary - partAbs;
      if (take > 0) {
        out.push({
          key: `seg-${partIdx++}`,
          cls,
          text: text.slice(local, local + take),
          activeFind: isMatch,
        });
      }
      local += Math.max(take, 1);
    }
    abs = segEnd;
  }
  return out;
}

/* ─── Main Editor ────────────────────────────────────────────────── */

export default function App() {
  const [text, setText] = useState("");
  const [filePath, setFilePath] = useState(null);
  const [baselineText, setBaselineText] = useState("");
  const [includedFiles, setIncludedFiles] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsDraft, setSettingsDraft] = useState(null);
  const [showExternalChange, setShowExternalChange] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [showGotoLine, setShowGotoLine] = useState(false);
  const [activeFindRange, setActiveFindRange] = useState(null);
  const [findQuery, setFindQuery] = useState("");
  const [replaceQuery, setReplaceQuery] = useState("");
  const [findUseRegex, setFindUseRegex] = useState(false);
  const [gotoLineInput, setGotoLineInput] = useState("");
  const [backupOffer, setBackupOffer] = useState(null);
  const [accountSuggest, setAccountSuggest] = useState(null);
  const [dragCounter, setDragCounter] = useState(0);
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [appDialogRequest, setAppDialogRequest] = useState(null);
  const [recordingCommand, setRecordingCommand] = useState(null);
  const [recordingConflict, setRecordingConflict] = useState("");
  const [isMaximized, setIsMaximized] = useState(false);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const [templateSuggest, setTemplateSuggest] = useState(null);
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const gutterRef = useRef(null);
  const [cursorLine, setCursorLine] = useState(0);
  const [flashLine, setFlashLine] = useState(null);
  const flashTimerRef = useRef(null);
  const undoRef = useRef({
    stack: [{ text: "", selStart: 0, selEnd: 0 }],
    index: 0,
    lastChangeTime: 0,
    lastChangeType: null,
  });
  const [panelMode, setPanelMode] = useState("peek");
  const [highlightedAccounts, setHighlightedAccounts] = useState(new Set());
  const textRef = useRef(text); // always-current ref for IPC
  const filePathRef = useRef(filePath);

  // Keep ref in sync
  useEffect(() => { textRef.current = text; }, [text]);
  useEffect(() => { filePathRef.current = filePath; }, [filePath]);

  useEffect(() => {
    const getDropPath = (event) => {
      const files = event?.dataTransfer?.files;
      if (files && files.length > 0) {
        const f0 = files[0];
        return f0?.path || null;
      }
      return null;
    };

    const isFileDrag = (event) => {
      const dt = event?.dataTransfer;
      if (!dt) return false;
      if (dt.types) {
        if (typeof dt.types.contains === "function") return dt.types.contains("Files");
        if (typeof dt.types.includes === "function") return dt.types.includes("Files");
        try {
          return Array.from(dt.types).includes("Files");
        } catch {
          // ignore
        }
      }
      return Boolean(dt.files && dt.files.length > 0);
    };

    const onDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => c + 1);
      if (isFileDrag(e)) setShowDropOverlay(true);
    };
    const onDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (isFileDrag(e)) {
        e.dataTransfer.dropEffect = "copy";
        setShowDropOverlay(true);
      } else {
        e.dataTransfer.dropEffect = "none";
      }
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter((c) => {
        const next = Math.max(0, c - 1);
        if (next === 0) setShowDropOverlay(false);
        return next;
      });
    };
    const onDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      setDragCounter(0);
      setShowDropOverlay(false);

      const files = e?.dataTransfer?.files;
      if (!files || files.length !== 1) return;
      const path = getDropPath(e);
      if (!path) return;
      await window.electronAPI?.openFilePath?.(path);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  // ─── Electron IPC ──────────────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onFileOpened(({ content, filePath: fp }) => {
      setText(content);
      setFilePath(fp);
      setBaselineText(content);
      setShowExternalChange(false);
      undoRef.current = {
        stack: [{ text: content, selStart: 0, selEnd: 0 }],
        index: 0,
        lastChangeTime: 0,
        lastChangeType: null,
      };
    });

    api.onFileSaved((fp) => {
      setFilePath(fp);
      setBaselineText(textRef.current);
    });

    api.onFileChangedExternally(() => {
      setShowExternalChange(true);
    });

    api.onRequestContent((responseChannel) => {
      api.sendContent(responseChannel, textRef.current);
    });
    api.onAppDialogRequest((request) => {
      setAppDialogRequest(request || null);
    });
    api.onSettingsUpdated((nextSettings) => {
      setSettings(mergeSettings(DEFAULT_SETTINGS, nextSettings || {}));
    });
    api.onBackupAvailable((payload) => {
      setBackupOffer(payload || null);
    });

    api.isWindowMaximized?.().then((val) => setIsMaximized(Boolean(val)));
    api.getSettings?.().then((loaded) => {
      setSettings(mergeSettings(DEFAULT_SETTINGS, loaded || {}));
    });
  }, []);

  const respondAppDialog = useCallback((result) => {
    setAppDialogRequest((prev) => {
      if (prev?.responseChannel) window.electronAPI?.respondDialog?.(prev.responseChannel, result);
      return null;
    });
  }, []);

  const handleTextChange = useCallback((newText, changeType = "typing", selStart, selEnd) => {
    if (selStart === undefined) {
      selStart = textareaRef.current?.selectionStart ?? 0;
      selEnd = textareaRef.current?.selectionEnd ?? selStart;
    }
    if (selEnd === undefined) selEnd = selStart;

    const undo = undoRef.current;
    const now = Date.now();
    const isTyping = changeType === "typing";
    const wasTyping = undo.lastChangeType === "typing";
    const recentEnough = (now - undo.lastChangeTime) < 1000;

    if (isTyping && wasTyping && recentEnough) {
      undo.stack[undo.index] = { text: newText, selStart, selEnd };
    } else {
      undo.stack = undo.stack.slice(0, undo.index + 1);
      undo.stack.push({ text: newText, selStart, selEnd });
      undo.index++;
      if (undo.stack.length > 500) {
        undo.stack.shift();
        undo.index--;
      }
    }
    undo.lastChangeTime = now;
    undo.lastChangeType = changeType;

    setText(newText);
    if (window.electronAPI) {
      window.electronAPI.notifyContentChanged();
    }
  }, []);

  const performUndo = useCallback(() => {
    const undo = undoRef.current;
    if (undo.index <= 0) return;
    undo.index--;
    undo.lastChangeType = null;
    const state = undo.stack[undo.index];
    setText(state.text);
    if (window.electronAPI) window.electronAPI.notifyContentChanged();
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = state.selStart;
        textareaRef.current.selectionEnd = state.selEnd;
        setCursorLine(state.text.slice(0, state.selStart).split("\n").length - 1);
      }
    });
  }, []);

  const performRedo = useCallback(() => {
    const undo = undoRef.current;
    if (undo.index >= undo.stack.length - 1) return;
    undo.index++;
    undo.lastChangeType = null;
    const state = undo.stack[undo.index];
    setText(state.text);
    if (window.electronAPI) window.electronAPI.notifyContentChanged();
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = state.selStart;
        textareaRef.current.selectionEnd = state.selEnd;
        setCursorLine(state.text.slice(0, state.selStart).split("\n").length - 1);
      }
    });
  }, []);

  const openSettings = useCallback(() => {
    setSettingsDraft(settings);
  }, [settings]);

  const saveSettings = useCallback(async () => {
    const draft = settingsDraft || settings;
    const merged = mergeSettings(DEFAULT_SETTINGS, draft);
    setSettings(merged);
    setSettingsDraft(null);
    await window.electronAPI?.updateSettings?.(merged);
  }, [settingsDraft, settings]);

  const getSearchRegex = useCallback((query, global = true) => {
    if (!query) return { regex: null, error: "" };
    try {
      const source = findUseRegex ? query : escapeRegexLiteral(query);
      const flags = `${global ? "g" : ""}i`;
      return { regex: new RegExp(source, flags), error: "" };
    } catch (err) {
      return { regex: null, error: err?.message || "Invalid regex pattern" };
    }
  }, [findUseRegex]);

  const applyFindNext = useCallback((query) => {
    if (!query || !textareaRef.current) return;
    const { regex } = getSearchRegex(query, true);
    if (!regex) return;
    const area = textareaRef.current;
    const content = textRef.current;
    const from = area.selectionEnd || 0;
    regex.lastIndex = from;
    let match = regex.exec(content);
    if (!match) {
      regex.lastIndex = 0;
      match = regex.exec(content);
    }
    if (match && match[0].length > 0) {
      const idx = match.index;
      const lineIdx = content.slice(0, idx).split("\n").length - 1;
      const matchEnd = idx + match[0].length;
      area.selectionStart = idx;
      area.selectionEnd = matchEnd;
      const targetTop = Math.max(
        0,
        lineIdx * settings.theme.lineHeight - Math.max(40, area.clientHeight * 0.35)
      );
      area.scrollTop = targetTop;
      setCursorLine(lineIdx);
      setActiveFindRange({ start: idx, end: matchEnd });
    } else {
      setActiveFindRange(null);
    }
  }, [getSearchRegex, settings.theme.lineHeight]);

  const applyFindPrev = useCallback((query) => {
    if (!query || !textareaRef.current) return;
    const { regex } = getSearchRegex(query, true);
    if (!regex) return;
    const area = textareaRef.current;
    const content = textRef.current;
    const before = area.selectionStart || 0;
    const matches = [];
    let m;
    while ((m = regex.exec(content)) !== null) {
      if (m[0].length === 0) { regex.lastIndex++; continue; }
      matches.push({ index: m.index, length: m[0].length });
    }
    if (matches.length === 0) return;
    let pick = matches[matches.length - 1];
    for (let i = matches.length - 1; i >= 0; i--) {
      if (matches[i].index < before) { pick = matches[i]; break; }
    }
    const lineIdx = content.slice(0, pick.index).split("\n").length - 1;
    area.selectionStart = pick.index;
    area.selectionEnd = pick.index + pick.length;
    const targetTop = Math.max(
      0,
      lineIdx * settings.theme.lineHeight - Math.max(40, area.clientHeight * 0.35)
    );
    area.scrollTop = targetTop;
    setCursorLine(lineIdx);
    setActiveFindRange({ start: pick.index, end: pick.index + pick.length });
  }, [getSearchRegex, settings.theme.lineHeight]);

  const applyReplaceCurrent = useCallback(() => {
    if (!findQuery || !textareaRef.current) return;
    const { regex } = getSearchRegex(findQuery, false);
    if (!regex) return;
    const area = textareaRef.current;
    const content = textRef.current;
    const s = area.selectionStart;
    const e = area.selectionEnd;
    const selected = content.slice(s, e);
    if (selected && regex.test(selected)) {
      const replaced = selected.replace(regex, replaceQuery);
      const next = content.slice(0, s) + replaced + content.slice(e);
      handleTextChange(next, "command", s, s + replaced.length);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = s;
          textareaRef.current.selectionEnd = s + replaced.length;
        }
      });
    } else {
      applyFindNext(findQuery);
    }
  }, [findQuery, replaceQuery, handleTextChange, applyFindNext, getSearchRegex]);

  const applyReplaceAll = useCallback(() => {
    if (!findQuery) return;
    const { regex } = getSearchRegex(findQuery, true);
    if (!regex) return;
    handleTextChange(textRef.current.replace(regex, replaceQuery), "command");
  }, [findQuery, replaceQuery, handleTextChange, getSearchRegex]);

  const runCommand = useCallback((command) => {
    if (command === "file.open") window.electronAPI?.openFile?.();
    else if (command === "file.new") window.electronAPI?.newFile?.();
    else if (command === "file.save") window.electronAPI?.saveFile?.();
    else if (command === "file.saveAs") window.electronAPI?.saveFileAs?.();
    else if (command === "help.hotkeys") setShowHotkeys(true);
    else if (command === "app.settings") openSettings();
    else if (command === "editor.find") {
      setShowFind(true);
      setShowReplace(false);
    } else if (command === "editor.replace") {
      setShowFind(true);
      setShowReplace(true);
    }     else if (command === "editor.gotoLine") setShowGotoLine(true);
    else if (command === "editor.gotoStart" && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.selectionStart = 0;
      textareaRef.current.selectionEnd = 0;
      textareaRef.current.scrollTop = 0;
      setCursorLine(0);
    }
    else if (command === "editor.gotoEnd" && textareaRef.current) {
      textareaRef.current.focus();
      const len = textRef.current.length;
      textareaRef.current.selectionStart = len;
      textareaRef.current.selectionEnd = len;
      textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
      setCursorLine(textRef.current.split("\n").length - 1);
    }
    else if (command === "editor.toggleComment" && textareaRef.current) {
      const area = textareaRef.current;
      const content = textRef.current;
      const selStart = area.selectionStart;
      const selEnd = area.selectionEnd;
      const allLines = content.split("\n");

      const startLineIdx = content.slice(0, selStart).split("\n").length - 1;
      let endLineIdx = content.slice(0, selEnd).split("\n").length - 1;
      if (selEnd > selStart && selEnd > 0 && content[selEnd - 1] === "\n") {
        endLineIdx = Math.max(startLineIdx, endLineIdx - 1);
      }

      const targetLines = allLines.slice(startLineIdx, endLineIdx + 1);
      const allCommented = targetLines.every((l) => l.trim() === "" || /^\s*;/.test(l));

      let newLines;
      if (allCommented) {
        newLines = targetLines.map((l) => {
          if (l.trim() === "") return l;
          return l.replace(/^(\s*); ?/, "$1");
        });
      } else {
        newLines = targetLines.map((l) => {
          if (l.trim() === "") return l;
          const ind = l.match(/^(\s*)/)[1];
          return ind + "; " + l.slice(ind.length);
        });
      }

      let startLineOffset = 0;
      for (let i = 0; i < startLineIdx; i++) startLineOffset += allLines[i].length + 1;

      const oldBlock = targetLines.join("\n");
      const newBlock = newLines.join("\n");
      const newText = content.slice(0, startLineOffset) + newBlock + content.slice(startLineOffset + oldBlock.length);

      let newSelStart, newSelEnd;
      if (selStart === selEnd) {
        const lineDiff = newLines[0].length - targetLines[0].length;
        newSelStart = newSelEnd = Math.max(startLineOffset, selStart + lineDiff);
      } else {
        newSelStart = startLineOffset;
        newSelEnd = startLineOffset + newBlock.length;
      }
      handleTextChange(newText, "command", newSelStart, newSelEnd);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newSelStart;
          textareaRef.current.selectionEnd = newSelEnd;
        }
      });
    }
    else if (command === "editor.toggleStatus" && textareaRef.current) {
      const area = textareaRef.current;
      const content = textRef.current;
      const pos = area.selectionStart;
      const allLines = content.split("\n");
      const lineIdx = content.slice(0, pos).split("\n").length - 1;

      let headerIdx = -1;
      for (let i = lineIdx; i >= 0; i--) {
        if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(allLines[i])) {
          headerIdx = i;
          break;
        }
        if (i < lineIdx && (allLines[i].trim() === "" || allLines[i].trim().startsWith(";"))) break;
      }
      if (headerIdx === -1) return;

      const headerLine = allLines[headerIdx];
      let newHeader;
      const sm = headerLine.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+)([*!])(\s+.*)$/);
      if (sm) {
        if (sm[2] === "!") {
          newHeader = sm[1] + "*" + sm[3];
        } else {
          newHeader = sm[1] + sm[3].trimStart();
        }
      } else {
        const dm = headerLine.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\s+)(.*)/);
        if (!dm) return;
        newHeader = dm[1] + "! " + dm[2];
      }

      const diff = newHeader.length - headerLine.length;
      allLines[headerIdx] = newHeader;
      const newText = allLines.join("\n");
      const newPos = Math.max(0, pos + diff);

      handleTextChange(newText, "command", newPos, newPos);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newPos;
          textareaRef.current.selectionEnd = newPos;
        }
      });
    }
    else if (command === "editor.duplicateTransaction" && textareaRef.current) {
      const area = textareaRef.current;
      const content = textRef.current;
      const pos = area.selectionStart;
      const allLines = content.split("\n");
      const lineIdx = content.slice(0, pos).split("\n").length - 1;

      let headerIdx = -1;
      for (let i = lineIdx; i >= 0; i--) {
        if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(allLines[i])) {
          headerIdx = i;
          break;
        }
        if (i < lineIdx && (allLines[i].trim() === "" || allLines[i].trim().startsWith(";"))) break;
      }
      if (headerIdx === -1) return;

      let endIdx = headerIdx;
      for (let i = headerIdx + 1; i < allLines.length; i++) {
        if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(allLines[i])) break;
        if (allLines[i].trim() === "" || (!(/^\s/.test(allLines[i])) && !allLines[i].trim().startsWith(";"))) break;
        endIdx = i;
      }

      const txLines = allLines.slice(headerIdx, endIdx + 1);
      const today = new Date();
      const yyyy = today.getFullYear();
      const mm = String(today.getMonth() + 1).padStart(2, "0");
      const dd = String(today.getDate()).padStart(2, "0");
      const todayStr = `${yyyy}-${mm}-${dd}`;

      txLines[0] = txLines[0].replace(
        /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(\s+)(?:[*!]\s+)?/,
        todayStr + "$2"
      );

      const trimmed = content.replace(/\n+$/, "");
      const appendBlock = txLines.join("\n") + "\n";
      const newText = trimmed + "\n\n" + appendBlock;

      const newHeaderOffset = trimmed.length + 2;
      const newHeaderLine = newText.slice(0, newHeaderOffset).split("\n").length;

      handleTextChange(newText, "command", newHeaderOffset, newHeaderOffset);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = newHeaderOffset;
          textareaRef.current.selectionEnd = newHeaderOffset;
          textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
          setCursorLine(newHeaderLine);
        }
      });
    }
    else if (command === "app.templatePicker") setShowTemplatePicker(true);
    else if (command === "app.templateManager") setShowTemplateManager(true);
  }, [openSettings]);

  useEffect(() => {
    if (!settingsDraft || !recordingCommand) return undefined;
    const onCapture = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") {
        setRecordingCommand(null);
        setRecordingConflict("");
        return;
      }
      const combo = eventToShortcut(e);
      if (!combo) return;
      const shortcuts = settingsDraft.shortcuts || {};
      const conflictCmd = Object.keys(shortcuts).find(
        (cmd) => cmd !== recordingCommand && normalizeShortcut(shortcuts[cmd]) === combo
      );
      if (conflictCmd) {
        setRecordingConflict(
          `"${formatShortcut(combo)}" is already assigned to "${COMMAND_LABELS[conflictCmd] || conflictCmd}".`
        );
        return;
      }
      setRecordingConflict("");
      setSettingsDraft((prev) => mergeSettings(prev || settings, { shortcuts: { [recordingCommand]: combo } }));
      setRecordingCommand(null);
    };
    window.addEventListener("keydown", onCapture, true);
    return () => window.removeEventListener("keydown", onCapture, true);
  }, [settingsDraft, recordingCommand, settings]);

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape" && showHotkeys) {
        setShowHotkeys(false);
        return;
      }
      if (e.key === "Escape" && settingsDraft) {
        if (recordingCommand) {
          setRecordingCommand(null);
          setRecordingConflict("");
        } else {
          setSettingsDraft(null);
        }
        return;
      }
      if (settingsDraft) return;
      if (e.key === "Escape" && showTemplateManager) {
        setShowTemplateManager(false);
        return;
      }
      if (e.key === "Escape" && showTemplatePicker) {
        setShowTemplatePicker(false);
        return;
      }
      if (showTemplateManager || showTemplatePicker) return;
      if (e.key === "Escape" && (showFind || showGotoLine)) {
        setShowFind(false);
        setShowReplace(false);
        setShowGotoLine(false);
        return;
      }
      if (e.key === "Escape" && appDialogRequest) {
        e.preventDefault();
        respondAppDialog(appDialogRequest.kind === "error" ? "ok" : "cancel");
        return;
      }

      const actual = eventToShortcut(e);
      const mappings = settings.shortcuts || {};
      const matched = Object.keys(mappings).find(
        (cmd) => normalizeShortcut(mappings[cmd]) === actual
      );
      if (matched) {
        e.preventDefault();
        runCommand(matched);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHotkeys, settingsDraft, recordingCommand, showFind, showGotoLine, appDialogRequest, respondAppDialog, settings, runCommand, showTemplatePicker, showTemplateManager]);

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    if (!settings.editor.autoSave) return undefined;
    if (!filePath) return undefined;
    if (text === baselineText) return undefined;

    const timer = setTimeout(() => {
      window.electronAPI.saveFile?.();
    }, settings.editor.autoSaveDelayMs);

    return () => clearTimeout(timer);
  }, [settings, filePath, text, baselineText]);

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    if (!settings.safety.backupEnabled) return undefined;
    if (text === baselineText) return undefined;

    const intervalMs = settings.safety.backupIntervalSec * 1000;
    const id = setInterval(() => {
      window.electronAPI.writeBackup?.({
        text: textRef.current,
        filePath: filePathRef.current,
      });
    }, intervalMs);

    return () => clearInterval(id);
  }, [settings, text, baselineText]);

  useEffect(() => {
    if (!window.electronAPI) return;
    if (text === baselineText) window.electronAPI.clearBackup?.();
  }, [text, baselineText]);

  useEffect(() => {
    if (!window.electronAPI || !filePath) {
      setIncludedFiles([]);
      return undefined;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const files = await window.electronAPI.resolveIncludes?.(text, filePath);
        if (!cancelled) setIncludedFiles(Array.isArray(files) ? files : []);
      } catch {
        if (!cancelled) setIncludedFiles([]);
      }
    }, 220);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [text, filePath]);

  // ─── Parse ─────────────────────────────────────────────────────
  const lines = text.split("\n");
  const transactionsRoot = useMemo(() => parseJournal(text, "root"), [text]);
  const transactionsIncluded = useMemo(
    () => includedFiles.flatMap((f) => parseJournal(f.content || "", f.filePath || "include")),
    [includedFiles]
  );
  const transactionsForAnalysis = useMemo(
    () => [...transactionsRoot, ...transactionsIncluded],
    [transactionsRoot, transactionsIncluded]
  );
  const accountNames = useMemo(
    () => Object.keys(collectAccounts(transactionsForAnalysis)).sort((a, b) => a.localeCompare(b)),
    [transactionsForAnalysis]
  );
  const typoWarnings = useMemo(() => findTypoWarnings(transactionsForAnalysis), [transactionsForAnalysis]);
  const rootTypoWarnings = useMemo(
    () => typoWarnings.filter((w) => (w.source || "root") === "root"),
    [typoWarnings]
  );
  const dirtyLines = useMemo(() => computeDirtyLines(text, baselineText), [text, baselineText]);
  const accountHighlightLines = useMemo(() => {
    if (highlightedAccounts.size === 0) return new Set();
    const patterns = [...highlightedAccounts].map(
      (acct) => new RegExp(`(?<=^\\s*(?:[*!]\\s+)?)${escapeRegexLiteral(acct)}(?=\\s|$)`)
    );
    const set = new Set();
    for (let i = 0; i < lines.length; i++) {
      if (/^\s/.test(lines[i])) {
        for (const pat of patterns) {
          if (pat.test(lines[i])) { set.add(i); break; }
        }
      }
    }
    return set;
  }, [highlightedAccounts, lines]);

  const allErrors = [];
  const allWarnings = [...rootTypoWarnings];
  for (const tx of transactionsRoot) {
    allErrors.push(...tx.errors);
    allWarnings.push(...tx.warnings);
  }

  const errorLines = new Set(allErrors.map((e) => e.line));
  const warningLines = new Set(allWarnings.map((w) => w.line));
  const highlighted = lines.map((line, i) => highlightLine(line, i, errorLines, warningLines));
  const lineStartOffsets = useMemo(() => {
    let pos = 0;
    return lines.map((line) => {
      const start = pos;
      pos += line.length + 1;
      return start;
    });
  }, [lines]);

  // ─── Scroll sync ───────────────────────────────────────────────
  const syncScroll = useCallback(() => {
    if (textareaRef.current && highlightRef.current) {
      highlightRef.current.scrollTop = textareaRef.current.scrollTop;
      highlightRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
    if (textareaRef.current && gutterRef.current) {
      gutterRef.current.scrollTop = textareaRef.current.scrollTop;
    }
  }, []);

  const updateCursorLine = useCallback(() => {
    if (!textareaRef.current) return;
    const pos = textareaRef.current.selectionStart;
    const upTo = text.slice(0, pos);
    const currentLineIdx = upTo.split("\n").length - 1;
    setCursorLine(currentLineIdx);
    setAccountSuggest((prev) => {
      const next = buildAccountSuggestionModel(text, pos, accountNames, prev);
      return sameAccountSuggestion(prev, next) ? prev : next;
    });
    setTemplateSuggest((prev) => {
      const next = buildTemplateSuggestionModel(text, pos, settings.templates, prev);
      return next === prev ? prev : next;
    });
  }, [text, accountNames, settings.templates]);

  useEffect(() => { updateCursorLine(); }, [text, updateCursorLine]);
  useEffect(() => {
    if (!showFind || !findQuery) setActiveFindRange(null);
  }, [showFind, findQuery]);

  // ─── Go to line with flash ────────────────────────────────────
  const goToLine = useCallback((lineNum) => {
    if (!textareaRef.current) return;
    const allLines = text.split("\n");
    let pos = 0;
    for (let i = 0; i < lineNum && i < allLines.length; i++) pos += allLines[i].length + 1;
    textareaRef.current.focus();
    textareaRef.current.selectionStart = pos;
    textareaRef.current.selectionEnd = pos;
    textareaRef.current.scrollTop = lineNum * settings.theme.lineHeight - 100;
    setCursorLine(lineNum);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashLine(lineNum);
    flashTimerRef.current = setTimeout(() => setFlashLine(null), 1500);
  }, [text, settings.theme.lineHeight]);

  const jumpToLineFromInput = useCallback(() => {
    const parsed = Number(gotoLineInput);
    if (!Number.isFinite(parsed)) return;
    goToLine(Math.max(0, parsed - 1));
    setShowGotoLine(false);
  }, [gotoLineInput, goToLine]);

  // ─── Autofix ──────────────────────────────────────────────────
  const handleAutofix = useCallback((from, to) => {
    const newText = text.split("\n").map((line) => {
      if (/^\s/.test(line) && line.includes(from)) return line.replace(from, to);
      return line;
    }).join("\n");
    handleTextChange(newText, "command");
  }, [text, handleTextChange]);

  const insertTemplate = useCallback((tmpl, atCursor) => {
    if (!tmpl?.body) return;
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    const body = tmpl.body.replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, todayStr);

    const content = textRef.current;
    let newText, cursorPos;
    if (atCursor && textareaRef.current) {
      const pos = textareaRef.current.selectionStart;
      newText = content.slice(0, pos) + body + "\n" + content.slice(pos);
      cursorPos = pos + body.length + 1;
    } else {
      const trimmed = content.replace(/\n+$/, "");
      newText = trimmed + "\n\n" + body + "\n";
      cursorPos = trimmed.length + 2 + body.length + 1;
    }

    handleTextChange(newText, "command", cursorPos, cursorPos);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = cursorPos;
        textareaRef.current.selectionEnd = cursorPos;
        if (!atCursor) textareaRef.current.scrollTop = textareaRef.current.scrollHeight;
        setCursorLine(newText.slice(0, cursorPos).split("\n").length - 1);
      }
    });
  }, [handleTextChange]);

  const saveTemplates = useCallback(async (newTemplates) => {
    const next = mergeSettings(settings, { templates: newTemplates });
    setSettings(next);
    setShowTemplateManager(false);
    await window.electronAPI?.updateSettings?.(next);
  }, [settings]);

  const lineHeight = settings.theme.lineHeight;
  const fontSize = settings.theme.fontSize;
  const activeTheme = getTheme(settings.theme.id);
  const cssVars = themeCssVars(activeTheme);
  const searchRegexError = useMemo(() => {
    if (!findUseRegex || !findQuery) return "";
    return getSearchRegex(findQuery, true).error || "";
  }, [findUseRegex, findQuery, getSearchRegex]);

  return (
    <div style={{ ...cssVars, height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 8px; height: 8px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 4px; }
        ::-webkit-scrollbar-thumb:hover { background: ${C.gutterText}; }
        .seg-dt { color: ${C.date}; font-weight: 600; }
        .seg-ds { color: ${C.desc}; }
        .seg-ac { color: ${C.account}; }
        .seg-am { color: ${C.amount}; font-weight: 600; }
        .seg-cm { color: ${C.comment}; font-style: italic; }
        .seg-st { color: ${C.status}; font-weight: 600; }
        .seg-gh { color: ${C.ghostText}; }
        .line-error { background: ${C.errorBg}; }
        .line-warning { background: ${C.warningBg}; }
        .line-account-hl { background: ${C.accentSoft}; }
        .find-hit-active { background: ${C.selection}; color: ${C.selectionText}; border-radius: 2px; }
        .textarea-editor::selection { background: ${C.selection}; color: ${C.selectionText}; }
        @keyframes line-flash-anim {
          0% { background: rgba(97,175,239,0.18); box-shadow: inset 3px 0 0 ${C.accent}; }
          55% { background: rgba(97,175,239,0.18); box-shadow: inset 3px 0 0 ${C.accent}; }
          100% { background: transparent; box-shadow: inset 3px 0 0 transparent; }
        }
        .line-flash { animation: line-flash-anim 1.5s ease-out forwards; }
      `}</style>

      {/* External change banner */}
      {showExternalChange && (
        <ExternalChangeBanner
          onReload={() => { window.electronAPI?.reloadFile(); setShowExternalChange(false); }}
          onDismiss={() => setShowExternalChange(false)}
        />
      )}

      {window.electronAPI ? (
        <TitleBar
          filePath={filePath}
          onHelp={() => setShowHotkeys(true)}
          onSettings={openSettings}
          isMaximized={isMaximized}
          onMinimize={() => window.electronAPI?.minimizeWindow?.()}
          onToggleMaximize={async () => {
            window.electronAPI?.toggleMaximizeWindow?.();
            const val = await window.electronAPI?.isWindowMaximized?.();
            setIsMaximized(Boolean(val));
          }}
          onClose={() => window.electronAPI?.closeWindow?.()}
        />
      ) : (
        <div style={{ height: 34, background: C.panelBg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 10px", gap: 10, flexShrink: 0, fontFamily: FONT }}>
          <span style={{ color: C.accent, fontWeight: 700, fontSize: 11 }}>hledgeditor</span>
          <div style={{ flex: 1 }} />
          <button onClick={openSettings} style={{ width: 24, height: 24, borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.gutterActive, fontWeight: 700, fontFamily: FONT, cursor: "pointer", fontSize: 12 }}>
            *
          </button>
          <button onClick={() => setShowHotkeys(true)} style={{ width: 24, height: 24, borderRadius: 4, border: `1px solid ${C.border}`, background: "transparent", color: C.gutterActive, fontWeight: 700, fontFamily: FONT, cursor: "pointer", fontSize: 12 }}>
            ?
          </button>
        </div>
      )}

      {/* Editor + sidebar */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", minHeight: 0 }}>
        <div style={{ flex: 1, position: "relative", overflow: "hidden", display: "flex" }}>
          {/* Gutter */}
          <div ref={gutterRef} style={{ width: 52, background: C.gutter, borderRight: `1px solid ${C.border}`, overflow: "hidden", flexShrink: 0, paddingTop: 8 }}>
            {lines.map((_, i) => {
              const isErr = errorLines.has(i);
              const isWarn = !isErr && warningLines.has(i);
              return (
                <div key={i} style={{ height: lineHeight, lineHeight: lineHeight + "px", fontFamily: FONT, fontSize: 11, textAlign: "right", paddingRight: 8, color: i === cursorLine ? C.gutterActive : isErr ? C.error : isWarn ? C.warning : accountHighlightLines.has(i) ? C.accent : C.gutterText, fontWeight: i === cursorLine ? 600 : 400, position: "relative", background: accountHighlightLines.has(i) ? C.accentSoft : "transparent" }}>
                  {settings.editor.showDirtyMarkers && dirtyLines.has(i) && <span style={{ position: "absolute", left: 1, top: 2, width: 3, height: lineHeight - 4, background: C.amount, borderRadius: 2 }} />}
                  {isErr && <span style={{ position: "absolute", left: 6, color: C.error, fontSize: 8, top: 6 }}>●</span>}
                  {isWarn && <span style={{ position: "absolute", left: 5, color: C.warning, fontSize: 9, top: 5 }}>▲</span>}
                  {i + 1}
                </div>
              );
            })}
          </div>

          {/* Highlight layer */}
          <div ref={highlightRef} aria-hidden="true" style={{ position: "absolute", left: 52, top: 0, right: 0, bottom: 0, overflow: "hidden", paddingTop: 8, paddingLeft: 12, pointerEvents: "none", zIndex: 1 }}>
            {highlighted.map((hl, i) => {
              const lineCls = flashLine === i ? "line-flash" : hl.hasError ? "line-error" : hl.hasWarning ? "line-warning" : accountHighlightLines.has(i) ? "line-account-hl" : "";
              return (
              <div key={flashLine === i ? `${i}-flash` : i} className={lineCls}
                style={{ height: lineHeight, lineHeight: lineHeight + "px", fontFamily: FONT, fontSize, whiteSpace: "pre", paddingRight: 12 }}>
                {renderLineWithFindHighlight(hl.segments, lineStartOffsets[i], activeFindRange).map((seg) => {
                  const clsNames = [];
                  if (seg.cls) clsNames.push(`seg-${seg.cls}`);
                  if (seg.activeFind) clsNames.push("find-hit-active");
                  return (
                    <span key={seg.key} className={clsNames.length ? clsNames.join(" ") : undefined}>
                      {seg.text}
                    </span>
                  );
                })}
                {accountSuggest?.lineIdx === i &&
                  accountSuggest?.matches?.length > 0 &&
                  (() => {
                    const chosen =
                      accountSuggest.matches[accountSuggest.selectedIndex || 0] ||
                      accountSuggest.matches[0];
                    const typed = accountSuggest.typed || "";
                    if (!chosen.toLowerCase().startsWith(typed.toLowerCase())) return null;
                    const suffix = chosen.slice(typed.length);
                    if (!suffix) return null;
                    return (
                    <span className="seg-gh">
                      {suffix}
                    </span>
                    );
                  })()}
                {templateSuggest?.lineIdx === i &&
                  templateSuggest?.matches?.length > 0 &&
                  (() => {
                    const chosen = templateSuggest.matches[templateSuggest.selectedIndex || 0];
                    if (!chosen) return null;
                    const typed = templateSuggest.typed || "";
                    const suffix = chosen.shortcode.slice(typed.length);
                    if (!suffix) return null;
                    return (
                    <span className="seg-gh">
                      {suffix}
                    </span>
                    );
                  })()}
              </div>
              );
            })}
          </div>

          {/* Textarea */}
          <textarea
            className="textarea-editor"
            ref={textareaRef}
            value={text}
            onChange={(e) => handleTextChange(e.target.value)}
            onScroll={syncScroll}
            onClick={updateCursorLine}
            onKeyUp={updateCursorLine}
            spellCheck={false}
            style={{ position: "absolute", left: 52, top: 0, right: 0, bottom: 0, fontFamily: FONT, fontSize, lineHeight: lineHeight + "px", paddingTop: 8, paddingLeft: 12, paddingRight: 12, color: "transparent", caretColor: C.cursor, background: "transparent", border: "none", outline: "none", resize: "none", whiteSpace: "pre", overflowWrap: "normal", overflow: "auto", zIndex: 2, width: "calc(100% - 52px)", tabSize: 4 }}
            onKeyDown={(e) => {
              const primary = e.ctrlKey || e.metaKey;
              const keyLower = String(e.key || "").toLowerCase();
              if (primary && !e.altKey && (keyLower === "z" || keyLower === "y")) {
                e.preventDefault();
                e.stopPropagation();
                const isRedo = keyLower === "y" || (keyLower === "z" && e.shiftKey);
                if (isRedo) performRedo(); else performUndo();
                return;
              }

              if (accountSuggest?.matches?.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setAccountSuggest((prev) => {
                    if (!prev?.matches?.length) return prev;
                    return {
                      ...prev,
                      selectedIndex: ((prev.selectedIndex || 0) + 1) % prev.matches.length,
                    };
                  });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setAccountSuggest((prev) => {
                    if (!prev?.matches?.length) return prev;
                    return {
                      ...prev,
                      selectedIndex:
                        ((prev.selectedIndex || 0) - 1 + prev.matches.length) % prev.matches.length,
                    };
                  });
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setAccountSuggest(null);
                  return;
                }
              }

              if ((e.key === "Tab" || e.key === "Enter" || e.key === "ArrowRight") && accountSuggest?.matches?.length) {
                e.preventDefault();
                const chosen = accountSuggest.matches[accountSuggest.selectedIndex || 0] || accountSuggest.matches[0];
                const content = textRef.current;
                const next = content.slice(0, accountSuggest.replaceStart) + chosen + content.slice(accountSuggest.replaceEnd);
                const caret = accountSuggest.replaceStart + chosen.length;
                handleTextChange(next, "command", caret, caret);
                setAccountSuggest(null);
                requestAnimationFrame(() => {
                  if (textareaRef.current) {
                    textareaRef.current.selectionStart = caret;
                    textareaRef.current.selectionEnd = caret;
                    const rebuilt = buildAccountSuggestionModel(next, caret, accountNames, null);
                    setAccountSuggest(rebuilt);
                    setCursorLine(next.slice(0, caret).split("\n").length - 1);
                  }
                });
                return;
              }
              if (templateSuggest?.matches?.length) {
                if (e.key === "ArrowDown") {
                  e.preventDefault();
                  setTemplateSuggest((prev) => {
                    if (!prev?.matches?.length) return prev;
                    return { ...prev, selectedIndex: ((prev.selectedIndex || 0) + 1) % prev.matches.length };
                  });
                  return;
                }
                if (e.key === "ArrowUp") {
                  e.preventDefault();
                  setTemplateSuggest((prev) => {
                    if (!prev?.matches?.length) return prev;
                    return { ...prev, selectedIndex: ((prev.selectedIndex || 0) - 1 + prev.matches.length) % prev.matches.length };
                  });
                  return;
                }
                if (e.key === "Escape") {
                  e.preventDefault();
                  setTemplateSuggest(null);
                  return;
                }
                if (e.key === "Tab" || e.key === "Enter") {
                  e.preventDefault();
                  const chosen = templateSuggest.matches[templateSuggest.selectedIndex || 0];
                  if (chosen?.body) {
                    const today = new Date();
                    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
                    const body = chosen.body.replace(/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}/, todayStr);
                    const content = textRef.current;
                    const newText = content.slice(0, templateSuggest.replaceStart) + body + content.slice(templateSuggest.replaceEnd);
                    const caret = templateSuggest.replaceStart + body.length;
                    handleTextChange(newText, "command", caret, caret);
                    setTemplateSuggest(null);
                    requestAnimationFrame(() => {
                      if (textareaRef.current) {
                        textareaRef.current.selectionStart = caret;
                        textareaRef.current.selectionEnd = caret;
                        setCursorLine(newText.slice(0, caret).split("\n").length - 1);
                      }
                    });
                  }
                  return;
                }
              }
              if (e.key === "Tab") {
                e.preventDefault();
                const start = e.target.selectionStart;
                const end = e.target.selectionEnd;
                const nt = text.slice(0, start) + "    " + text.slice(end);
                handleTextChange(nt, "command", start + 4, start + 4);
                requestAnimationFrame(() => {
                  e.target.selectionStart = e.target.selectionEnd = start + 4;
                });
              }
            }}
          />
        </div>
        <AccountsSidebar
          transactions={transactionsForAnalysis}
          highlightedAccounts={highlightedAccounts}
          onClickAccount={(acct, e) => {
            setHighlightedAccounts((prev) => {
              if (e?.ctrlKey || e?.metaKey) {
                const next = new Set(prev);
                if (next.has(acct)) next.delete(acct);
                else next.add(acct);
                return next;
              }
              if (prev.size === 1 && prev.has(acct)) return new Set();
              return new Set([acct]);
            });
          }}
        />
      </div>

      <ErrorPanel errors={allErrors} warnings={allWarnings} onClickError={goToLine} onAutofix={handleAutofix} panelMode={panelMode} setPanelMode={setPanelMode} />
      {showHotkeys && <HotkeysModal onClose={() => setShowHotkeys(false)} shortcuts={settings.shortcuts} />}
      {settingsDraft && (
        <SettingsModal
          settingsDraft={settingsDraft}
          onChange={(patch) => setSettingsDraft((prev) => mergeSettings(prev || settings, patch))}
          onSave={saveSettings}
          onClose={() => {
            setSettingsDraft(null);
            setRecordingCommand(null);
            setRecordingConflict("");
          }}
          onStartRecording={(command) => {
            setRecordingConflict("");
            setRecordingCommand(command);
          }}
          recordingCommand={recordingCommand}
          recordingConflict={recordingConflict}
          onOpenTemplateManager={() => {
            setSettingsDraft(null);
            setRecordingCommand(null);
            setRecordingConflict("");
            setShowTemplateManager(true);
          }}
        />
      )}
      {showTemplatePicker && (
        <TemplatePickerModal
          templates={settings.templates || []}
          onInsert={(tmpl, atCursor) => insertTemplate(tmpl, atCursor)}
          onClose={() => setShowTemplatePicker(false)}
        />
      )}
      {showTemplateManager && (
        <TemplateManagerModal
          templates={settings.templates || []}
          onSave={saveTemplates}
          onClose={() => setShowTemplateManager(false)}
        />
      )}
      {showFind && (
        <FindReplaceBar
          findQuery={findQuery}
          setFindQuery={setFindQuery}
          replaceQuery={replaceQuery}
          setReplaceQuery={setReplaceQuery}
          findUseRegex={findUseRegex}
          setFindUseRegex={setFindUseRegex}
          showReplace={showReplace}
          onFindNext={() => applyFindNext(findQuery)}
          onFindPrev={() => applyFindPrev(findQuery)}
          onReplaceCurrent={applyReplaceCurrent}
          onReplaceAll={applyReplaceAll}
          onClose={() => { setShowFind(false); setShowReplace(false); }}
          searchRegexError={searchRegexError}
        />
      )}
      {showGotoLine && (
        <SmallModal title="Go To Line" onClose={() => setShowGotoLine(false)} width={360}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={gotoLineInput}
              onChange={(e) => setGotoLineInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") jumpToLineFromInput();
              }}
              placeholder="Line number"
              style={{ flex: 1, background: C.bg, color: C.text, border: `1px solid ${C.border}`, borderRadius: 4, padding: "6px 8px", fontFamily: FONT, fontSize: 12 }}
            />
            <button onClick={jumpToLineFromInput} style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "6px 10px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600 }}>Go</button>
          </div>
        </SmallModal>
      )}
      {backupOffer && (
        <SmallModal title="Recover Unsaved Backup?" onClose={() => setBackupOffer(null)} width={520}>
          <div style={{ fontSize: 12, lineHeight: 1.45, marginBottom: 10 }}>
            A crash backup was found from {new Date(backupOffer.timestamp || Date.now()).toLocaleString()}.
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              onClick={async () => {
                setBackupOffer(null);
                await window.electronAPI?.clearBackup?.();
              }}
              style={{ background: "transparent", color: C.gutterActive, border: `1px solid ${C.border}`, borderRadius: 4, padding: "5px 10px", fontFamily: FONT, fontSize: 11, cursor: "pointer" }}
            >
              Ignore
            </button>
            <button
              onClick={async () => {
                const recoveredText = backupOffer.text || "";
                setText(recoveredText);
                setBaselineText("");
                if (!filePathRef.current && backupOffer.filePath) setFilePath(backupOffer.filePath);
                setBackupOffer(null);
                undoRef.current = {
                  stack: [{ text: recoveredText, selStart: 0, selEnd: 0 }],
                  index: 0,
                  lastChangeTime: 0,
                  lastChangeType: null,
                };
              }}
              style={{ background: C.accent, color: "#fff", border: "none", borderRadius: 4, padding: "5px 10px", fontFamily: FONT, fontSize: 11, cursor: "pointer", fontWeight: 600 }}
            >
              Restore backup
            </button>
          </div>
        </SmallModal>
      )}
      <AppDialogModal request={appDialogRequest} onRespond={respondAppDialog} />
      <DropOverlay active={showDropOverlay} />
    </div>
  );
}
