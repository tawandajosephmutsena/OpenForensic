"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  DownloadSimple,
  FileArrowUp,
  FileText,
  Lightbulb,
  LockKey,
  MagicWand,
  ShieldCheck,
  Sparkle,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  buildReviewLetter,
  confirmedFindings,
  draftInput,
  interpretationInput,
  parseAgentMapping,
  type LetterDetails,
} from "@/lib/agent";
import { makeDemoWorkspace } from "@/lib/demo";
import { formatMoney, titleCase } from "@/lib/format";
import { importStatement } from "@/lib/import-workspace";
import {
  configureHeaderRow,
  createId,
  hasRequiredMapping,
  mapStatementRows,
  parseStatementFile,
  suggestMapping,
  type ColumnMapping,
  type MappingField,
  type ParsedStatement,
} from "@/lib/parse";
import { getWorkspaceDocument, listWorkspaceDocuments, loadWorkspace, saveWorkspaceDocument, type WorkspaceDocument } from "@/lib/storage";
import type { SourceFile, Transaction, Workspace } from "@/lib/types";

const mappingFields: { field: MappingField; label: string }[] = [
  { field: "date", label: "Date" },
  { field: "description", label: "Description" },
  { field: "amount", label: "Signed amount" },
  { field: "direction", label: "Debit / credit direction" },
  { field: "debit", label: "Debit" },
  { field: "credit", label: "Credit" },
  { field: "balance", label: "Balance" },
  { field: "reference", label: "Reference" },
  { field: "account", label: "Account" },
  { field: "currency", label: "Currency" },
];

const card = "rounded-2xl border border-[#d8e9e6] bg-white shadow-[0_14px_40px_rgba(20,91,87,.06)]";
const inputClass = "mt-1.5 h-10 w-full rounded-lg border border-[#cfe2df] bg-white px-3 text-sm text-[#133d3b] outline-none focus:border-[#078d87] focus:ring-2 focus:ring-[#078d87]/15";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#087d78] px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-[#066c67] disabled:cursor-not-allowed disabled:opacity-45";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-lg border border-[#cfe2df] bg-white px-4 py-2.5 text-sm font-semibold text-[#1b5c58] transition-colors hover:bg-[#eef8f6] disabled:cursor-not-allowed disabled:opacity-45";

function friendlyError(cause: unknown, fallback: string) {
  return cause instanceof Error && cause.message ? cause.message : fallback;
}

function letterFilename(name: string) {
  return `open-forensic-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "review"}-letter.pdf`;
}

function downloadBlob(data: Blob, name: string) {
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

async function buildLetterPdf(body: string): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const lines = doc.splitTextToSize(body, 165) as string[];
  let y = 25;
  doc.setFont("helvetica", "bold");
  doc.setTextColor(8, 125, 120);
  doc.setFontSize(11);
  doc.text("OPEN FORENSIC", 20, 18);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(32, 52, 51);
  doc.setFontSize(10);
  for (const line of lines) {
    if (y > 270) { doc.addPage(); y = 22; }
    doc.text(line, 20, y);
    y += 5;
  }
  return doc.output("blob");
}

