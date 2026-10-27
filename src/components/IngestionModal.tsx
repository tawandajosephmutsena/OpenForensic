"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowRight,
  CheckCircle,
  FileText,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import type { SourceFile, Transaction } from "../lib/types";
import {
  createId,
  configureHeaderRow,
  detectFormat,
  hasRequiredMapping,
  mapStatementRows,
  parseStatementFile,
  suggestMapping,
  type ColumnMapping,
  type MappingField,
  type ParsedStatement,
} from "../lib/parse";
import { formatMoney } from "../lib/format";

interface IngestionModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (transactions: Transaction[], source: SourceFile) => void;
}

const mappingFields: { key: MappingField; label: string; hint?: string }[] = [
  { key: "date", label: "Transaction date", hint: "Required" },
  { key: "description", label: "Description", hint: "Required" },
  { key: "amount", label: "Signed amount", hint: "Or use debit / credit" },
  { key: "direction", label: "Direction", hint: "For unsigned amounts" },
  { key: "debit", label: "Debit", hint: "Money out" },
  { key: "credit", label: "Credit", hint: "Money in" },
  { key: "balance", label: "Running balance" },
  { key: "reference", label: "Reference" },
  { key: "account", label: "Account" },
  { key: "currency", label: "Currency" },
];

function emptyMapping(): ColumnMapping {
  return {
    date: null,
    description: null,
    amount: null,
    direction: null,
    debit: null,
    credit: null,
    balance: null,
    reference: null,
    account: null,
    currency: null,
  };
}

