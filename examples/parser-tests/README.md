# Parser Test Journals

Comprehensive test files covering every feature the hledger-editor parser handles.
Open each file in the editor to verify parsing, highlighting, autocomplete, and error detection.

## Files

- **`01-transactions-basic.journal`**
  Core transaction parsing: date formats, status markers, codes, descriptions,
  postings with inferred amounts, and multi-posting transactions.

- **`02-amounts-and-commodities.journal`**
  Amount/commodity parsing: prefix symbols, suffix symbols, symbol-first,
  negatives, thousands separators, bare numbers, multi-commodity balancing,
  and cost notation.

- **`03-errors-and-warnings.journal`**
  Error detection: invalid dates, single-space separator, too many inferred
  amounts, unbalanced transactions, unparseable amounts, bad indentation,
  and missing account names.

- **`04-comments-and-whitespace.journal`**
  Comment handling: full-line `;` and `#` comments, inline comments on
  transaction headers and postings, blank-line separation, and
  `comment`/`end comment` block directives.

- **`05-includes.journal`** + **`05-includes-sub.journal`**
  Include directive: relative path resolution, included files contributing
  accounts to analysis.

- **`06-account-directives.journal`**
  Account declarations: basic `account`, same-line comments, indented
  subdirectives, interaction with typo detection (declared accounts should
  never be flagged), and autocomplete coverage.

- **`07-periodic-and-auto.journal`**
  Periodic (`~`) transaction rules and auto posting (`=`) rules with their
  postings. Accounts from these should appear in autocomplete.

- **`08-other-directives.journal`**
  All remaining directives: `commodity`, `P` (price), `alias` (basic and
  regex), `end aliases`, `D` (default commodity), `payee`, `tag`,
  `decimal-mark`, `Y` (year), `apply account`, `end apply account`.

- **`09-kitchen-sink.journal`**
  A realistic mixed journal combining directives, transactions, includes,
  comments, and various amount formats to test interplay.

## How to use

- Open a file in hledger-editor.
- Each file's header comments describe the expected parser outcomes.
- If the editor's behaviour differs from the comments, that indicates a
  parser rule mismatch or regression.
