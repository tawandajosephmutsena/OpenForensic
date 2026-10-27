# Open Forensic

Open Forensic is a local-first financial forensics workspace for screening bank statements, reviewing potential discrepancies, and preparing an evidence-led response. It is released under the [MIT License](LICENSE).

- [Product website](https://open-forensic.disruptiveholisticde.chatgpt.site)
- [Browser workspace](https://open-forensic-workspace.disruptiveholisticde.chatgpt.site)

## Install

Open the browser workspace over HTTPS and choose **Install app**. Browsers that support the install prompt can install it from that button; Safari and browsers without the prompt show the appropriate browser-menu instructions. The app can also run in a regular browser tab.

The repository includes an Electron desktop wrapper and a version-tagged GitHub Actions release workflow for a universal macOS DMG, Windows x64 one-click installer, and Linux x64 AppImage. Desktop binaries are not published or verified as release downloads yet. Build one locally with `pnpm desktop:mac`, `pnpm desktop:win`, or `pnpm desktop:linux` on the corresponding operating system. macOS distribution needs a Developer ID signature and notarization for a smooth direct-download install.

## Run locally

Requires Node.js 20.9 or newer.

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). The app opens with clearly labeled synthetic transactions. Importing a real statement replaces the synthetic workspace. Use the workspace menu to start a new empty audit or restore the demo.

Run `pnpm test:audit` for focused rule-engine checks, `pnpm test:import` for statement parsing checks, `pnpm test:export` for export checks, `pnpm test:agent` and `pnpm test:desktop` for agent checks, `pnpm typecheck` for TypeScript validation, and `pnpm build` for a production build.

To preview the production build locally, run `pnpm build` followed by `pnpm start`.

## Implemented workflow

1. Drop or select a CSV, XLSX, or MT940 (`.mt940` / `.sta`) statement. CSV and XLSX columns can be mapped manually; the preview shows normalized rows before import. If a date is ambiguous, choose day-first or month-first. See [`examples/sample-statement.csv`](examples/sample-statement.csv) for a simple CSV.
2. Review and apply the audit profile before the first scan of real data. Configure annual interest rate, margin, day basis, interest method, tax rate, minimum and cap, exemption keywords, duplicate-fee window, and discrepancy tolerance. These are screening assumptions; the defaults are illustrative rather than legal or statutory values.
3. Inspect every transaction and the calculation behind each potential finding. Confirm, exclude, or reopen findings. Review decisions remain attached to stable transaction IDs when rules are reapplied.
4. Download an A4 PDF review draft for confirmed findings. Export either confirmed findings or the full transaction ledger as CSV, with optional calculation notes. Edit or copy the bank communication draft. Exports are generated locally; Open Forensic does not send an email.

The assistant screen can suggest column mappings, help interpret selected findings, and draft a request letter. Users review mappings and findings before importing or exporting. Completed review PDFs can be saved in the local workspace, listed after reload, and downloaded later. The desktop wrapper supports a session API key and implements experimental Sign in with ChatGPT for eligible open-source local clients; the latter has not yet been verified with a real account. AI requests send selected sample rows or findings to the chosen provider. The browser workspace does not expose the desktop-only account bridge.

Transactions, review state, and saved review PDFs are stored in this browser or desktop profile using IndexedDB without application-level encryption. Raw source files are read locally and are not retained. The application has no statement-upload API, server database, analytics, or remote font dependency. Clearing browser storage removes the local workspace and saved PDFs; starting a new workspace also removes the previous workspace's saved PDFs after confirmation. Desktop ChatGPT credentials use operating-system protected storage when available and stay in memory for the session otherwise.

## Audit checks

- **Interest:** accrues modeled daily interest on negative running balances between statement dates and compares it with an interest debit. Simple and compound calculations use the selected annual rate and 360/365-day convention. Value dates and historical rates are not inferred.
- **Tax / levy:** links a tax entry to a preceding debit with the same transaction reference, then applies the configured percentage, minimum, cap, and exemption keywords. Unlinked tax rows are left unflagged.
- **Duplicate fee:** finds a repeated fee or charge of the same normalized description and amount within the configured date window.
- **Overdraft penalty:** highlights an overdraft-related charge if the reconstructed balance immediately before it was positive.

The checks produce potential discrepancies for human review. They do not establish liability or current legal compliance. Verify bank tariffs, cleared-funds rules, value dates, contracts, exemptions, and applicable law before external use.

## Format scope

CSV, XLSX, and standard MT940 are supported locally. Scanned PDFs, OCR, universal bank PDF layouts, encrypted-at-rest storage, a WASM engine, and verified offline operation are not part of this build. Import a bank-provided CSV/XLSX or MT940 export for those statements. Multi-account rows can coexist in one currency; separate currencies need separate workspaces so amounts are never added together without conversion.

Use monetary amounts with no more than two decimal places. The importer excludes ambiguous single-separator values such as `1,234` or `1.234` so you can correct them in the source file. It lists excluded CSV/XLSX rows and MT940 source warnings for review and acknowledgement before import. MT940 entries with unsupported finer precision are skipped with a warning. Check the preview against the source statement before importing.

## Structure

- `src/components/` — dashboard, statement ledger, import flow, rule profile, export console, and app shell.
- `src/lib/parse.ts` — local statement parsers and column normalization.
- `src/lib/audit.ts` — deterministic screening rules.
- `src/lib/storage.ts` — IndexedDB workspace persistence.
- `src/lib/demo.ts` — synthetic sample workspace.
- `desktop/` — Electron shell and agent connections.
- `scripts/export-app.mjs` — static export for separate HTTPS hosting and desktop packaging.

The interface uses Next.js App Router, TypeScript, Tailwind CSS, Recharts, and Phosphor icons.
