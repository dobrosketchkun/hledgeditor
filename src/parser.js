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
    const key = postingCommodityKey(p);
    const prev = sumsByCommodity.get(key) || 0;
    sumsByCommodity.set(key, prev + (p.amount || 0));
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

export function parseJournal(text, source = "root") {
  const lines = String(text || "").split(/\r\n|\n|\r/);
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

    if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(line)) {
      if (current) {
        current.lineEnd = i - 1;
        transactions.push(current);
      }
      current = startTransaction(line, i, source);
      continue;
    }

    if (/^\s/.test(line) && current) {
      const noComment = removePostingComment(line);
      const postingTextRaw = noComment.trim();
      if (postingTextRaw === "") continue;

      const statusMatch = postingTextRaw.match(/^([*!])\s+(.*)$/);
      const postingText = statusMatch ? statusMatch[2] : postingTextRaw;

      const leadingSpaces = line.match(/^(\s*)/)[1].length;
      if (leadingSpaces < 2) {
        current.errors.push({ line: i, msg: `Posting must be indented at least 2 spaces.`, source });
      }

      const split = splitPosting(postingText);
      const account = split.accountRaw;
      let amount = null;
      let commodity = null;
      let hasAmount = false;
      let amountParseError = false;

      if (!account) {
        current.errors.push({ line: i, msg: `Posting is missing an account name.`, source });
      }

      if (split.amountRaw) {
        const parsedAmount = parseAmountToken(split.amountRaw);
        if (parsedAmount && Number.isFinite(parsedAmount.amount)) {
          amount = parsedAmount.amount;
          commodity = parsedAmount.commodity;
          hasAmount = true;
        } else {
          amountParseError = true;
          hasAmount = true;
          current.errors.push({
            line: i,
            msg: `Could not parse amount "${split.amountRaw}".`,
            source,
          });
        }
      }
      if (split.hadSingleSpaceAmount) {
        current.errors.push({ line: i, msg: `Need at least 2 spaces between account name and amount.`, source });
      }

      current.postings.push({
        line: i,
        account: account || postingText,
        amount,
        commodity,
        hasAmount,
        amountParseError,
        source,
      });
      current.lineEnd = i;
      continue;
    }

    if (/^\s*include\s+(.+)$/i.test(trimmed)) {
      const m = trimmed.match(/^\s*include\s+(.+)$/i);
      const includeTarget = m ? parseIncludeTarget(m[1]) : null;
      if (!includeTarget) {
        const target = m ? m[1] : "";
        if (current) {
          current.errors.push({ line: i, msg: `Invalid include directive: "${target}".`, source });
        }
      }
      if (current) {
        current.lineEnd = i - 1;
        transactions.push(current);
        current = null;
      }
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

  for (const tx of transactions) validateTransaction(tx);

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
  const cleanLine = String(line || "").replace(/\r$/, "");
  const hasError = errorLines.has(lineIdx);
  const hasWarning = warningLines.has(lineIdx);

  if (cleanLine.trim().startsWith(";")) {
    return { segments: [{ text: cleanLine, cls: "cm" }], hasError, hasWarning };
  }

  if (/^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}\b/.test(cleanLine)) {
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

  if (/^\s*include\s+/.test(cleanLine) && !cleanLine.trim().startsWith(";")) {
    const m = cleanLine.match(/^(\s*include\s+)(.*)$/);
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

  if (/^\s/.test(cleanLine) && cleanLine.trim() !== "") {
    const stripped = cleanLine.replace(/(\s+;.*)$/, "");
    const commentPart = cleanLine.slice(stripped.length);
    const indent = stripped.match(/^(\s*)/)[1];
    const rest = stripped.slice(indent.length);

    const amtMatch = rest.match(/^(.+?)(  +)(.+?)(\s*)$/);
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

  return { segments: [{ text: cleanLine, cls: "" }], hasError, hasWarning };
}
