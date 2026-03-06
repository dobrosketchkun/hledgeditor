/* ─── hledger journal parser ────────────────────────────────────── */

function parseDateFromHeader(line) {
  const m = line.match(
    /^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(?:\s+([*!]))?(?:\s+\(([^)]+)\))?(?:\s+(.*?))?(\s+;.*)?$/
  );
  if (!m) return null;
  return {
    dateStr: m[1],
    status: m[2] || null,
    code: m[3] || null,
    description: (m[4] || "").trim(),
  };
}

function isValidDateString(dateStr) {
  const parts = dateStr.split(/[-/.]/).map((p) => Number(p));
  const [y, m, d] = parts;
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const dt = new Date(y, m - 1, d);
  return !isNaN(dt.getTime()) && dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

function parseIncludeTarget(raw) {
  const withoutComment = raw.replace(/\s+;.*$/, "").trim();
  if (!withoutComment) return null;
  const quoted = withoutComment.match(/^["'](.+)["']$/);
  return quoted ? quoted[1] : withoutComment;
}

function removePostingComment(line) {
  return line.replace(/\s+;.*$/, "");
}

function stripAmountDecorators(token) {
  return token.split(/\s+(?:@@?|=)\s+/)[0].trim();
}

function amountFromParts(sign, numberRaw) {
  const value = Number(numberRaw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  return sign === "-" ? -value : value;
}

function parseAmountToken(rawToken) {
  const token = stripAmountDecorators(rawToken);
  if (!token) return null;

  // $10, -$10, $-10
  let m = token.match(/^([+-]?)([$€£¥₹₪])\s*([\d,]+(?:\.\d+)?)$/);
  if (m) {
    return { amount: amountFromParts(m[1], m[3]), commodity: m[2] };
  }
  m = token.match(/^([$€£¥₹₪])\s*([+-]?)([\d,]+(?:\.\d+)?)$/);
  if (m) {
    return { amount: amountFromParts(m[2], m[3]), commodity: m[1] };
  }

  // 10 USD, -10 USD
  m = token.match(/^([+-]?)([\d,]+(?:\.\d+)?)\s+([^\s]+)$/);
  if (m) {
    return { amount: amountFromParts(m[1], m[2]), commodity: m[3] };
  }

  // USD 10, USD -10
  m = token.match(/^([^\s]+)\s+([+-]?)([\d,]+(?:\.\d+)?)$/);
  if (m) {
    return { amount: amountFromParts(m[2], m[3]), commodity: m[1] };
  }

  // Bare number
  m = token.match(/^([+-]?)([\d,]+(?:\.\d+)?)$/);
  if (m) {
    return { amount: amountFromParts(m[1], m[2]), commodity: null };
  }

  return null;
}

function looksLikeAmountToken(token) {
  if (!token) return false;
  const t = stripAmountDecorators(token);
  return /[0-9]/.test(t) && /^[-+0-9$€£¥₹₪A-Za-z.,_:/]+$/.test(t);
}

function splitPosting(postingText) {
  const twoSpace = postingText.match(/^(.*?)(\s{2,})(\S(?:.*\S)?)\s*$/);
  if (twoSpace) {
    return {
      accountRaw: twoSpace[1].trim(),
      amountRaw: twoSpace[3].trim(),
      hadAtLeastTwoSpaces: true,
      hadSingleSpaceAmount: false,
    };
  }

  const singleSpace = postingText.match(/^(.*\S)\s+(\S+)$/);
  if (singleSpace && looksLikeAmountToken(singleSpace[2])) {
    return {
      accountRaw: singleSpace[1].trim(),
      amountRaw: singleSpace[2].trim(),
      hadAtLeastTwoSpaces: false,
      hadSingleSpaceAmount: true,
    };
  }

  return {
    accountRaw: postingText.trim(),
    amountRaw: null,
    hadAtLeastTwoSpaces: false,
    hadSingleSpaceAmount: false,
  };
}

function startTransaction(line, i, source) {
  const parsed = parseDateFromHeader(line);
  const dateStr = parsed ? parsed.dateStr : line.split(/\s+/)[0];
  const tx = {
    source,
    lineStart: i,
    lineEnd: i,
    dateStr,
    description: parsed ? parsed.description : line.replace(/^\S+\s*/, ""),
    postings: [],
    errors: [],
    warnings: [],
  };

  if (!parsed) {
    tx.errors.push({ line: i, msg: `Invalid transaction header. Expected date at start (YYYY-MM-DD).`, source });
    return tx;
  }
  if (!isValidDateString(parsed.dateStr)) {
    tx.errors.push({ line: i, msg: `Invalid date: "${parsed.dateStr}".`, source });
  }
  return tx;
}

function parseCostAnnotation(rawToken) {
  // @@ (total cost) must be checked before @ (per-unit cost)
  let m = rawToken.match(/^(.+?)\s+@@\s+(.+)$/);
  if (m) {
    const cost = parseAmountToken(m[2]);
    if (cost && Number.isFinite(cost.amount)) {
      return { costType: "total", costAmount: cost.amount, costCommodity: cost.commodity };
    }
  }
  m = rawToken.match(/^(.+?)\s+@\s+(.+)$/);
  if (m) {
    const cost = parseAmountToken(m[2]);
    if (cost && Number.isFinite(cost.amount)) {
      return { costType: "unit", costAmount: cost.amount, costCommodity: cost.commodity };
    }
  }
  return null;
}

function postingCommodityKey(p) {
  return p.commodity || "__NO_COMMODITY__";
}

function validateTransaction(tx) {
  if (tx.postings.length < 2) {
    tx.errors.push({
      line: tx.lineStart,
      msg: `Transaction needs at least 2 postings (has ${tx.postings.length}).`,
      source: tx.source,
    });
  }

  const parseErrorCount = tx.postings.filter((p) => p.amountParseError).length;
  const inferredCount = tx.postings.filter((p) => !p.hasAmount && !p.amountParseError).length;

  if (inferredCount > 1) {
    tx.errors.push({
      line: tx.lineStart,
      msg: `Only one posting can have an inferred (blank) amount. Found ${inferredCount}.`,
      source: tx.source,
    });
  }
  if (parseErrorCount > 0) return;
  if (inferredCount !== 0 || tx.postings.length < 2) return;

  const sumsByCommodity = new Map();
  for (const p of tx.postings) {
    if (p.hasCost && p.costCommodity != null) {
      const key = p.costCommodity || "__NO_COMMODITY__";
      const sign = (p.amount || 0) >= 0 ? 1 : -1;
      const contribution = p.costType === "total"
        ? sign * Math.abs(p.costAmount)
        : (p.amount || 0) * p.costAmount;
      sumsByCommodity.set(key, (sumsByCommodity.get(key) || 0) + contribution);
    } else {
      const key = postingCommodityKey(p);
      sumsByCommodity.set(key, (sumsByCommodity.get(key) || 0) + (p.amount || 0));
    }
  }

  const unbalanced = Array.from(sumsByCommodity.entries()).filter(([, sum]) => Math.abs(sum) > 0.005);
  if (unbalanced.length === 0) return;

  const details = unbalanced
    .map(([commodity, sum]) => `${commodity === "__NO_COMMODITY__" ? "(no commodity)" : commodity}: ${sum > 0 ? "+" : ""}${sum.toFixed(2)}`)
    .join(", ");

  tx.errors.push({
    line: tx.lineStart,
    msg: `Transaction doesn't balance. Off by ${details}.`,
    source: tx.source,
  });
}

// Shared posting-line parser for transactions, periodic rules, and auto postings.
// When lenient is true (periodic/auto), amount parse errors and spacing warnings
// are suppressed since those blocks can use special syntax like *-1.
function parsePostingLine(line, i, source, block, lenient) {
  const noComment = removePostingComment(line);
  const postingTextRaw = noComment.trim();
  if (postingTextRaw === "") return;

  const statusMatch = postingTextRaw.match(/^([*!])\s+(.*)$/);
  const postingText = statusMatch ? statusMatch[2] : postingTextRaw;

  const leadingSpaces = line.match(/^(\s*)/)[1].length;
  if (leadingSpaces < 2 && !lenient) {
    block.errors.push({ line: i, msg: `Posting must be indented at least 2 spaces.`, source });
  }

  const split = splitPosting(postingText);
  let account = split.accountRaw;
  let amount = null;
  let commodity = null;
  let hasAmount = false;
  let amountParseError = false;
  let hasCost = false;
  let costType = null;
  let costAmount = null;
  let costCommodity = null;

  // Strip virtual posting wrappers: (account) and [account]
  const virtualMatch = account.match(/^\((.+)\)$|^\[(.+)\]$/);
  if (virtualMatch) account = virtualMatch[1] || virtualMatch[2];

  if (!account && !lenient) {
    block.errors.push({ line: i, msg: `Posting is missing an account name.`, source });
  }

  if (split.amountRaw) {
    const cost = parseCostAnnotation(split.amountRaw);
    if (cost) {
      hasCost = true;
      costType = cost.costType;
      costAmount = cost.costAmount;
      costCommodity = cost.costCommodity;
    }

    const parsedAmount = parseAmountToken(split.amountRaw);
    if (parsedAmount && Number.isFinite(parsedAmount.amount)) {
      amount = parsedAmount.amount;
      commodity = parsedAmount.commodity;
      hasAmount = true;
    } else {
      amountParseError = true;
      hasAmount = true;
      if (!lenient) {
        block.errors.push({ line: i, msg: `Could not parse amount "${split.amountRaw}".`, source });
      }
    }
  }
  if (split.hadSingleSpaceAmount && !lenient) {
    block.errors.push({ line: i, msg: `Need at least 2 spaces between account name and amount.`, source });
  }

  block.postings.push({
    line: i,
    account: account || postingText,
    amount,
    commodity,
    hasAmount,
    amountParseError,
    hasCost,
    costType,
    costAmount,
    costCommodity,
    source,
  });
}

function stripDirectiveComment(rest) {
  return rest.replace(/\s{2,};.*$/, "").trim();
}

/* ─── Main parser ──────────────────────────────────────────────── */

export function parseJournal(text, source = "root") {
  const lines = String(text || "").split(/\r\n|\n|\r/);
  const transactions = [];
  const directives = [];
  let current = null;
  let currentKind = null; // "tx" | "periodic" | "auto" | "directive"
  let commentBlock = null;

  function closeBlock(endLine) {
    if (!current) return;
    if (currentKind === "tx" || currentKind === "periodic" || currentKind === "auto") {
      current.lineEnd = endLine;
    }
    if (currentKind === "tx") transactions.push(current);
    else if (currentKind === "periodic" || currentKind === "auto") directives.push(current);
    current = null;
    currentKind = null;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Inside a comment/end comment block ──
    if (commentBlock) {
      if (trimmed === "end comment") {
        commentBlock.lineEnd = i;
        directives.push(commentBlock);
        commentBlock = null;
      }
      continue;
    }

    // ── Blank lines, ; comments, # comments ──
    if (trimmed === "" || trimmed.startsWith(";") || trimmed.startsWith("#")) {
      closeBlock(i - 1);
      continue;
    }

    // ── "comment" block start ──
    if (trimmed === "comment") {
      closeBlock(i - 1);
      commentBlock = { type: "comment", lineStart: i, lineEnd: i, source };
      continue;
    }

    // ── Transaction header (date at start of line) ──
    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(line)) {
      closeBlock(i - 1);
      current = startTransaction(line, i, source);
      currentKind = "tx";
      continue;
    }

    // ── Periodic transaction: ~ PERIODEXPR ──
    if (/^~(\s|$)/.test(line)) {
      closeBlock(i - 1);
      const periodExpr = line.replace(/^~\s*/, "").replace(/\s{2,}.*$/, "").trim();
      current = { type: "periodic", lineStart: i, lineEnd: i, periodExpr, postings: [], source };
      currentKind = "periodic";
      continue;
    }

    // ── Auto posting rule: = QUERY ──
    if (/^=(\s|$)/.test(line)) {
      closeBlock(i - 1);
      const query = line.replace(/^=\s*/, "").trim();
      current = { type: "auto", lineStart: i, lineEnd: i, query, postings: [], source };
      currentKind = "auto";
      continue;
    }

    // ── Indented lines ──
    if (/^\s/.test(line)) {
      if (current && (currentKind === "tx" || currentKind === "periodic" || currentKind === "auto")) {
        parsePostingLine(line, i, source, current, currentKind !== "tx");
        current.lineEnd = i;
        continue;
      }
      if (currentKind === "directive") {
        continue;
      }
      continue;
    }

    // ── Non-indented, non-date, non-~/= : top-level directives ──
    closeBlock(i - 1);

    let m;

    // include
    if ((m = trimmed.match(/^include\s+(.+)$/i))) {
      const target = parseIncludeTarget(m[1]);
      if (target) directives.push({ type: "include", line: i, target, source });
      continue;
    }

    // account
    if ((m = trimmed.match(/^account\s+(.+)$/))) {
      directives.push({ type: "account", line: i, name: stripDirectiveComment(m[1]), source });
      current = {};
      currentKind = "directive";
      continue;
    }

    // commodity (with argument)
    if ((m = trimmed.match(/^commodity\s+(.+)$/))) {
      const rest = stripDirectiveComment(m[1]);
      let symbol = rest;
      const prefixSym = rest.match(/^([$€£¥₹₪])/);
      if (prefixSym) {
        symbol = prefixSym[1];
      } else {
        const suffixSym = rest.match(/\s+([^\s\d.,]+)$/);
        if (suffixSym) symbol = suffixSym[1];
        else if (!/\d/.test(rest)) symbol = rest;
      }
      directives.push({ type: "commodity", line: i, symbol, source });
      current = {};
      currentKind = "directive";
      continue;
    }

    // commodity (bare keyword, no argument)
    if (trimmed === "commodity") {
      directives.push({ type: "commodity", line: i, symbol: "", source });
      current = {};
      currentKind = "directive";
      continue;
    }

    // payee
    if ((m = trimmed.match(/^payee\s+(.+)$/))) {
      directives.push({ type: "payee", line: i, name: stripDirectiveComment(m[1]), source });
      current = {};
      currentKind = "directive";
      continue;
    }

    // tag
    if ((m = trimmed.match(/^tag\s+(.+)$/))) {
      directives.push({ type: "tag", line: i, name: stripDirectiveComment(m[1]), source });
      current = {};
      currentKind = "directive";
      continue;
    }

    // P (market price): P DATE COMMODITY AMOUNT
    if ((m = trimmed.match(/^P\s+(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s+(\S+)\s+(.+)$/))) {
      directives.push({
        type: "P", line: i, date: m[1], commodity1: m[2],
        amount2: stripDirectiveComment(m[3]), source,
      });
      continue;
    }

    // alias
    if ((m = trimmed.match(/^alias\s+(.+)$/))) {
      const rest = m[1];
      const regexAlias = rest.match(/^\/(.+)\/\s*=\s*(.*)$/);
      if (regexAlias) {
        directives.push({ type: "alias", line: i, from: regexAlias[1], to: regexAlias[2].trim(), isRegex: true, source });
      } else {
        const basicAlias = rest.match(/^(.+?)\s*=\s*(.+)$/);
        if (basicAlias) {
          directives.push({ type: "alias", line: i, from: basicAlias[1].trim(), to: basicAlias[2].trim(), isRegex: false, source });
        } else {
          directives.push({ type: "alias", line: i, from: rest.trim(), to: "", isRegex: false, source });
        }
      }
      continue;
    }

    // end aliases
    if (trimmed === "end aliases") {
      directives.push({ type: "end-aliases", line: i, source });
      continue;
    }

    // D (default commodity)
    if ((m = trimmed.match(/^D\s+(.+)$/))) {
      directives.push({ type: "D", line: i, value: stripDirectiveComment(m[1]), source });
      continue;
    }

    // decimal-mark
    if ((m = trimmed.match(/^decimal-mark\s+(.+)$/))) {
      directives.push({ type: "decimal-mark", line: i, mark: m[1].trim(), source });
      continue;
    }

    // Y (year)
    if ((m = trimmed.match(/^(?:Y|year)\s+(\d{4})\s*$/))) {
      directives.push({ type: "Y", line: i, year: Number(m[1]), source });
      continue;
    }

    // apply account
    if ((m = trimmed.match(/^apply\s+account\s+(.+)$/))) {
      directives.push({ type: "apply-account", line: i, name: stripDirectiveComment(m[1]), source });
      continue;
    }

    // end apply account
    if (trimmed === "end apply account") {
      directives.push({ type: "end-apply-account", line: i, source });
      continue;
    }

    // Unknown top-level line — silently ignored (matches original behaviour)
  }

  // ── Finalize open blocks ──
  if (current) {
    if (currentKind === "tx" || currentKind === "periodic" || currentKind === "auto") {
      current.lineEnd = lines.length - 1;
    }
    if (currentKind === "tx") transactions.push(current);
    else if (currentKind === "periodic" || currentKind === "auto") directives.push(current);
  }
  if (commentBlock) {
    commentBlock.lineEnd = lines.length - 1;
    directives.push(commentBlock);
  }

  for (const tx of transactions) validateTransaction(tx);

  return { transactions, directives };
}

/* ─── Account collection ───────────────────────────────────────── */

export function collectAccounts(transactions, directives = []) {
  const counts = {};
  for (const tx of transactions) {
    for (const p of tx.postings) {
      if (p.account) counts[p.account] = (counts[p.account] || 0) + 1;
    }
  }
  for (const d of directives) {
    if (d.type === "account" && d.name) {
      counts[d.name] = (counts[d.name] || 0) + 1;
    }
    if ((d.type === "periodic" || d.type === "auto") && d.postings) {
      for (const p of d.postings) {
        if (p.account) counts[p.account] = (counts[p.account] || 0) + 1;
      }
    }
  }
  return counts;
}

/* ─── Typo detection ───────────────────────────────────────────── */

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] !== b[j - 1] ? 1 : 0));
  return dp[m][n];
}