export default function AgentWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [desktopBridge, setDesktopBridge] = useState(false);
  const [connected, setConnected] = useState(false);
  const [provider, setProvider] = useState<"chatgpt" | "api-key" | null>(null);
  const [accountLabel, setAccountLabel] = useState("");
  const [modelLabel, setModelLabel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [signInBusy, setSignInBusy] = useState(false);
  const [planWelcome, setPlanWelcome] = useState(false);
  const [connectionError, setConnectionError] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedStatement | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [reading, setReading] = useState(false);
  const [mapBusy, setMapBusy] = useState(false);
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState("");
  const [account, setAccount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [dateOrder, setDateOrder] = useState<"DMY" | "MDY">("DMY");
  const [exclusionsAcknowledged, setExclusionsAcknowledged] = useState(false);
  const [warningsAcknowledged, setWarningsAcknowledged] = useState(false);
  const [interpretation, setInterpretation] = useState("");
  const [interpretBusy, setInterpretBusy] = useState(false);
  const [interpretError, setInterpretError] = useState("");
  const [details, setDetails] = useState<LetterDetails>({ bank: "", contact: "", sender: "" });
  const [letter, setLetter] = useState("");
  const [draftBusy, setDraftBusy] = useState(false);
  const [draftError, setDraftError] = useState("");
  const [documents, setDocuments] = useState<WorkspaceDocument[]>([]);
  const [documentBusy, setDocumentBusy] = useState(false);
  const [documentError, setDocumentError] = useState("");
  const [documentSuccess, setDocumentSuccess] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const welcomeButton = useRef<HTMLButtonElement>(null);
  const readRequest = useRef(0);

  useEffect(() => {
    let active = true;
    loadWorkspace().then((stored) => { if (active) setWorkspace(stored ?? makeDemoWorkspace()); }).catch(() => { if (active) setWorkspace(makeDemoWorkspace()); });
    const bridge = window.openForensicAgent;
    setDesktopBridge(!!bridge);
    if (bridge) void bridge.status().then((status) => {
      if (!active) return;
      setConnected(status.connected);
      setProvider(status.provider ?? null);
      setAccountLabel(status.accountLabel ?? "");
      setModelLabel(status.model ?? "");
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => { if (planWelcome) welcomeButton.current?.focus(); }, [planWelcome]);

  useEffect(() => {
    let active = true;
    setDocuments([]);
    setDocumentError("");
    setDocumentSuccess("");
    if (workspace?.id) void listWorkspaceDocuments(workspace.id).then((saved) => {
      if (active) setDocuments(saved);
    }).catch((cause) => {
      if (active) setDocumentError(friendlyError(cause, "Saved documents could not be loaded."));
    });
    return () => { active = false; };
  }, [workspace?.id]);

  const mappedRows = useMemo(() => parsed && parsed.format !== "MT940" && mapping && hasRequiredMapping(mapping)
    ? mapStatementRows(parsed, mapping, { sourceName: file?.name ?? "Statement", account, currency, dateOrder })
    : null, [parsed, mapping, file, account, currency, dateOrder]);
  const preview = parsed?.format === "MT940" ? parsed.transactions.slice(0, 3) : mappedRows?.transactions.slice(0, 3) ?? [];
  const confirmed = workspace ? confirmedFindings(workspace) : [];
  const canPrepare = !!workspace && !workspace.isDemo && confirmed.length > 0;
  const activeFindings = workspace?.findings.filter((finding) => finding.status !== "excluded") ?? [];
  const confirmedTotal = confirmed.reduce((sum, finding) => sum + finding.discrepancy, 0);
  const unknownMt940Currency = parsed?.format === "MT940" && parsed.transactions.some((row) => row.currency === "XXX");
  const canImport = !!parsed && (parsed.format === "MT940"
    ? parsed.transactions.length > 0 && (!unknownMt940Currency || (/^[A-Z]{3}$/.test(currency) && currency !== "XXX")) && (!parsed.warnings.length || warningsAcknowledged)
    : !!mappedRows?.transactions.length && (!mappedRows.skippedRows || exclusionsAcknowledged));

  async function connect() {
    if (!window.openForensicAgent || !apiKey.trim()) return;
    setConnectionBusy(true);
    setConnectionError("");
    try {
      const result = await window.openForensicAgent.connect(apiKey.trim());
      if (!result.connected) throw new Error(result.error || "The AI connection could not be established.");
      setConnected(true);
      setProvider("api-key");
      setAccountLabel("");
      setModelLabel("");
      setApiKey("");
    } catch (cause) {
      setConnectionError(friendlyError(cause, "The AI connection could not be established."));
    } finally { setConnectionBusy(false); }
  }

  async function signInChatGPT() {
    if (!window.openForensicAgent?.signInChatGPT) return;
    setSignInBusy(true);
    setConnectionError("");
    try {
      const result = await window.openForensicAgent.signInChatGPT();
      if (!result.connected) throw new Error(result.error || "ChatGPT sign-in was not completed.");
      setConnected(true);
      setProvider("chatgpt");
      setAccountLabel(result.accountLabel ?? "ChatGPT account");
      setModelLabel(result.model ?? "");
      setApiKey("");
      try { if (!window.localStorage.getItem("open-forensic-chatgpt-welcome")) setPlanWelcome(true); } catch { setPlanWelcome(true); }
    } catch (cause) {
      setConnectionError(friendlyError(cause, "ChatGPT sign-in was not completed."));
    } finally { setSignInBusy(false); }
  }

  async function disconnect() {
    setConnectionError("");
    try {
      if (provider === "chatgpt") await window.openForensicAgent?.signOutChatGPT();
      else await window.openForensicAgent?.disconnect();
      setConnected(false);
      setProvider(null);
      setAccountLabel("");
      setModelLabel("");
      setInterpretation("");
    } catch (cause) {
      setConnectionError(friendlyError(cause, "The connection could not be closed."));
      const status = await window.openForensicAgent?.status().catch(() => null);
      if (status && !status.connected) {
        setConnected(false);
        setProvider(null);
        setAccountLabel("");
        setModelLabel("");
        setInterpretation("");
      }
    }
  }

  function dismissPlanWelcome() {
    try { window.localStorage.setItem("open-forensic-chatgpt-welcome", "seen"); } catch { /* The notice remains dismissible if storage is unavailable. */ }
    setPlanWelcome(false);
  }

  async function chooseFile(selected: File) {
    const request = ++readRequest.current;
    setFile(selected);
    setParsed(null);
    setMapping(null);
    setImportError("");
    setImportSuccess("");
    setReading(true);
    setExclusionsAcknowledged(false);
    setWarningsAcknowledged(false);
    try {
      const result = await parseStatementFile(selected);
      if (request !== readRequest.current) return;
      setParsed(result);
      setMapping(suggestMapping(result.columns));
      if (result.format === "MT940") {
        setAccount(result.transactions[0]?.account === "Unspecified account" ? "" : result.transactions[0]?.account ?? "");
        setCurrency(result.transactions[0]?.currency === "XXX" ? "" : result.transactions[0]?.currency ?? "");
      }
    } catch (cause) {
      if (request === readRequest.current) setImportError(friendlyError(cause, "The statement could not be read."));
    } finally { if (request === readRequest.current) setReading(false); }
  }

  async function askAgentToMap() {
    if (!connected || !parsed || parsed.format === "MT940" || !window.openForensicAgent) return;
    setMapBusy(true);
    setImportError("");
    try {
      const input = JSON.stringify({ columns: parsed.columns, sampleRows: parsed.rows.slice(0, 2).map((row) => row.map((cell) => cell.slice(0, 80))) });
      const text = await window.openForensicAgent.ask({ task: "map", input });
      setMapping(parseAgentMapping(text, parsed.columns.length));
      setExclusionsAcknowledged(false);
    } catch (cause) { setImportError(friendlyError(cause, "The agent could not map these columns. You can map them manually.")); }
    finally { setMapBusy(false); }
  }

  async function doImport() {
    if (!file || !parsed || !canImport) return;
    setImportBusy(true);
    setImportError("");
    try {
      const result = parsed.format === "MT940" ? {
        transactions: parsed.transactions.map((row) => ({
          ...row,
          account: row.account === "Unspecified account" ? account.trim() || `Unspecified · ${file.name}` : row.account,
          currency: row.currency === "XXX" ? currency.trim().toUpperCase() : row.currency,
        })),
        skippedRows: 0,
      } : mappedRows;
      if (!result?.transactions.length) throw new Error("No valid transactions are ready to import.");
      if (result.transactions.some((row) => !/^[A-Z]{3}$/.test(row.currency) || row.currency === "XXX")) throw new Error("Enter a valid three-letter currency code.");
      if (result.skippedRows && !exclusionsAcknowledged) throw new Error("Review and acknowledge excluded rows first.");
      if (parsed.warnings.length && !warningsAcknowledged) throw new Error("Review and acknowledge source warnings first.");
      const source: SourceFile = { id: createId(), name: file.name, importedAt: new Date().toISOString(), rowCount: result.transactions.length, format: parsed.format };
      const next = await importStatement(result.transactions, source);
      setWorkspace(next);
      setImportSuccess(`${result.transactions.length} transactions imported into ${next.name}.`);
      setFile(null);
      setParsed(null);
      setMapping(null);
      setInterpretation("");
      setLetter("");
    } catch (cause) { setImportError(friendlyError(cause, "The statement could not be imported.")); }
    finally { setImportBusy(false); }
  }

  async function askForInterpretation() {
    if (!connected || !workspace || !window.openForensicAgent || !activeFindings.length) return;
    setInterpretBusy(true);
    setInterpretError("");
    try { setInterpretation(await window.openForensicAgent.ask({ task: "interpret", input: interpretationInput(workspace) })); }
    catch (cause) { setInterpretError(friendlyError(cause, "The AI explanation could not be prepared.")); }
    finally { setInterpretBusy(false); }
  }

  async function askForDraft() {
    if (!connected || !workspace || !window.openForensicAgent || !canPrepare || confirmed.length > 25) return;
    setDraftBusy(true);
    setDraftError("");
    try { setLetter(await window.openForensicAgent.ask({ task: "draft", input: draftInput(workspace, details) })); }
    catch (cause) { setDraftError(friendlyError(cause, "The AI draft could not be prepared.")); }
    finally { setDraftBusy(false); }
  }

  async function downloadLetter() {
    if (!letter || !workspace) return;
    setDraftError("");
    try { downloadBlob(await buildLetterPdf(letter), letterFilename(workspace.name)); }
    catch (cause) { setDraftError(friendlyError(cause, "The PDF could not be generated.")); }
  }

  async function saveLetterToWorkspace() {
    if (!letter || !workspace || documentBusy) return;
    setDocumentBusy(true);
    setDocumentError("");
    setDocumentSuccess("");
    try {
      const pdf = await buildLetterPdf(letter);
      await saveWorkspaceDocument(workspace.id, letterFilename(workspace.name), pdf);
      setDocuments(await listWorkspaceDocuments(workspace.id));
      setDocumentSuccess("Filled PDF saved to this workspace.");
    } catch (cause) { setDocumentError(friendlyError(cause, "The document could not be saved.")); }
    finally { setDocumentBusy(false); }
  }

  async function downloadSavedDocument(saved: WorkspaceDocument) {
    if (!workspace) return;
    setDocumentError("");
    try {
      const pdf = await getWorkspaceDocument(workspace.id, saved.id);
      if (!pdf) throw new Error("This document is no longer available in the current workspace.");
      downloadBlob(pdf, saved.name);
    } catch (cause) { setDocumentError(friendlyError(cause, "The saved document could not be downloaded.")); }
  }

  const readResult = (finding: typeof activeFindings[number]) => {
    const row = workspace?.transactions.find((transaction) => transaction.id === finding.transactionId);
    return { finding, row };
  };

  return (
    <main className="min-h-screen bg-[#f3faf8] text-[#173e3b]">
      <div className="mx-auto max-w-6xl px-5 pb-20 pt-7 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4"><a href="/" aria-label="Open Forensic workspace" className="inline-flex items-center gap-2.5 font-semibold text-[#0d4742] hover:text-[#087d78]"><img src="/logo-mark.svg" alt="" width={34} height={34} className="h-[34px] w-[34px]" /><span className="text-sm tracking-tight">Open Forensic</span></a><span className="h-5 w-px bg-[#cfe2df]" /><a href="/" className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#1c706b] hover:text-[#095f5a]"><ArrowLeft size={14} /> Workspace</a></div>
          <span className="inline-flex items-center gap-2 rounded-full border border-[#c8e1dc] bg-white px-3 py-1.5 text-xs font-medium text-[#286f69]"><ShieldCheck size={14} /> Local evidence workspace</span>
        </div>
        <div className="mt-10 max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#ffddbd] bg-[#fff4e9] px-3 py-1 text-[11px] font-bold uppercase tracking-[.14em] text-[#a95113]"><Sparkle size={13} /> Guided assistant</div>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-.055em] text-[#0d4742] sm:text-5xl">From statement to clear next step.</h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-7 text-[#56716d]">Import a statement, review the screening results, and prepare a filled request for your bank. The installed app can connect ChatGPT or your OpenAI API key for column mapping, plain-language interpretation, and draft refinement.</p>
        </div>

        <div className="mt-9 grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
          <section className={`${card} p-6 sm:p-7`} aria-labelledby="connect-heading">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5f5f2] text-[#087d78]"><LockKey size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">01 / Connect</span><h2 id="connect-heading" className="mt-1 text-xl font-semibold tracking-tight">Connect ChatGPT <span className="align-middle text-[11px] font-semibold uppercase tracking-wider text-[#c5692b]">Preview</span></h2></div></div>
            {desktopBridge ? <>
              <p className="mt-4 text-sm leading-6 text-[#56716d]">Continue with ChatGPT to request use of your plan for eligible AI tasks. Sign-in opens your system browser. Availability depends on your account and workspace; Open Forensic does not receive your ChatGPT conversations.</p>
              {connected ? <div className="mt-5 rounded-xl border border-[#b6ddd5] bg-[#edf8f5] px-4 py-3"><div className="flex flex-wrap items-center justify-between gap-3"><span className="inline-flex items-center gap-2 text-sm font-semibold text-[#087d78]"><CheckCircle size={17} /> {provider === "chatgpt" ? "Using ChatGPT plan" : "OpenAI API connected"}</span><button type="button" onClick={() => void disconnect()} className="text-sm font-semibold text-[#276b65] underline underline-offset-4">{provider === "chatgpt" ? "Sign out" : "Disconnect"}</button></div>{provider === "chatgpt" && <div className="mt-2 text-xs leading-5 text-[#56716d]">{accountLabel}{modelLabel ? ` · ${modelLabel}` : ""} <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" className="ml-1 font-semibold underline underline-offset-2">Manage usage</a></div>}</div> : <div className="mt-5"><button type="button" disabled={signInBusy || !window.openForensicAgent?.signInChatGPT} onClick={() => void signInChatGPT()} className="inline-flex w-full items-center justify-center gap-2.5 rounded-lg bg-[#171717] px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-[#333] disabled:cursor-not-allowed disabled:opacity-50"><img src="/chatgpt-logo-white.svg" alt="" width={21} height={21} className="h-[21px] w-[21px]" />{signInBusy ? "Waiting for ChatGPT…" : "Continue with ChatGPT"}</button><p className="mt-2 text-xs leading-5 text-[#6e8581]">You’ll choose your ChatGPT account and approve Open Forensic in the browser.</p><details className="mt-4 border-t border-[#e3efec] pt-4"><summary className="cursor-pointer text-xs font-semibold text-[#1c706b]">Use an OpenAI API key instead</summary><p className="mt-2 text-xs leading-5 text-[#6e8581]">An API key is separate from your ChatGPT plan. It stays in the installed app’s memory for this session.</p><div className="mt-3 flex flex-col gap-3 sm:flex-row"><label className="flex-1 text-xs font-semibold text-[#51726e]">OpenAI API key<input type="password" autoComplete="off" value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void connect(); }} placeholder="Paste your own key" className={inputClass} /></label><button type="button" disabled={connectionBusy || !apiKey.trim()} onClick={() => void connect()} className={`${primaryButton} self-end sm:h-10`}>{connectionBusy ? "Connecting…" : "Connect"}<ArrowRight size={15} /></button></div></details></div>}
              {connectionError && <p role="alert" className="mt-3 text-sm text-[#ad481d]">{connectionError}</p>}
            </> : <div className="mt-4 rounded-xl border border-[#d8e9e6] bg-[#f7fbfa] p-4"><p className="text-sm leading-6 text-[#56716d]">The browser workspace runs locally without AI sign-in. The desktop app offers a ChatGPT connection preview for eligible accounts, plus an OpenAI API-key option.</p><a href="https://open-forensic.disruptiveholisticde.chatgpt.site/#download" target="_blank" rel="noopener noreferrer" className={`${secondaryButton} mt-4`}>View desktop installation options<ArrowRight size={15} /></a></div>}
            <p className="mt-4 text-xs leading-5 text-[#6e8581]">Only the statement sample or findings you choose to send are shared with the model. Files are imported into this device’s workspace.</p>
          </section>

          <section className={`${card} p-6 sm:p-7`} aria-labelledby="workspace-heading">
            <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0e3] text-[#d0702b]"><FileText size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">Current workspace</span><h2 id="workspace-heading" className="mt-1 text-xl font-semibold tracking-tight">{workspace?.name ?? "Loading…"}</h2></div></div>
            <div className="mt-6 grid grid-cols-3 divide-x divide-[#d8e9e6] rounded-xl border border-[#d8e9e6] bg-[#f7fbfa] py-4 text-center"><div><strong className="block text-2xl text-[#0d6d68]">{workspace?.transactions.length ?? 0}</strong><span className="text-[11px] text-[#63807b]">Transactions</span></div><div><strong className="block text-2xl text-[#0d6d68]">{workspace?.findings.length ?? 0}</strong><span className="text-[11px] text-[#63807b]">Findings</span></div><div><strong className="block text-2xl text-[#0d6d68]">{confirmed.length}</strong><span className="text-[11px] text-[#63807b]">Confirmed</span></div></div>
            <p className="mt-4 text-xs leading-5 text-[#6e8581]">{workspace?.isDemo ? "Showing synthetic demo data. Your first real import replaces it." : workspace?.profileConfirmed ? "Audit rules are confirmed for this workspace." : "Review and confirm audit rules in the workspace before interpreting findings."}</p>
          </section>
        </div>

        <section className={`${card} mt-6 p-6 sm:p-7`} aria-labelledby="import-heading">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5f5f2] text-[#087d78]"><FileArrowUp size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">02 / Import</span><h2 id="import-heading" className="mt-1 text-xl font-semibold tracking-tight">Add your statement</h2><p className="mt-1 text-sm text-[#63807b]">CSV, XLSX and MT940 files are read locally. Review the mapping and excluded rows before import.</p></div></div>
          <input ref={fileInput} type="file" accept=".csv,.xlsx,.mt940,.sta" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void chooseFile(selected); event.target.value = ""; }} />
          <button type="button" onClick={() => fileInput.current?.click()} className={`${secondaryButton} mt-5`}><FileArrowUp size={17} /> Choose statement</button>
          {reading && <p role="status" className="mt-4 text-sm text-[#63807b]">Reading statement…</p>}
          {importError && <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg border border-[#f3d4be] bg-[#fff7f0] px-3 py-2.5 text-sm text-[#a04c24]"><WarningCircle size={17} className="mt-0.5 shrink-0" />{importError}</p>}
          {importSuccess && <p role="status" className="mt-4 flex items-start gap-2 rounded-lg border border-[#c2e3d6] bg-[#edf8f2] px-3 py-2.5 text-sm text-[#12705e]"><CheckCircle size={17} className="mt-0.5 shrink-0" />{importSuccess} <a href="/" className="ml-1 font-semibold underline underline-offset-2">Review rules and evidence</a></p>}
          {parsed && file && <div className="mt-6 border-t border-[#e3efec] pt-6">
            <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="font-semibold text-[#1c514c]">{file.name}</p><p className="mt-1 text-xs text-[#6e8581]">{parsed.format} · {parsed.format === "MT940" ? parsed.transactions.length : parsed.rows.length} rows</p></div>{parsed.format !== "MT940" && <button type="button" onClick={() => void askAgentToMap()} disabled={!connected || mapBusy} className={secondaryButton}><MagicWand size={17} />{mapBusy ? "Mapping…" : "Ask AI to map columns"}</button>}</div>
            {parsed.format !== "MT940" && <>
              <p className="mt-3 text-xs leading-5 text-[#6e8581]">AI mapping sends the column names and first two rows to your connected provider. Check every suggestion before importing.</p>
              <label className="mt-4 flex items-center gap-2 text-xs text-[#51726e]"><input type="checkbox" checked={parsed.hasHeader} onChange={(event) => { const next = configureHeaderRow(parsed, event.target.checked); setParsed(next); setMapping(suggestMapping(next.columns)); setExclusionsAcknowledged(false); }} className="accent-[#087d78]" />First row contains column names</label>
              {parsed.sheets.length > 1 && <label className="mt-4 block max-w-xs text-xs font-semibold text-[#51726e]">Sheet<select value={parsed.selectedSheet ?? ""} onChange={(event) => { if (file) void parseStatementFile(file, undefined, event.target.value).then((next) => { setParsed(next); setMapping(suggestMapping(next.columns)); setExclusionsAcknowledged(false); }).catch((cause) => setImportError(friendlyError(cause, "This sheet could not be read."))); }} className={inputClass}>{parsed.sheets.map((sheet) => <option key={sheet} value={sheet}>{sheet}</option>)}</select></label>}
              <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{mappingFields.map(({ field, label }) => <label key={field} className="text-xs font-semibold text-[#51726e]">{label}<select value={mapping?.[field] ?? ""} onChange={(event) => { setMapping((previous) => previous ? { ...previous, [field]: event.target.value === "" ? null : Number(event.target.value) } : previous); setExclusionsAcknowledged(false); }} className={inputClass}><option value="">Not mapped</option>{parsed.columns.map((column, index) => <option key={`${index}-${column}`} value={index}>{column}</option>)}</select></label>)}</div>
              {mapping && !hasRequiredMapping(mapping) && <p className="mt-3 text-xs text-[#aa531e]">Map date, description and amount (or debit/credit) to different columns.</p>}
            </>}
            <div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold text-[#51726e]">Default account<input value={account} onChange={(event) => setAccount(event.target.value)} placeholder="Optional" className={inputClass} /></label><label className="text-xs font-semibold text-[#51726e]">Default currency<input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} className={inputClass} /></label><label className="text-xs font-semibold text-[#51726e]">Ambiguous date format<select value={dateOrder} onChange={(event) => setDateOrder(event.target.value as "DMY" | "MDY")} className={inputClass}><option value="DMY">Day / month / year</option><option value="MDY">Month / day / year</option></select></label></div>
            {preview.length > 0 && <div className="mt-6 overflow-x-auto rounded-xl border border-[#d8e9e6]"><table className="w-full min-w-[560px] text-left text-xs"><thead className="bg-[#eef8f6] text-[#4d716b]"><tr><th className="px-3 py-2.5">Date</th><th className="px-3 py-2.5">Description</th><th className="px-3 py-2.5 text-right">Debit</th><th className="px-3 py-2.5 text-right">Credit</th></tr></thead><tbody>{preview.map((row: Transaction) => <tr key={row.id} className="border-t border-[#e5efec]"><td className="px-3 py-2.5">{row.date}</td><td className="px-3 py-2.5">{row.description}</td><td className="px-3 py-2.5 text-right">{row.debit ? formatMoney(row.debit, row.currency) : "—"}</td><td className="px-3 py-2.5 text-right">{row.credit ? formatMoney(row.credit, row.currency) : "—"}</td></tr>)}</tbody></table></div>}
            {!!mappedRows?.skippedRows && <div className="mt-4 rounded-xl border border-[#f0d2bc] bg-[#fff8f1] p-4"><p className="text-sm font-semibold text-[#9f4d1e]">{mappedRows.skippedRows} excluded row{mappedRows.skippedRows === 1 ? "" : "s"}</p><ul className="mt-2 list-inside list-disc text-xs leading-5 text-[#8a6249]">{mappedRows.excludedRows.slice(0, 8).map((row) => <li key={row.rowNumber}>Row {row.rowNumber}: {row.reason}</li>)}</ul><label className="mt-3 flex items-center gap-2 text-xs text-[#744d34]"><input type="checkbox" checked={exclusionsAcknowledged} onChange={(event) => setExclusionsAcknowledged(event.target.checked)} className="accent-[#d0702b]" />I reviewed these exclusions against the source file.</label></div>}
            {!!parsed.warnings.length && <div className="mt-4 rounded-xl border border-[#f0d2bc] bg-[#fff8f1] p-4"><p className="text-sm font-semibold text-[#9f4d1e]">Source warnings</p><ul className="mt-2 list-inside list-disc text-xs leading-5 text-[#8a6249]">{parsed.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul><label className="mt-3 flex items-center gap-2 text-xs text-[#744d34]"><input type="checkbox" checked={warningsAcknowledged} onChange={(event) => setWarningsAcknowledged(event.target.checked)} className="accent-[#d0702b]" />I reviewed the source warnings.</label></div>}
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-[#6e8581]">{parsed.format === "MT940" ? parsed.transactions.length : mappedRows?.transactions.length ?? 0} valid transactions ready</p><button type="button" disabled={!canImport || importBusy} onClick={() => void doImport()} className={primaryButton}>{importBusy ? "Importing…" : "Import into workspace"}<ArrowRight size={16} /></button></div>
          </div>}
        </section>

        <section className={`${card} mt-6 p-6 sm:p-7`} aria-labelledby="interpret-heading">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0e3] text-[#d0702b]"><Lightbulb size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">03 / Interpret</span><h2 id="interpret-heading" className="mt-1 text-xl font-semibold tracking-tight">Understand the results</h2><p className="mt-1 text-sm text-[#63807b]">Findings are screening signals based on the rules you confirmed. Each calculation stays visible for review.</p></div></div>
          {!workspace?.profileConfirmed ? <div className="mt-5 rounded-xl border border-[#d8e9e6] bg-[#f7fbfa] p-4 text-sm text-[#56716d]">Import a real statement, then <a href="/" className="font-semibold text-[#087d78] underline underline-offset-2">confirm your audit rules</a> to generate findings.</div> : activeFindings.length ? <>
            <div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[#eef8f6] p-4"><p className="text-xs text-[#63807b]">Potential findings</p><p className="mt-1 text-2xl font-semibold text-[#0d6d68]">{activeFindings.length}</p></div><div className="rounded-xl bg-[#eef8f6] p-4"><p className="text-xs text-[#63807b]">Confirmed for review</p><p className="mt-1 text-2xl font-semibold text-[#0d6d68]">{confirmed.length}</p></div><div className="rounded-xl bg-[#fff2e7] p-4"><p className="text-xs text-[#9c6b4c]">Confirmed potential difference</p><p className="mt-1 text-2xl font-semibold text-[#b75c1c]">{formatMoney(confirmedTotal, workspace.currency)}</p></div></div>
            <div className="mt-5 space-y-3">{activeFindings.slice(0, 6).map((finding) => { const { row } = readResult(finding); return <article key={finding.id} className="rounded-xl border border-[#d8e9e6] p-4"><div className="flex flex-wrap items-center justify-between gap-2"><div><span className="text-xs font-semibold uppercase tracking-wider text-[#d0702b]">{titleCase(finding.type)}</span><h3 className="mt-1 text-sm font-semibold">{row?.description ?? "Transaction"}</h3></div><strong className="text-sm text-[#0d6d68]">{formatMoney(finding.discrepancy, workspace.currency)}</strong></div><p className="mt-2 text-xs leading-5 text-[#56716d]">{finding.explanation}</p><p className="mt-2 text-xs leading-5 text-[#6f8581]">{finding.calculation}</p><p className="mt-2 text-[11px] text-[#829692]">{row?.date ?? ""} · {finding.status === "confirmed" ? "Confirmed for review" : "Needs review"} · ID {finding.id}</p></article>; })}</div>
            {activeFindings.length > 6 && <p className="mt-3 text-xs text-[#6e8581]">Showing 6 of {activeFindings.length} findings. Open the evidence ledger for the full list.</p>}
            {connected && <div className="mt-5 border-t border-[#e3efec] pt-5"><div className="flex flex-wrap items-center gap-3"><button type="button" disabled={interpretBusy} onClick={() => void askForInterpretation()} className={secondaryButton}><Sparkle size={17} />{interpretBusy ? "Explaining…" : "Explain with AI"}</button>{provider === "chatgpt" && <span className="text-xs font-semibold text-[#087d78]">Using ChatGPT plan</span>}</div><p className="mt-2 text-xs leading-5 text-[#6e8581]">This sends up to 25 finding summaries, transaction descriptions, amounts and rule settings to OpenAI. Review the result against source records.</p>{interpretError && <p role="alert" className="mt-2 text-sm text-[#ad481d]">{interpretError}</p>}{interpretation && <div className="mt-4 whitespace-pre-wrap rounded-xl border border-[#cbe4de] bg-[#f4faf8] p-5 text-sm leading-7 text-[#365b56]">{interpretation}</div>}</div>}
          </> : <p className="mt-5 text-sm text-[#63807b]">No active findings under the current rules. Review the transaction ledger and profile before drawing conclusions.</p>}
        </section>

        <section className={`${card} mt-6 p-6 sm:p-7`} aria-labelledby="draft-heading">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#e5f5f2] text-[#087d78]"><FileText size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">04 / Prepare</span><h2 id="draft-heading" className="mt-1 text-xl font-semibold tracking-tight">Fill a review request</h2><p className="mt-1 text-sm text-[#63807b]">Confirmed findings populate a letter for your bank. Edit it before sending.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-3"><label className="text-xs font-semibold text-[#51726e]">Bank<input value={details.bank} onChange={(event) => setDetails((current) => ({ ...current, bank: event.target.value }))} placeholder="Bank name" className={inputClass} /></label><label className="text-xs font-semibold text-[#51726e]">Contact<input value={details.contact} onChange={(event) => setDetails((current) => ({ ...current, contact: event.target.value }))} placeholder="Optional" className={inputClass} /></label><label className="text-xs font-semibold text-[#51726e]">Your name<input value={details.sender} onChange={(event) => setDetails((current) => ({ ...current, sender: event.target.value }))} placeholder="Your name" className={inputClass} /></label></div>
          <div className="mt-5 flex flex-wrap items-center gap-2"><button type="button" disabled={!canPrepare} onClick={() => { if (workspace) setLetter(buildReviewLetter(workspace, details)); }} className={primaryButton}>Fill from confirmed findings<ArrowRight size={16} /></button>{connected && <button type="button" disabled={!canPrepare || confirmed.length > 25 || draftBusy} onClick={() => void askForDraft()} className={secondaryButton}><Sparkle size={17} />{draftBusy ? "Drafting…" : "Refine with AI"}</button>}{connected && provider === "chatgpt" && <span className="ml-1 text-xs font-semibold text-[#087d78]">Using ChatGPT plan</span>}</div>
          {workspace?.isDemo ? <p className="mt-3 text-xs text-[#6e8581]">Import a real statement before preparing a letter. Demo findings are synthetic.</p> : !confirmed.length && <p className="mt-3 text-xs text-[#6e8581]">Confirm findings in the evidence ledger to prepare a request.</p>}
          {connected && confirmed.length > 25 && <p className="mt-3 text-xs text-[#6e8581]">AI refinement is limited to 25 confirmed findings; the local letter still includes all confirmed items.</p>}
          {connected && canPrepare && <p className="mt-3 text-xs leading-5 text-[#6e8581]">AI refinement sends recipient details and confirmed finding summaries to OpenAI. It does not send the letter to your bank.</p>}
          {draftError && <p role="alert" className="mt-3 text-sm text-[#ad481d]">{draftError}</p>}
          {letter && <><label className="mt-5 block text-xs font-semibold text-[#51726e]">Editable request<textarea value={letter} onChange={(event) => { setLetter(event.target.value); setDocumentSuccess(""); }} className="mt-2 h-80 w-full resize-y rounded-xl border border-[#cfe2df] bg-[#fbfefd] p-4 text-sm leading-6 text-[#284e49] outline-none focus:border-[#078d87] focus:ring-2 focus:ring-[#078d87]/15" /></label><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={documentBusy} onClick={() => void saveLetterToWorkspace()} className={primaryButton}><FileArrowUp size={17} />{documentBusy ? "Saving PDF…" : "Save PDF to workspace"}</button><button type="button" onClick={() => void downloadLetter()} className={secondaryButton}><DownloadSimple size={17} />Download filled letter PDF</button></div></>}
          {documentSuccess && <p role="status" className="mt-3 text-sm text-[#12705e]">{documentSuccess}</p>}
          <p className="mt-4 text-xs leading-5 text-[#6e8581]">A person must review the statement, calculations and final letter. External portal uploads and email sending are not connected.</p>
        </section>
        <section className={`${card} mt-6 p-6 sm:p-7`} aria-labelledby="documents-heading">
          <div className="flex items-start gap-3"><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#fff0e3] text-[#d0702b]"><FileText size={21} /></span><div><span className="text-[11px] font-semibold uppercase tracking-[.15em] text-[#d0702b]">05 / Workspace documents</span><h2 id="documents-heading" className="mt-1 text-xl font-semibold tracking-tight">Saved documents</h2><p className="mt-1 text-sm text-[#63807b]">Filled PDFs saved in this workspace stay on this device and can be downloaded later.</p></div></div>
          {documentError && <p role="alert" className="mt-4 text-sm text-[#ad481d]">{documentError}</p>}
          {documents.length ? <ul className="mt-5 space-y-3">{documents.map((saved) => <li key={saved.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#d8e9e6] bg-[#f7fbfa] px-4 py-3"><div className="min-w-0"><p className="break-all text-sm font-semibold text-[#1c514c]">{saved.name}</p><p className="mt-1 text-xs text-[#6e8581]">{new Date(saved.savedAt).toLocaleString()} · {(saved.size / 1024).toFixed(1)} KB</p></div><button type="button" onClick={() => void downloadSavedDocument(saved)} className={secondaryButton}><DownloadSimple size={17} />Download</button></li>)}</ul> : <p className="mt-5 rounded-xl border border-dashed border-[#cfe2df] bg-[#f7fbfa] px-4 py-5 text-sm text-[#63807b]">No generated documents saved in this workspace yet.</p>}
          <p className="mt-4 text-xs leading-5 text-[#6e8581]">Only generated PDFs are stored here. Imported statement files are parsed locally; the raw files are not retained.</p>
        </section>
      </div>
      {planWelcome && <div className="fixed inset-0 z-[90] flex items-center justify-center bg-[#123c39]/45 p-5"><section role="dialog" aria-modal="true" aria-labelledby="plan-welcome-title" className="w-full max-w-md rounded-2xl border border-[#d8e9e6] bg-white p-7 shadow-[0_24px_80px_rgba(11,59,54,.2)]"><img src="/chatgpt-logo-white.svg" alt="" width={42} height={42} className="rounded-xl bg-[#171717] p-2.5" /><h2 id="plan-welcome-title" className="mt-5 text-2xl font-semibold tracking-tight text-[#0d4742]">You’re using your ChatGPT plan</h2><p className="mt-3 text-sm leading-6 text-[#56716d]">Eligible AI requests in Open Forensic use your ChatGPT plan or credits. You can review and manage this app’s usage in ChatGPT settings.</p><div className="mt-6 flex flex-wrap gap-2"><button ref={welcomeButton} type="button" onClick={dismissPlanWelcome} className={primaryButton}>Got it</button><a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer" className={secondaryButton}>Manage usage</a></div></section></div>}
    </main>
  );
}
