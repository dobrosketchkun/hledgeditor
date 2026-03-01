/* ─── hledger journal parser ────────────────────────────────────── */

export function parseJournal(text, source = "root") {
  const lines = text.split("\n");
  const transactions = [];
  let current = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "" || trimmed.startsWith(";")) {
      if (current) {
        current.lineEnd = i - 1;
        transactions.push(current);
        current = null;
      }
      continue;
    }

    if (/^\d/.test(line)) {
      if (current) {
        current.lineEnd = i - 1;
        transactions.push(current);
      }
      const match = line.match(/^(\d{4}[-/.]\d{2}[-/.]\d{2})\s+(.*?)(\s+;.*)?$/);
      current = {
        source,
        lineStart: i,
        lineEnd: i,
        dateStr: match ? match[1] : line.split(/\s/)[0],
        description: match ? match[2].trim() : line.replace(/^\S+\s*/, ""),
        postings: [],
        errors: [],
        warnings: [],
      };

      if (!match) {
        const roughDate = line.split(/\s/)[0];
        if (!/^\d{4}[-/.]\d{2}[-/.]\d{2}$/.test(roughDate)) {
          current.errors.push({ line: i, msg: `Invalid date format: "${roughDate}". Use YYYY-MM-DD.`, source });
        }
      } else {
        const parts = match[1].split(/[-/.]/);
        const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        if (isNaN(d.getTime()) || d.getMonth() !== +parts[1] - 1 || d.getDate() !== +parts[2]) {
          current.errors.push({ line: i, msg: `Invalid date: "${match[1]}".`, source });
        }
      }
      continue;
    }

    if (/^\s/.test(line) && current) {
      const noComment = trimmed.replace(/\s+;.*$/, "");
      if (noComment === "") continue;

      const currFirst = /^(.+?)(  +)([-]?)([$€£¥₹₪])([\d,]+\.?\d*)\s*$/;
      let account = null;
      let amount = null;
      let currency = "$";
      let hasAmount = false;

      const m1 = noComment.match(currFirst);
      if (m1) {
        account = m1[1].trim();
        const sign = m1[3] === "-" ? -1 : 1;
        currency = m1[4];
        amount = sign * parseFloat(m1[5].replace(/,/g, ""));
        hasAmount = true;
      } else {
        const m2 = noComment.match(/^(.+?)(  +)([-]?[\d,]+\.?\d*)\s*$/);
        if (m2) {
          account = m2[1].trim();
          amount = parseFloat(m2[3].replace(/,/g, ""));
          hasAmount = true;
        } else {
          account = noComment.trim();
        }
      }

      const leadingSpaces = line.match(/^(\s*)/)[1].length;
      if (leadingSpaces < 2) {
        current.errors.push({ line: i, msg: `Posting must be indented at least 2 spaces.`, source });
      }

      if (hasAmount) {
        const sepMatch = noComment.match(/^(.+?)(\s+)([-]?[$€£¥₹₪]?[\d,]+\.?\d*)$/);
        if (sepMatch && sepMatch[2].length < 2) {
          current.errors.push({ line: i, msg: `Need at least 2 spaces between account name and amount.`, source });
        }
      }

      current.postings.push({ line: i, account: account || noComment, amount, currency, hasAmount, source });
      current.lineEnd = i;
      continue;
    }

    if (current) {
      current.lineEnd = i;
      transactions.push(current);
      current = null;
    }
  }
  if (current) {
    current.lineEnd = lines.length - 1;
    transactions.push(current);
  }

  for (const tx of transactions) {
    if (tx.postings.length < 2) {
      tx.errors.push({ line: tx.lineStart, msg: `Transaction needs at least 2 postings (has ${tx.postings.length}).`, source: tx.source });
    }
    const inferredCount = tx.postings.filter((p) => !p.hasAmount).length;
    if (inferredCount > 1) {
      tx.errors.push({ line: tx.lineStart, msg: `Only one posting can have an inferred (blank) amount. Found ${inferredCount}.`, source: tx.source });
    }
    if (inferredCount === 0 && tx.postings.length >= 2) {
      const sum = tx.postings.reduce((s, p) => s + (p.amount || 0), 0);
      if (Math.abs(sum) > 0.005) {
        tx.errors.push({
          line: tx.lineStart,
          msg: `Transaction doesn't balance. Off by ${sum > 0 ? "+" : ""}${sum.toFixed(2)}.`,
          source: tx.source,
        });
      }
    }
  }

  return transactions;
}

export function collectAccounts(transactions) {
  const counts = {};
  for (const tx of transactions) {
    for (const p of tx.postings) {
      if (p.account) counts[p.account] = (counts[p.account] || 0) + 1;
    }
  }
  return counts;
}

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

export function findTypoWarnings(transactions) {
  const counts = collectAccounts(transactions);
  const accounts = Object.keys(counts);
  const warnings = [];

  for (const [acct, count] of Object.entries(counts)) {
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

export function highlightLine(line, lineIdx, errorLines, warningLines) {
  const hasError = errorLines.has(lineIdx);
  const hasWarning = warningLines.has(lineIdx);

  if (line.trim().startsWith(";")) {
    return { segments: [{ text: line, cls: "cm" }], hasError, hasWarning };
  }

  if (/^\d/.test(line)) {
    const m = line.match(/^(\d{4}[-/.]\d{2}[-/.]\d{2})(\s+)(.*?)(\s+;.*)?$/);
    if (m) {
      const segs = [
        { text: m[1], cls: "dt" },
        { text: m[2], cls: "" },
        { text: m[3], cls: "ds" },
      ];
      if (m[4]) segs.push({ text: m[4], cls: "cm" });
      return { segments: segs, hasError, hasWarning };
    }
    return { segments: [{ text: line, cls: "dt" }], hasError, hasWarning };
  }

  if (/^\s*include\s+/.test(line) && !line.trim().startsWith(";")) {
    const m = line.match(/^(\s*include\s+)(.*)$/);
    if (m) {
      return {
        segments: [
          { text: m[1], cls: "dt" },
          { text: m[2], cls: "ac" },
        ],
        hasError,
        hasWarning,
      };
    }
  }

  if (/^\s/.test(line) && line.trim() !== "") {
    const stripped = line.replace(/(\s+;.*)$/, "");
    const commentPart = line.slice(stripped.length);
    const indent = stripped.match(/^(\s*)/)[1];
    const rest = stripped.slice(indent.length);

    const amtMatch = rest.match(/^(.+?)(  +)([-]?[$€£¥₹₪]?[\d,]+\.?\d*)(\s*)$/);
    if (amtMatch) {
      const segs = [
        { text: indent, cls: "" },
        { text: amtMatch[1], cls: "ac" },
        { text: amtMatch[2], cls: "" },
        { text: amtMatch[3], cls: "am" },
      ];
      if (amtMatch[4]) segs.push({ text: amtMatch[4], cls: "" });
      if (commentPart) segs.push({ text: commentPart, cls: "cm" });
      return { segments: segs, hasError, hasWarning };
    }

    const segs = [
      { text: indent, cls: "" },
      { text: rest, cls: "ac" },
    ];
    if (commentPart) segs.push({ text: commentPart, cls: "cm" });
    return { segments: segs, hasError, hasWarning };
  }

  return { segments: [{ text: line, cls: "" }], hasError, hasWarning };
}