export function findTypoWarnings(transactions, directives = []) {
  const declaredAccounts = new Set();
  for (const d of directives) {
    if (d.type === "account" && d.name) declaredAccounts.add(d.name);
  }

  const counts = collectAccounts(transactions, directives);
  const accounts = Object.keys(counts);
  const warnings = [];

  for (const [acct, count] of Object.entries(counts)) {
    if (declaredAccounts.has(acct)) continue;
    if (count === 1 && acct.length > 3) {
      let closest = null;
      let closestDist = Infinity;
      for (const other of accounts) {
        if (other === acct) continue;
        const d = levenshtein(acct.toLowerCase(), other.toLowerCase());
        if (d > 0 && d <= 2 && d < closestDist) {
          closestDist = d;
          closest = other;
        }
      }
      if (closest) {
        for (const tx of transactions) {
          for (const p of tx.postings) {
            if (p.account === acct) {
              warnings.push({
                line: p.line,
                msg: `"${acct}" used only once. Did you mean "${closest}"?`,
                type: "typo",
                from: acct,
                to: closest,
                source: p.source || tx.source || "root",
              });
            }
          }
        }
      }
    }
  }
  return warnings;
}

/* ─── Syntax highlighting ──────────────────────────────────────── */

// Builds a Set of line indices that fall inside comment/end comment blocks
export function buildCommentBlockLines(directives) {
  const set = new Set();
  for (const d of directives) {
    if (d.type === "comment") {
      for (let i = d.lineStart; i <= d.lineEnd; i++) set.add(i);
    }
  }
  return set;
}