export default function IngestionModal({ open, onClose, onImport }: IngestionModalProps) {
  const fileInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const readRequest = useRef(0);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>(emptyMapping);
  const [progress, setProgress] = useState(0);
  const [reading, setReading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dateOrder, setDateOrder] = useState<"DMY" | "MDY">("DMY");
  const [exclusionsAcknowledged, setExclusionsAcknowledged] = useState(false);
  const [sourceWarningsAcknowledged, setSourceWarningsAcknowledged] = useState(false);

  useEffect(() => {
    if (!open) {
      readRequest.current++;
      dragDepth.current = 0;
      setDragging(false);
      setFile(null);
      setParsed(null);
      setMapping(emptyMapping());
      setProgress(0);
      setReading(false);
      setImporting(false);
      setError("");
      setAccount("");
      setCurrency("USD");
      setDateOrder("DMY");
      return;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeButton.current?.focus();
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      if (event.key !== "Tab" || !dialog.current) return;
      const focusable = Array.from(dialog.current.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled]), select:not([disabled])"))
        .filter((element) => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  const sourceLabel = parsed?.format === "XLSX" && parsed.sheets.length > 1 && parsed.selectedSheet
    ? `${file?.name || "Statement"} · ${parsed.selectedSheet}`
    : file?.name || "Statement";
  const mappedRows = useMemo(() => {
    if (!parsed || parsed.format === "MT940" || !hasRequiredMapping(mapping)) return null;
    return mapStatementRows(parsed, mapping, { sourceName: sourceLabel, account, currency, dateOrder });
  }, [parsed, mapping, sourceLabel, account, currency, dateOrder]);
  const previewTransactions = parsed?.format === "MT940" ? parsed.transactions.slice(0, 3) : mappedRows?.transactions.slice(0, 3) || [];

  useEffect(() => { setExclusionsAcknowledged(false); }, [mappedRows]);
  useEffect(() => { setSourceWarningsAcknowledged(false); }, [parsed]);

  async function loadFile(selected: File, sheetName?: string) {
    const request = ++readRequest.current;
    const switchingSheet = !!sheetName && selected === file;
    setFile(selected);
    if (!switchingSheet) {
      setParsed(null);
      setMapping(emptyMapping());
      setAccount("");
      setCurrency("USD");
      setDateOrder("DMY");
    }
    setProgress(0);
    setError("");
    setReading(true);

    try {
      if (!detectFormat(selected)) throw new Error("Unsupported file type. Select a CSV, XLSX, or MT940 (.mt940 or .sta) file.");
      const statement = await parseStatementFile(selected, (value) => {
        if (readRequest.current === request) setProgress(value);
      }, sheetName);
      if (readRequest.current !== request) return;
      setParsed(statement);
      setMapping(suggestMapping(statement.columns));
      if (statement.format === "MT940") {
        setAccount(statement.transactions[0]?.account === "Unspecified account" ? "" : statement.transactions[0]?.account || "");
        setCurrency(statement.transactions[0]?.currency === "XXX" ? "" : statement.transactions[0]?.currency || "");
      }
      setProgress(100);
    } catch (cause) {
      if (readRequest.current !== request) return;
      setError(cause instanceof Error ? cause.message : "The statement could not be read.");
      setProgress(0);
    } finally {
      if (readRequest.current === request) setReading(false);
    }
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    dragDepth.current = 0;
    setDragging(false);
    const dropped = event.dataTransfer.files[0];
    if (dropped) void loadFile(dropped);
  }

  function handleImport() {
    if (!parsed || !file) return;
    setImporting(true);
    setError("");
    try {
      const result = parsed.format === "MT940"
        ? { transactions: parsed.transactions.map((transaction) => ({
          ...transaction,
          currency: transaction.currency === "XXX" ? currency : transaction.currency,
          account: transaction.account === "Unspecified account" ? account.trim() || `Unspecified · ${file.name}` : transaction.account,
        })), skippedRows: 0 }
        : mappedRows || { transactions: [], skippedRows: parsed.rows.length };
      if (!result.transactions.length) {
        throw new Error("No valid transactions match this mapping. Check the date, description, and amount columns.");
      }
      if (result.skippedRows > 0 && !exclusionsAcknowledged) {
        throw new Error("Review and acknowledge the excluded rows before importing this statement.");
      }
      if (parsed.warnings.length > 0 && !sourceWarningsAcknowledged) {
        throw new Error("Review and acknowledge the source warnings before importing this statement.");
      }
      const source: SourceFile = {
        id: createId(),
        name: sourceLabel,
        importedAt: new Date().toISOString(),
        rowCount: result.transactions.length,
        format: parsed.format,
      };
      onImport(result.transactions, source);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The statement could not be imported.");
      setImporting(false);
    }
  }

  if (!open) return null;

  const unknownMt940Currency = parsed?.format === "MT940" && parsed.transactions.some((transaction) => transaction.currency === "XXX");
  const canImport = !!parsed && (parsed.format === "MT940"
    ? (!unknownMt940Currency || (/^[A-Z]{3}$/.test(currency) && currency !== "XXX")) && (!parsed.warnings.length || sourceWarningsAcknowledged)
    : !!mappedRows?.transactions.length && (!mappedRows.skippedRows || exclusionsAcknowledged));
  const rowCount = parsed?.format === "MT940" ? parsed.transactions.length : parsed?.rows.length || 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/45 px-3 py-5 backdrop-blur-[3px] sm:px-6" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section ref={dialog} aria-modal="true" aria-labelledby="ingestion-title" aria-describedby="ingestion-description" role="dialog" className="flex max-h-[min(880px,calc(100vh-40px))] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-[0_24px_80px_rgba(24,24,27,0.18),0_2px_12px_rgba(24,24,27,0.08)]">
        <header className="flex items-start justify-between gap-4 border-b border-zinc-100 px-6 py-5 sm:px-8">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />New evidence source</div>
            <h2 id="ingestion-title" className="text-[22px] font-medium tracking-tight text-zinc-900">Import a statement</h2>
            <p id="ingestion-description" className="mt-1 text-[13px] text-zinc-500">Map your columns, inspect the preview, then add the source to this audit.</p>
          </div>
          <button ref={closeButton} type="button" aria-label="Close import" onClick={onClose} className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-zinc-400"><X size={18} /></button>
        </header>

        <div className="overflow-y-auto px-6 py-6 sm:px-8">
          <input
            ref={fileInput}
            type="file"
            accept=".csv,.xlsx,.mt940,.sta,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(event) => {
              const selected = event.target.files?.[0];
              if (selected) void loadFile(selected);
              event.target.value = "";
            }}
          />

          <div
            onDragEnter={(event) => { event.preventDefault(); dragDepth.current++; setDragging(true); }}
            onDragOver={(event) => event.preventDefault()}
            onDragLeave={(event) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); }}
            onDrop={handleDrop}
            className={`relative rounded-xl border border-dashed px-6 py-7 text-center transition-all duration-200 ${dragging ? "scale-[1.005] border-zinc-900 bg-zinc-100 shadow-inner" : parsed ? "border-zinc-200 bg-zinc-50/60" : "border-zinc-300 bg-zinc-50/40 hover:border-zinc-400 hover:bg-zinc-50"}`}
          >
            <div className={`mx-auto flex h-10 w-10 items-center justify-center rounded-lg border ${parsed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-zinc-200 bg-white text-zinc-600"}`}>
              {parsed ? <CheckCircle size={19} weight="regular" /> : <UploadSimple size={19} weight="regular" />}
            </div>
            <div className="mt-3 text-[13px] font-medium text-zinc-800">{dragging ? "Release to inspect statement" : parsed ? file?.name : "Drop a bank statement here"}</div>
            <p className="mt-1 text-[12px] text-zinc-500">{parsed ? `${rowCount.toLocaleString()} ${parsed.format === "MT940" ? `transaction${rowCount === 1 ? "" : "s"}` : `source row${rowCount === 1 ? "" : "s"}`} detected · ${parsed.format}` : "CSV, XLSX, or MT940 (.mt940 / .sta)"}</p>
            <button type="button" onClick={() => fileInput.current?.click()} className="mt-4 inline-flex h-8 items-center justify-center rounded-lg border border-zinc-200 bg-white px-3 text-[12px] font-medium text-zinc-700 shadow-[0_1px_3px_rgba(0,0,0,0.03)] transition hover:border-zinc-300 hover:bg-zinc-50 focus:outline-none focus:ring-2 focus:ring-zinc-400">
              {parsed || file ? "Choose another file" : "Browse files"}
            </button>
            {reading && <div className="mx-auto mt-5 max-w-[280px]" aria-live="polite"><div className="flex justify-between text-[11px] text-zinc-500"><span>Reading locally</span><span>{progress}%</span></div><div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-200"><div className="h-full rounded-full bg-zinc-800 transition-all duration-150" style={{ width: `${progress}%` }} /></div></div>}
          </div>

          <div className="mt-3 flex items-start gap-1.5 text-[11px] text-zinc-500"><ShieldCheck size={14} className="mt-px shrink-0 text-emerald-600" /><span><span className="font-medium text-zinc-600">Browser-local processing</span> · No uploads. Normalized records save in this browser without app-level encryption; raw files are not retained.</span></div>

          {error && <div role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-900"><WarningCircle size={16} className="mt-px shrink-0" /><span>{error}</span></div>}

          {parsed && parsed.warnings.length > 0 && <div role="status" className="mt-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[12px] text-amber-950"><WarningCircle size={16} className="mt-px shrink-0" /><div><p className="font-medium">Review source warnings before import</p><ul className="mt-1 max-h-32 list-disc space-y-1 overflow-y-auto pl-4">{parsed.warnings.map((warning, index) => <li key={`${index}-${warning}`}>{warning}</li>)}</ul><label className="mt-3 flex cursor-pointer items-start gap-2 font-medium"><input type="checkbox" checked={sourceWarningsAcknowledged} onChange={(event) => setSourceWarningsAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-900" /><span>I checked these warnings against the source statement.</span></label></div></div>}

          {parsed?.format === "MT940" && unknownMt940Currency && <label className="mt-5 block max-w-xs"><span className="text-[11px] font-medium text-zinc-600">Statement currency · required</span><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} maxLength={3} placeholder="e.g. USD" className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] uppercase text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200" /><span className="mt-1 block text-[11px] text-zinc-500">This MT940 source does not include a currency code for every transaction.</span></label>}

          {parsed?.format === "XLSX" && parsed.sheets.length > 1 && <label className="mt-5 block max-w-xs"><span className="text-[11px] font-medium text-zinc-600">Workbook sheet</span><select value={parsed.selectedSheet || ""} disabled={reading} onChange={(event) => { if (file) void loadFile(file, event.target.value); }} className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-800 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200 disabled:opacity-60">{parsed.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}

          {parsed?.format !== "MT940" && parsed && (
            <div className="mt-7">
              <div className="mb-4 flex items-baseline justify-between gap-3"><div><div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400">Column mapping</div><h3 className="mt-1 text-[16px] font-medium tracking-tight text-zinc-900">Tell us what each column means</h3></div><span className="text-[11px] text-zinc-400">Review before importing</span></div>
              <label className="mb-4 inline-flex cursor-pointer items-center gap-2 text-[12px] text-zinc-600"><input type="checkbox" checked={parsed.hasHeader} disabled={parsed.rawRows.length < 2} onChange={(event) => { const configured = configureHeaderRow(parsed, event.target.checked); setParsed(configured); setMapping(suggestMapping(configured.columns)); }} className="h-3.5 w-3.5 rounded border-zinc-300 accent-zinc-900" /><span>First row contains column names</span></label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {mappingFields.map(({ key, label, hint }) => (
                  <label key={key} className="block">
                    <span className="flex justify-between gap-2 text-[11px] font-medium text-zinc-600"><span>{label}</span>{hint && <span className="font-normal text-zinc-400">{hint}</span>}</span>
                    <select value={mapping[key] ?? ""} onChange={(event) => setMapping((current) => {
                      const nextValue = event.target.value === "" ? null : Number(event.target.value);
                      const next = { ...current, [key]: nextValue };
                      if (nextValue !== null && key === "amount") { next.debit = null; next.credit = null; }
                      if (nextValue !== null && (key === "debit" || key === "credit")) next.amount = null;
                      return next;
                    })} className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-2.5 text-[12px] text-zinc-800 outline-none transition focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200">
                      <option value="">Not mapped</option>
                      {parsed.columns.map((column, index) => <option key={`${index}-${column}`} value={index}>{column}</option>)}
                    </select>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-zinc-500">For one amount column, debits need a minus / DR marker or a mapped direction column.</p>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="block"><span className="text-[11px] font-medium text-zinc-600">Default account</span><input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="Unspecified account" className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200" /></label>
                <label className="block"><span className="text-[11px] font-medium text-zinc-600">Default currency</span><input value={currency} onChange={(event) => setCurrency(event.target.value.toUpperCase().slice(0, 3))} maxLength={3} aria-label="Default currency code" className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] uppercase text-zinc-800 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200" /></label>
                <label className="block"><span className="text-[11px] font-medium text-zinc-600">Ambiguous numeric dates</span><select value={dateOrder} onChange={(event) => setDateOrder(event.target.value as "DMY" | "MDY")} className="mt-1.5 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[12px] text-zinc-800 outline-none focus:border-zinc-500 focus:ring-2 focus:ring-zinc-200"><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></label>
              </div>
            </div>
          )}

          {parsed && (
            <div className="mt-7">
              <div className="mb-3 flex items-center justify-between"><div><div className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-400">Evidence preview</div><h3 className="mt-1 text-[16px] font-medium tracking-tight text-zinc-900">First transactions</h3></div><span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-[11px] text-zinc-500">{previewTransactions.length ? "Normalized view" : "Source view"}</span></div>
              <div className="overflow-x-auto rounded-lg border border-zinc-200">
                {previewTransactions.length ? (
                  <table className="w-full min-w-[600px] table-fixed text-left text-[12px]"><thead className="bg-zinc-50 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-400"><tr><th className="w-24 px-3 py-2.5">Date</th><th className="px-3 py-2.5">Description</th><th className="w-28 px-3 py-2.5 text-right">Debit</th><th className="w-28 px-3 py-2.5 text-right">Credit</th></tr></thead><tbody className="divide-y divide-zinc-100">{previewTransactions.map((transaction) => <tr key={transaction.id} className="text-zinc-700"><td className="px-3 py-2.5 tabular-nums text-zinc-500">{transaction.date}</td><td className="truncate px-3 py-2.5">{transaction.description}</td><td className="px-3 py-2.5 text-right tabular-nums">{transaction.debit ? formatMoney(transaction.debit, transaction.currency) : "—"}</td><td className="px-3 py-2.5 text-right tabular-nums">{transaction.credit ? formatMoney(transaction.credit, transaction.currency) : "—"}</td></tr>)}</tbody></table>
                ) : parsed.format !== "MT940" ? (
                  <table className="w-full min-w-[600px] text-left text-[12px]"><thead className="bg-zinc-50 text-[10px] font-medium uppercase tracking-[0.1em] text-zinc-400"><tr>{parsed.columns.slice(0, 7).map((column, index) => <th key={`${column}-${index}`} className="max-w-40 truncate px-3 py-2.5">{column}</th>)}</tr></thead><tbody className="divide-y divide-zinc-100">{parsed.rows.slice(0, 3).map((row, rowIndex) => <tr key={rowIndex}>{parsed.columns.slice(0, 7).map((_, columnIndex) => <td key={columnIndex} className="max-w-40 truncate px-3 py-2.5 text-zinc-600">{row[columnIndex] || "—"}</td>)}</tr>)}</tbody></table>
                ) : <div className="flex items-center gap-2 px-3 py-5 text-[12px] text-zinc-500"><FileText size={16} />No preview available.</div>}
              </div>
              {parsed.format !== "MT940" && !hasRequiredMapping(mapping) && <p className="mt-2 text-[11px] text-zinc-500">Map date, description, and amount or debit / credit to distinct columns.</p>}
              {mappedRows && <p className={`mt-2 text-[11px] ${mappedRows.skippedRows ? "text-amber-700" : "text-zinc-500"}`}>{mappedRows.transactions.length.toLocaleString()} valid transaction{mappedRows.transactions.length === 1 ? "" : "s"} · {mappedRows.skippedRows.toLocaleString()} row{mappedRows.skippedRows === 1 ? "" : "s"} excluded for missing, invalid, or conflicting values.</p>}
              {mappedRows && mappedRows.skippedRows > 0 && (
                <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-[12px] text-amber-950">
                  <p className="font-medium">Review {mappedRows.skippedRows.toLocaleString()} excluded source row{mappedRows.skippedRows === 1 ? "" : "s"}</p>
                  <p className="mt-1 leading-5">Excluded rows can change balances and findings. Correct the file or mapping if these rows are transactions.</p>
                  <ul className="mt-2 max-h-32 space-y-1 overflow-y-auto" aria-label="Excluded source rows">
                    {mappedRows.excludedRows.slice(0, 20).map(({ rowNumber, reason }) => <li key={rowNumber}>Data row {rowNumber}: {reason}</li>)}
                  </ul>
                  {mappedRows.skippedRows > 20 && <p className="mt-1">{(mappedRows.skippedRows - 20).toLocaleString()} more excluded rows. Review the source file before continuing.</p>}
                  <label className="mt-3 flex cursor-pointer items-start gap-2 font-medium">
                    <input type="checkbox" checked={exclusionsAcknowledged} onChange={(event) => setExclusionsAcknowledged(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-amber-900" />
                    <span>I checked these exclusions against the source statement.</span>
                  </label>
                </div>
              )}
            </div>
          )}
        </div>

        <footer className="flex items-center justify-between gap-4 border-t border-zinc-100 bg-white px-6 py-4 sm:px-8">
          <span className="min-w-0 truncate text-[11px] text-zinc-500">{parsed ? parsed.format === "MT940" ? `${rowCount.toLocaleString()} transaction${rowCount === 1 ? "" : "s"} ready for review` : mappedRows ? mappedRows.skippedRows && !exclusionsAcknowledged ? `${mappedRows.skippedRows.toLocaleString()} excluded row${mappedRows.skippedRows === 1 ? "" : "s"} need${mappedRows.skippedRows === 1 ? "s" : ""} review` : `${mappedRows.transactions.length.toLocaleString()} valid transaction${mappedRows.transactions.length === 1 ? "" : "s"} ready` : "Map columns to continue" : "Files are parsed entirely on this device"}</span>
          <button type="button" disabled={!canImport || importing || reading} onClick={handleImport} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg bg-zinc-900 px-3.5 text-[12px] font-medium text-white shadow-[0_1px_3px_rgba(0,0,0,0.08)] transition hover:bg-zinc-700 focus:outline-none focus:ring-2 focus:ring-zinc-500 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400">
            {importing ? "Importing…" : "Import statement"}<ArrowRight size={14} />
          </button>
        </footer>
      </section>
    </div>
  );
}
