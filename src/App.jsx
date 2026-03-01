import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { parseJournal, collectAccounts, findTypoWarnings, highlightLine } from "./parser.js";

/* ─── styles ─────────────────────────────────────────────────────── */

const C = {
  bg: "#1a1d23",
  bgLight: "#21252b",
  gutter: "#282c34",
  gutterText: "#495162",
  gutterActive: "#636d83",
  text: "#abb2bf",
  cursor: "#528bff",
  selection: "#3e4451",
  date: "#e5c07b",
  desc: "#c8ccd4",
  account: "#61afef",
  amount: "#98c379",
  comment: "#5c6370",
  error: "#e06c75",
  errorBg: "rgba(224,108,117,0.08)",
  warning: "#d19a66",
  warningBg: "rgba(209,154,102,0.08)",
  border: "#2c313a",
  panelBg: "#1e2127",
  accent: "#61afef",
  banner: "#2a1f14",
  bannerBorder: "#5c4a32",
};

const FONT = "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace";

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
                    style={{ background: "transparent", border: `1px solid ${C.accent}44`, color: C.accent, padding: "2px 10px", borderRadius: 4, fontSize: 10, fontFamily: FONT, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", flexShrink: 0, transition: "all 0.15s" }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = C.accent; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = C.accent; }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = C.accent; e.currentTarget.style.borderColor = C.accent + "44"; }}
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

function AccountsSidebar({ transactions }) {
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
          {grouped[group].sort((a, b) => a.acct.localeCompare(b.acct)).map(({ acct, count }) => (
            <div key={acct} style={{ padding: "2px 14px 2px 22px", color: C.text, display: "flex", justifyContent: "space-between", opacity: count === 1 ? 0.6 : 1 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginRight: 8 }}>{acct.replace(/^[^:]+:/, "")}</span>
              <span style={{ color: C.gutterText, flexShrink: 0 }}>{count}</span>
            </div>
          ))}
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

function HotkeysModal({ onClose }) {
  const hotkeys = [
    ["Ctrl/Cmd+O", "Open file"],
    ["Ctrl/Cmd+S", "Save"],
    ["Ctrl/Cmd+Shift+S", "Save as"],
    ["Ctrl/Cmd+N", "New file"],
    ["F1", "Open hotkeys help"],
    ["Esc", "Close modal/dialog"],
  ];

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(8, 10, 14, 0.55)",
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
        background: "rgba(8, 10, 14, 0.55)",
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

/* ─── Custom Title Bar ───────────────────────────────────────────── */

function TitleBar({ filePath, onHelp, isMaximized, onMinimize, onToggleMaximize, onClose }) {
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
      <span style={{ color: C.accent, fontSize: 11, fontWeight: 700, letterSpacing: "0.04em" }}>hledger</span>
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

/* ─── Main Editor ────────────────────────────────────────────────── */

export default function App() {
  const [text, setText] = useState("");
  const [filePath, setFilePath] = useState(null);
  const [baselineText, setBaselineText] = useState("");
  const [includedFiles, setIncludedFiles] = useState([]);
  const [showExternalChange, setShowExternalChange] = useState(false);
  const [showHotkeys, setShowHotkeys] = useState(false);
  const [appDialogRequest, setAppDialogRequest] = useState(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const textareaRef = useRef(null);
  const highlightRef = useRef(null);
  const gutterRef = useRef(null);
  const [cursorLine, setCursorLine] = useState(0);
  const [flashLine, setFlashLine] = useState(null);
  const flashTimerRef = useRef(null);
  const [panelMode, setPanelMode] = useState("peek");
  const textRef = useRef(text); // always-current ref for IPC

  // Keep ref in sync
  useEffect(() => { textRef.current = text; }, [text]);

  // ─── Electron IPC ──────────────────────────────────────────────
  useEffect(() => {
    const api = window.electronAPI;
    if (!api) return;

    api.onFileOpened(({ content, filePath: fp }) => {
      setText(content);
      setFilePath(fp);
      setBaselineText(content);
      setShowExternalChange(false);
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

    api.isWindowMaximized?.().then((val) => setIsMaximized(Boolean(val)));
  }, []);

  const respondAppDialog = useCallback((result) => {
    setAppDialogRequest((prev) => {
      if (prev?.responseChannel) window.electronAPI?.respondDialog?.(prev.responseChannel, result);
      return null;
    });
  }, []);

  const handleTextChange = useCallback((newText) => {
    setText(newText);
    if (window.electronAPI) {
      window.electronAPI.notifyContentChanged();
    }
  }, []);

  useEffect(() => {
    if (!window.electronAPI) return undefined;
    const onKey = (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (e.key === "F1") {
        e.preventDefault();
        setShowHotkeys(true);
        return;
      }
      if (e.key === "Escape" && showHotkeys) {
        setShowHotkeys(false);
        return;
      }
      if (e.key === "Escape" && appDialogRequest) {
        e.preventDefault();
        respondAppDialog(appDialogRequest.kind === "error" ? "ok" : "cancel");
        return;
      }
      if (!mod) return;

      const k = e.key.toLowerCase();
      if (k === "o") {
        e.preventDefault();
        window.electronAPI.openFile?.();
      } else if (k === "n") {
        e.preventDefault();
        window.electronAPI.newFile?.();
      } else if (k === "s" && e.shiftKey) {
        e.preventDefault();
        window.electronAPI.saveFileAs?.();
      } else if (k === "s") {
        e.preventDefault();
        window.electronAPI.saveFile?.();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showHotkeys, appDialogRequest, respondAppDialog]);

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
  const typoWarnings = useMemo(() => findTypoWarnings(transactionsForAnalysis), [transactionsForAnalysis]);
  const rootTypoWarnings = useMemo(
    () => typoWarnings.filter((w) => (w.source || "root") === "root"),
    [typoWarnings]
  );
  const dirtyLines = useMemo(() => computeDirtyLines(text, baselineText), [text, baselineText]);

  const allErrors = [];
  const allWarnings = [...rootTypoWarnings];
  for (const tx of transactionsRoot) {
    allErrors.push(...tx.errors);
    allWarnings.push(...tx.warnings);
  }

  const errorLines = new Set(allErrors.map((e) => e.line));
  const warningLines = new Set(allWarnings.map((w) => w.line));
  const highlighted = lines.map((line, i) => highlightLine(line, i, errorLines, warningLines));

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
    setCursorLine(upTo.split("\n").length - 1);
  }, [text]);

  useEffect(() => { updateCursorLine(); }, [text, updateCursorLine]);

  // ─── Go to line with flash ────────────────────────────────────
  const goToLine = useCallback((lineNum) => {
    if (!textareaRef.current) return;
    const allLines = text.split("\n");
    let pos = 0;
    for (let i = 0; i < lineNum && i < allLines.length; i++) pos += allLines[i].length + 1;
    textareaRef.current.focus();
    textareaRef.current.selectionStart = pos;
    textareaRef.current.selectionEnd = pos;
    textareaRef.current.scrollTop = lineNum * 21 - 100;
    setCursorLine(lineNum);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    setFlashLine(lineNum);
    flashTimerRef.current = setTimeout(() => setFlashLine(null), 1500);
  }, [text]);

  // ─── Autofix ──────────────────────────────────────────────────
  const handleAutofix = useCallback((from, to) => {
    const newText = text.split("\n").map((line) => {
      if (/^\s/.test(line) && line.includes(from)) return line.replace(from, to);
      return line;
    }).join("\n");
    handleTextChange(newText);
  }, [text, handleTextChange]);

  const lineHeight = 21;
  const fontSize = 13;

  return (
    <div style={{ height: "100vh", display: "flex", flexDirection: "column", background: C.bg, color: C.text }}>
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
        .line-error { background: ${C.errorBg}; }
        .line-warning { background: ${C.warningBg}; }
        .textarea-editor::selection { background: rgba(97,175,239,0.30); color: #dbe9ff; }
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
          <span style={{ color: C.accent, fontWeight: 700, fontSize: 11 }}>hledger</span>
          <div style={{ flex: 1 }} />
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
                <div key={i} style={{ height: lineHeight, lineHeight: lineHeight + "px", fontFamily: FONT, fontSize: 11, textAlign: "right", paddingRight: 8, color: i === cursorLine ? C.gutterActive : isErr ? C.error : isWarn ? C.warning : C.gutterText, fontWeight: i === cursorLine ? 600 : 400, position: "relative" }}>
                  {dirtyLines.has(i) && <span style={{ position: "absolute", left: 1, top: 2, width: 3, height: lineHeight - 4, background: "#8bdc8e", borderRadius: 2 }} />}
                  {isErr && <span style={{ position: "absolute", left: 6, color: C.error, fontSize: 8, top: 6 }}>●</span>}
                  {isWarn && <span style={{ position: "absolute", left: 5, color: C.warning, fontSize: 9, top: 5 }}>▲</span>}
                  {i + 1}
                </div>
              );
            })}
          </div>

          {/* Highlight layer */}
          <div ref={highlightRef} aria-hidden="true" style={{ position: "absolute", left: 52, top: 0, right: 0, bottom: 0, overflow: "hidden", paddingTop: 8, paddingLeft: 12, pointerEvents: "none", zIndex: 1 }}>
            {highlighted.map((hl, i) => (
              <div key={flashLine === i ? `${i}-flash` : i} className={flashLine === i ? "line-flash" : hl.hasError ? "line-error" : hl.hasWarning ? "line-warning" : ""}
                style={{ height: lineHeight, lineHeight: lineHeight + "px", fontFamily: FONT, fontSize, whiteSpace: "pre", paddingRight: 12 }}>
                {hl.segments.map((seg, j) => (
                  <span key={j} className={seg.cls ? `seg-${seg.cls}` : undefined}>{seg.text}</span>
                ))}
              </div>
            ))}
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
              if (e.key === "Tab") {
                e.preventDefault();
                const start = e.target.selectionStart;
                const end = e.target.selectionEnd;
                const nt = text.slice(0, start) + "    " + text.slice(end);
                handleTextChange(nt);
                requestAnimationFrame(() => {
                  e.target.selectionStart = e.target.selectionEnd = start + 4;
                });
              }
            }}
          />
        </div>
        <AccountsSidebar transactions={transactionsForAnalysis} />
      </div>

      <ErrorPanel errors={allErrors} warnings={allWarnings} onClickError={goToLine} onAutofix={handleAutofix} panelMode={panelMode} setPanelMode={setPanelMode} />
      {showHotkeys && <HotkeysModal onClose={() => setShowHotkeys(false)} />}
      <AppDialogModal request={appDialogRequest} onRespond={respondAppDialog} />
    </div>
  );
}
