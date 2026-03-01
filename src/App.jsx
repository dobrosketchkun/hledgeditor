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

const STARTER = `; hledger journal
; Edit this file or open a .journal file via File > Open

2026-03-01 Opening balances
    assets:bank:checking              $5,200.00
    assets:bank:savings              $12,000.00
    assets:cash                         $340.00
    liabilities:credit card           $-1,850.00
    equity:opening balances

2026-03-02 Grocery store
    expenses:food:groceries             $67.30
    assets:bank:checking
`;

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

/* ─── Main Editor ────────────────────────────────────────────────── */

export default function App() {
  const [text, setText] = useState(STARTER);
  const [filePath, setFilePath] = useState(null);
  const [showExternalChange, setShowExternalChange] = useState(false);
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
      setShowExternalChange(false);
    });

    api.onFileSaved((fp) => {
      setFilePath(fp);
    });

    api.onFileChangedExternally(() => {
      setShowExternalChange(true);
    });

    api.onRequestContent((responseChannel) => {
      api.sendContent(responseChannel, textRef.current);
    });
  }, []);

  const handleTextChange = useCallback((newText) => {
    setText(newText);
    if (window.electronAPI) {
      window.electronAPI.notifyContentChanged();
    }
  }, []);

  // ─── Parse ─────────────────────────────────────────────────────
  const lines = text.split("\n");
  const transactions = useMemo(() => parseJournal(text), [text]);
  const typoWarnings = useMemo(() => findTypoWarnings(transactions), [transactions]);

  const allErrors = [];
  const allWarnings = [...typoWarnings];
  for (const tx of transactions) {
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
        @keyframes line-flash-anim {
          0% { background: rgba(97,175,239,0.18); box-shadow: inset 3px 0 0 ${C.accent}; }
          55% { background: rgba(97,175,239,0.18); box-shadow: inset 3px 0 0 ${C.accent}; }
          100% { background: transparent; box-shadow: inset 3px 0 0 transparent; }
        }
        .line-flash { animation: line-flash-anim 1.5s ease-out forwards; }
        textarea::selection { background: ${C.selection}; }
      `}</style>

      {/* External change banner */}
      {showExternalChange && (
        <ExternalChangeBanner
          onReload={() => { window.electronAPI?.reloadFile(); setShowExternalChange(false); }}
          onDismiss={() => setShowExternalChange(false)}
        />
      )}

      {/* Top bar — only shown when NOT in Electron (Electron has its own title bar + menu) */}
      {!window.electronAPI && (
        <div style={{ height: 40, background: C.panelBg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 12, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT, fontSize: 12, fontWeight: 700, color: C.accent, letterSpacing: "0.04em" }}>hledger</span>
          <span style={{ fontFamily: FONT, fontSize: 12, color: C.gutterText }}>journal editor</span>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: FONT, fontSize: 11, color: C.gutterText }}>
            Ln {cursorLine + 1} · {transactions.length} txns · {Object.keys(collectAccounts(transactions)).length} accounts
          </span>
        </div>
      )}

      {/* Status bar for Electron (bottom of window style) or inline */}
      {window.electronAPI && (
        <div style={{ height: 28, background: C.panelBg, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", padding: "0 16px", gap: 16, flexShrink: 0 }}>
          <span style={{ fontFamily: FONT, fontSize: 11, color: C.gutterText }}>
            {filePath ? filePath : "Untitled"}
          </span>
          <div style={{ flex: 1 }} />
          <span style={{ fontFamily: FONT, fontSize: 11, color: C.gutterText }}>
            Ln {cursorLine + 1} · {transactions.length} txns · {Object.keys(collectAccounts(transactions)).length} accounts
          </span>
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
        <AccountsSidebar transactions={transactions} />
      </div>

      <ErrorPanel errors={allErrors} warnings={allWarnings} onClickError={goToLine} onAutofix={handleAutofix} panelMode={panelMode} setPanelMode={setPanelMode} />
    </div>
  );
}