const DIRECTIVE_RE = /^(account|commodity|payee|tag|alias|include|decimal-mark)\s+(.*)$/;
const SINGLE_KW_RE = /^(end aliases|end apply account|end comment|comment)$/;
const APPLY_ACCOUNT_RE = /^(apply\s+account)\s+(.+)$/;
const D_RE = /^(D)\s+(.+)$/;
const Y_RE = /^((?:Y|year))\s+(\d{4}.*)$/;
const P_RE = /^(P)\s+(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})\s+(\S+)\s+(.+)$/;
const PERIODIC_RE = /^(~)\s+(.*)$/;
const AUTO_RE = /^(=)\s*(.*)$/;

export function highlightLine(line, lineIdx, errorLines, warningLines, commentBlockLines) {
  const cleanLine = String(line || "").replace(/\r$/, "");
  const hasError = errorLines.has(lineIdx);
  const hasWarning = warningLines.has(lineIdx);

  // Lines inside comment/end comment blocks
  if (commentBlockLines && commentBlockLines.has(lineIdx)) {
    const t = cleanLine.trim();
    if (t === "comment" || t === "end comment") {
      return { segments: [{ text: cleanLine, cls: "dt" }], hasError, hasWarning };
    }
    return { segments: [{ text: cleanLine, cls: "cm" }], hasError, hasWarning };
  }

  // Full-line ; or # comments
  if (cleanLine.trim().startsWith(";") || cleanLine.trim().startsWith("#")) {
    return { segments: [{ text: cleanLine, cls: "cm" }], hasError, hasWarning };
  }

  // Transaction header (date line)
  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(cleanLine)) {
    const ms = cleanLine.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(\s+)([*!])(\s+)(.*?)(\s+;.*)?$/);
    if (ms) {
      const segs = [
        { text: ms[1], cls: "dt" },
        { text: ms[2], cls: "" },
        { text: ms[3], cls: "st" },
        { text: ms[4], cls: "" },
        { text: ms[5], cls: "ds" },
      ];
      if (ms[6]) segs.push({ text: ms[6], cls: "cm" });
      return { segments: segs, hasError, hasWarning };
    }
    const m = cleanLine.match(/^(\d{4}[-/.]\d{1,2}[-/.]\d{1,2})(\s+)(.*?)(\s+;.*)?$/);
    if (m) {
      const segs = [
        { text: m[1], cls: "dt" },
        { text: m[2], cls: "" },
        { text: m[3], cls: "ds" },
      ];
      if (m[4]) segs.push({ text: m[4], cls: "cm" });
      return { segments: segs, hasError, hasWarning };
    }
    return { segments: [{ text: cleanLine, cls: "dt" }], hasError, hasWarning };
  }

  // Non-indented directive lines
  if (!/^\s/.test(cleanLine) && cleanLine.trim() !== "") {
    const t = cleanLine.trim();
    let dm;

    // P DATE COMMODITY AMOUNT
    if ((dm = t.match(P_RE))) {
      const segs = [
        { text: dm[1], cls: "dt" },
        { text: " ", cls: "" },
        { text: dm[2], cls: "dt" },
        { text: " ", cls: "" },
        { text: dm[3], cls: "ac" },
        { text: " ", cls: "" },
        { text: dm[4], cls: "am" },
      ];
      return { segments: segs, hasError, hasWarning };
    }

    // ~ periodic / = auto
    if ((dm = t.match(PERIODIC_RE)) || (dm = t.match(AUTO_RE))) {
      const segs = [
        { text: dm[1], cls: "dt" },
        { text: " ", cls: "" },
        { text: dm[2], cls: "ds" },
      ];
      return { segments: segs, hasError, hasWarning };
    }

    // apply account NAME
    if ((dm = t.match(APPLY_ACCOUNT_RE))) {
      const segs = [
        { text: dm[1], cls: "dt" },
        { text: " ", cls: "" },
        { text: dm[2], cls: "ac" },
      ];
      return { segments: segs, hasError, hasWarning };
    }

    // D AMOUNT / Y YEAR
    if ((dm = t.match(D_RE)) || (dm = t.match(Y_RE))) {
      const segs = [
        { text: dm[1], cls: "dt" },
        { text: " ", cls: "" },
        { text: dm[2], cls: "am" },
      ];
      return { segments: segs, hasError, hasWarning };
    }

    // account, commodity, payee, tag, alias, include, decimal-mark
    if ((dm = t.match(DIRECTIVE_RE))) {
      const keyword = dm[1];
      const rest = dm[2];
      const cls = (keyword === "include" || keyword === "account" || keyword === "alias")
        ? "ac" : (keyword === "commodity" || keyword === "decimal-mark") ? "am" : "ds";
      const commentSplit = rest.match(/^(.*?)(\s{2,};.*)$/);
      if (commentSplit) {
        return {
          segments: [
            { text: keyword, cls: "dt" },
            { text: " ", cls: "" },
            { text: commentSplit[1], cls },
            { text: commentSplit[2], cls: "cm" },
          ],
          hasError, hasWarning,
        };
      }
      return {
        segments: [
          { text: keyword, cls: "dt" },
          { text: " ", cls: "" },
          { text: rest, cls },
        ],
        hasError, hasWarning,
      };
    }

    // Single-keyword directives: end aliases, end apply account, comment, end comment
    if (SINGLE_KW_RE.test(t)) {
      return { segments: [{ text: cleanLine, cls: "dt" }], hasError, hasWarning };
    }
  }

  // Indented posting lines
  if (/^\s/.test(cleanLine) && cleanLine.trim() !== "") {
    const stripped = cleanLine.replace(/(\s+;.*)$/, "");
    const commentPart = cleanLine.slice(stripped.length);
    const indent = stripped.match(/^(\s*)/)[1];
    let rest = stripped.slice(indent.length);

    const stMatch = rest.match(/^([*!])(\s+)/);
    const statusParts = stMatch
      ? [{ text: stMatch[1], cls: "st" }, { text: stMatch[2], cls: "" }]
      : null;
    if (stMatch) rest = rest.slice(stMatch[0].length);

    const amtMatch = rest.match(/^(.+?)(  +)(.+?)(\s*)$/);
    if (amtMatch) {
      const segs = [{ text: indent, cls: "" }];
      if (statusParts) segs.push(...statusParts);
      segs.push(
        { text: amtMatch[1], cls: "ac" },
        { text: amtMatch[2], cls: "" },
        { text: amtMatch[3], cls: "am" },
      );
      if (amtMatch[4]) segs.push({ text: amtMatch[4], cls: "" });
      if (commentPart) segs.push({ text: commentPart, cls: "cm" });
      return { segments: segs, hasError, hasWarning };
    }

    const segs = [{ text: indent, cls: "" }];
    if (statusParts) segs.push(...statusParts);
    segs.push({ text: rest, cls: "ac" });
    if (commentPart) segs.push({ text: commentPart, cls: "cm" });
    return { segments: segs, hasError, hasWarning };
  }

  return { segments: [{ text: cleanLine, cls: "" }], hasError, hasWarning };
}
