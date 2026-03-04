# hledgeditor

A desktop editor for [hledger](https://hledger.org/) journal files with syntax highlighting, real-time error checking, and a custom frameless UI.

![Main Screen](misc/main_screen.png)

## Features

- **Syntax highlighting** — dates, account names, amounts, comments, status markers, and directives each get distinct colors
- **Real-time error detection:**
  - Unbalanced transactions (including multi-commodity and cost notation)
  - Invalid dates
  - Missing postings
  - Multiple inferred amounts
  - Bad indentation and spacing
- **Typo detection** — flags accounts used only once that look similar to other accounts, with one-click autocorrect. Accounts declared via `account` directives are trusted and never flagged.
- **hledger directive support** — recognizes `account`, `commodity`, `P`, `alias`, `payee`, `tag`, `D`, `decimal-mark`, `Y`, `apply account`, `comment`/`end comment` blocks, periodic transactions (`~`), and auto posting rules (`=`). Declared accounts feed into autocomplete and typo suppression.
- **Smart account autocomplete** — inline ghost-text suggestions based on all accounts across your journal (from transactions, `account` directives, periodic rules, and auto postings). Supports prefix and segment matching.
- **Multi-file `include` support** — automatically resolves and parses included files so suggestions and typo checks span your entire ledger
- **Cost notation** — correctly handles `@` (per-unit) and `@@` (total) cost annotations for balance checking
- **Virtual postings** — `(account)` and `[account]` syntax is recognized; parentheses/brackets are stripped for clean display
- **Customizable theming & settings** — dark/light themes, configurable font sizes, and custom hotkey mapping
- **Auto-save & crash recovery** — optional background auto-save and continuous crash-safe backups
- **Find, replace & go-to-line** — draggable, non-modal search panel with regex support and keyboard-driven workflow
- **Undo / redo** — Ctrl+Z / Ctrl+Y (Ctrl+Shift+Z)
- **Drag & drop** — drag journal files into the window to open them
- **Environment variable support** — automatically opens the file pointed to by `LEDGER_FILE` on startup
- **External change detection** — notifies you if the file is modified by another program
- **Accounts sidebar** — all accounts grouped by type with usage counts; click to highlight lines, Ctrl+click to multi-select
- **Collapsible problems panel** — three display modes (collapsed / peek / expanded)

## Requirements

- [Node.js](https://nodejs.org/) 18 or later
- npm (comes with Node.js)

## Setup

```bash
cd hledgeditor
npm install
```

## Development

Run the app in development mode with hot-reload:

```bash
npm run dev
```

This starts Vite's dev server and launches Electron once it's ready.

## Building

**Windows:**

```bash
npm run build:win
```

Output goes to `release/`. The NSIS installer runs on any Windows machine without Node.js.

**Current platform (macOS / Linux):**

```bash
npm run build
```

On macOS you get a `.dmg`, on Linux an `.AppImage`.

![Setting Screen](misc/settings.png)

## Usage

### Opening files

- **File > Open** (Ctrl+O) — file picker for `.journal`, `.hledger`, `.j` files
- **Drag and drop** — drop files anywhere in the window
- **Command line** — `hledgeditor myfile.journal` (after building)
- **File association** — set `.journal` files to open with hledgeditor

### Editing

- **Autocomplete** — as you type account names, ghost text suggests existing accounts. `Tab` / `Enter` / `ArrowRight` to accept, `ArrowUp` / `ArrowDown` to cycle.
- **Tab** inserts 4 spaces (hledger requires space indentation)
- Errors appear in real-time in the problems panel
- Click any problem to jump to that line
- Typo warnings have a **Fix** button that renames the account throughout the file
- **Ctrl+Z** / **Ctrl+Y** — undo / redo
- **Ctrl+F** — find (draggable panel; Enter = next, Shift+Enter = previous)
- **Ctrl+H** — find & replace
- **Ctrl+G** — go to line
- **Ctrl+Home** / **Ctrl+End** — jump to start / end of file

### Saving

- **Ctrl+S** — save (or Save As if untitled)
- **Ctrl+Shift+S** — Save As
- Prompted to save when closing or opening a new file

### External changes

If another program modifies the file (e.g. `hledger add`), a banner offers to reload.

## Example journals

The `examples/` folder contains ready-to-use journal files for different scenarios:

- **`salaried-worker.journal`** — office worker: paycheck with tax withholding, mortgage, bills, credit card, savings
- **`freelancer.journal`** — multi-client invoicing, business expenses, EUR income, tax reserves, aliases
- **`student.journal`** — student loans, part-time job, roommate splits via Venmo, tight budget
- **`small-business.journal`** — online shop: revenue with platform fees, COGS, inventory, payroll, sales tax, loan payments
- **`investor.journal`** — stock/crypto portfolio with cost basis (`@`), dividends, market prices (`P`), capital gains
- **`digital-nomad.journal`** — USD income, THB daily spending, currency exchange, travel categories
- **`family-budget.journal`** — dual income, joint/personal accounts, childcare, mortgage, periodic budget goals

Open any of these to see how hledger journals work in practice, or copy one as a starting template.

`examples/parser-tests/` contains technical test files that exercise every parser feature.

## Project structure

```
hledgeditor/
├── electron/
│   ├── main.js          # Electron main process (windows, menus, file I/O)
│   ├── preload.js       # Secure IPC bridge
│   └── settings.js      # Settings & defaults management
├── src/
│   ├── index.html       # HTML shell
│   ├── main.jsx         # React entry point
│   ├── App.jsx          # Editor UI component
│   ├── parser.js        # Journal parser, highlighter, typo detection
│   └── themes/          # Light and dark color schemes
├── examples/            # Real-life example journals + parser test files
├── build/               # App icon sources
├── scripts/             # Build helper scripts (icon generation)
├── package.json
├── vite.config.js
└── README.md
```

## How it works

The editor is a React app running in Electron's renderer process. The journal parser (`src/parser.js`) runs on every keystroke, producing:

1. A list of **transactions** with their postings, errors, and warnings
2. A list of **directives** (account declarations, commodity definitions, periodic rules, etc.)
3. **Syntax tokens** for highlighting

Declared accounts from `account` directives and postings from periodic/auto rules feed into autocomplete suggestions and typo detection. The Electron main process handles all file system operations through IPC, keeping the renderer sandboxed.

## Limitations

- This is an editor, not a reporting tool — use hledger's CLI for balance reports, register queries, etc.
- Large files (10,000+ lines) may feel sluggish since parsing runs on every keystroke. For most personal journals this is fine.
- Directive semantics (aliases rewriting accounts, `apply account` prepending prefixes, `D` setting defaults) are recognized for highlighting and autocomplete but not applied to transform data the way hledger itself would.

## License

MIT
