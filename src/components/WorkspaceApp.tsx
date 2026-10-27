"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import dynamic from "next/dynamic";
import {
  ArrowRight,
  CaretDown,
  CheckCircle,
  Command,
  FileArrowDown,
  FolderOpen,
  List,
  MagnifyingGlass,
  Plus,
  ShieldCheck,
  SlidersHorizontal,
  SquaresFour,
  Table,
  UploadSimple,
  X,
} from "@phosphor-icons/react";
import DashboardView from "./DashboardView";
import { analyzeTransactions } from "@/lib/audit";
import { makeDemoWorkspace, makeEmptyWorkspace } from "@/lib/demo";
import { loadWorkspace, saveWorkspace } from "@/lib/storage";
import type { AuditSettings, ReviewStatus, SourceFile, Transaction, ViewId, Workspace } from "@/lib/types";

const StatementGrid = dynamic(() => import("./StatementGrid"));
const IngestionModal = dynamic(() => import("./IngestionModal"), { ssr: false });
const RulesView = dynamic(() => import("./RulesView"));
const ExportConsole = dynamic(() => import("./ExportConsole").then((module) => module.ExportConsole));

const navGroups = [
  { id: "workspace", label: "WORKSPACE", items: [{ view: "dashboard" as ViewId, label: "Overview", icon: SquaresFour }, { view: "evidence" as ViewId, label: "Evidence ledger", icon: Table }] },
  { id: "engine", label: "AUDIT ENGINE", items: [{ view: "rules" as ViewId, label: "Audit rules", icon: SlidersHorizontal }] },
  { id: "output", label: "OUTPUT", items: [{ view: "exports" as ViewId, label: "Export console", icon: FileArrowDown }] },
];

const viewLabels: Record<ViewId, string> = {
  dashboard: "Overview", evidence: "Evidence ledger", rules: "Audit rules", exports: "Export console",
};

interface CommandItem {
  id: string;
  label: string;
  detail: string;
  icon: typeof SquaresFour;
  action: () => void;
}

function CommandPalette({ items, onClose }: { items: CommandItem[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const filtered = useMemo(() => items.filter((item) => `${item.label} ${item.detail}`.toLowerCase().includes(query.toLowerCase())), [items, query]);

  useEffect(() => { setActive(0); }, [query]);
  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => previousFocus?.focus();
  }, []);

  const choose = (item: CommandItem) => { item.action(); onClose(); };
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setActive((index) => Math.min(index + 1, filtered.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setActive((index) => Math.max(index - 1, 0)); }
    if (event.key === "Enter" && filtered[active]) { event.preventDefault(); choose(filtered[active]); }
  };

  const onDialogKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key !== "Tab") return;
    const focusable = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled]), input:not([disabled])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center bg-zinc-950/40 px-4 pt-[13vh] backdrop-blur-[3px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Command palette" onKeyDown={onDialogKeyDown} className="w-full max-w-[550px] overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_26px_90px_rgba(20,20,20,.22)]">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-5 py-4"><MagnifyingGlass size={18} className="text-zinc-500" /><input ref={inputRef} aria-label="Search pages and actions" value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="Search pages and actions…" className="w-full bg-transparent text-[14px] text-zinc-800 outline-none placeholder:text-zinc-500" /><kbd className="rounded border border-zinc-200 px-1.5 py-1 font-mono text-[10px] text-zinc-500">ESC</kbd></div>
        <div className="max-h-[380px] overflow-y-auto p-2">
          {filtered.length ? filtered.map((item, index) => <button key={item.id} type="button" onMouseEnter={() => setActive(index)} onClick={() => choose(item)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left transition-colors ${index === active ? "bg-zinc-100" : "hover:bg-zinc-50"}`}><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500"><item.icon size={16} /></span><span className="min-w-0"><span className="block text-[12px] font-medium text-zinc-800">{item.label}</span><span className="mt-0.5 block text-[11px] text-zinc-400">{item.detail}</span></span><ArrowRight size={14} className="ml-auto text-zinc-300" /></button>) : <div className="px-4 py-8 text-center text-[12px] text-zinc-400">No matching command</div>}
        </div>
        <div className="flex items-center justify-between border-t border-zinc-100 px-5 py-3 text-[10px] text-zinc-400"><span>Use ↑ ↓ to navigate · ↵ to open</span><span>LedgerGuard command bar</span></div>
      </div>
    </div>
  );
}

export default function WorkspaceApp() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const workspaceRef = useRef<Workspace | null>(null);
  const saveQueue = useRef(Promise.resolve());
  const [view, setView] = useState<ViewId>("dashboard");
  const [ingestionOpen, setIngestionOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [storageError, setStorageError] = useState("");
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const sidebarRef = useRef<HTMLElement>(null);
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const mobileFocusTimer = useRef<number | null>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    let active = true;
    loadWorkspace().then((stored) => {
      if (!active) return;
      const initial = stored ?? makeDemoWorkspace();
      workspaceRef.current = initial;
      setWorkspace(initial);
      if (!stored) void saveWorkspace(initial).catch(() => setStorageError("Browser storage is unavailable. Changes will last only until this tab closes."));
    }).catch(() => {
      if (!active) return;
      const demo = makeDemoWorkspace();
      workspaceRef.current = demo;
      setWorkspace(demo);
      setStorageError("Browser storage is unavailable. Changes will last only until this tab closes.");
    });
    return () => { active = false; };
  }, []);

  const commit = useCallback((transform: (current: Workspace) => Workspace) => {
    const current = workspaceRef.current;
    if (!current) return;
    const next = { ...transform(current), updatedAt: new Date().toISOString() };
    workspaceRef.current = next;
    setWorkspace(next);
    saveQueue.current = saveQueue.current.catch(() => undefined).then(() => saveWorkspace(next)).catch(() => setStorageError("Browser storage is unavailable. Changes will last only until this tab closes."));
  }, []);

  const navigate = useCallback((next: ViewId) => {
    if (mobileFocusTimer.current !== null) window.clearTimeout(mobileFocusTimer.current);
    setView(next);
    setMobileMenuOpen(false);
    setWorkspaceMenuOpen(false);
    window.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, []);

  useEffect(() => {
    document.title = `${viewLabels[view]} — LedgerGuard`;
    if (hasNavigated.current) mainRef.current?.focus({ preventScroll: true });
    hasNavigated.current = true;
  }, [view]);

  const openMobileNavigation = () => {
    flushSync(() => setMobileMenuOpen(true));
    mobileFocusTimer.current = window.setTimeout(() => {
      mobileCloseRef.current?.focus();
      mobileFocusTimer.current = null;
    }, 220);
  };

  const closeMobileNavigation = () => {
    if (mobileFocusTimer.current !== null) window.clearTimeout(mobileFocusTimer.current);
    mobileFocusTimer.current = null;
    flushSync(() => setMobileMenuOpen(false));
    mobileTriggerRef.current?.focus();
  };

  const onSidebarKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (!mobileMenuOpen || event.key !== "Tab") return;
    const focusable = Array.from(sidebarRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? [])
      .filter((button) => button.getClientRects().length > 0);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const onImport = useCallback((transactions: Transaction[], source: SourceFile) => {
    const currencies = new Set(transactions.map((transaction) => transaction.currency));
    if (currencies.size !== 1) throw new Error("This file contains multiple currencies. Split it by currency before importing so totals remain accurate.");
    const currency = transactions[0].currency;
    const current = workspaceRef.current;
    if (current && !current.isDemo && current.transactions.length && current.currency !== currency) throw new Error(`This workspace uses ${current.currency}. Start a new workspace before importing ${currency} transactions.`);
    if (current && !current.isDemo && current.sources.some((existing) => existing.name.toLowerCase() === source.name.toLowerCase())) throw new Error("A source with this filename is already in the workspace. Check that you are not importing the same statement twice.");
    if (current && !current.isDemo && current.transactions.length) {
      const key = (transaction: Transaction) => [transaction.account, transaction.currency, transaction.date, transaction.reference, transaction.description.trim().toLowerCase(), transaction.debit.toFixed(2), transaction.credit.toFixed(2), transaction.balance?.toFixed(2) ?? ""].join("|");
      const existing = new Set(current.transactions.map(key));
      const overlap = transactions.filter((transaction) => existing.has(key(transaction))).length;
      if (overlap) throw new Error(`${overlap} transaction${overlap === 1 ? "" : "s"} already appear in this workspace. Remove overlap before importing to avoid double-counted findings.`);
    }
    commit((previous) => {
      const existingTransactions = previous.isDemo ? [] : previous.transactions;
      const merged = [...existingTransactions, ...transactions];
      const profileConfirmed = !previous.isDemo && previous.profileConfirmed;
      return {
        ...previous,
        name: previous.isDemo ? `${source.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")} audit` : previous.name,
        isDemo: false,
        profileConfirmed,
        currency,
        transactions: merged,
        findings: profileConfirmed ? analyzeTransactions(merged, previous.settings, previous.findings) : [],
        sources: [...(previous.isDemo ? [] : previous.sources), source],
      };
    });
    setView(current && !current.isDemo && current.profileConfirmed ? "evidence" : "rules");
  }, [commit]);

  const onStatusChange = useCallback((findingId: string, status: ReviewStatus) => {
    commit((previous) => ({ ...previous, findings: previous.findings.map((finding) => finding.id === findingId ? { ...finding, status } : finding) }));
  }, [commit]);

  const onApplySettings = useCallback((settings: AuditSettings) => {
    commit((previous) => ({ ...previous, settings, profileConfirmed: true, findings: analyzeTransactions(previous.transactions, settings, previous.findings) }));
  }, [commit]);

  const startEmptyWorkspace = () => {
    if (workspace && !workspace.isDemo && workspace.transactions.length && !window.confirm("Start a new workspace? This will remove the current statements and findings from this browser.")) return;
    const next = makeEmptyWorkspace();
    commit(() => next);
    navigate("dashboard");
  };

  const loadDemo = () => {
    if (workspace && !workspace.isDemo && workspace.transactions.length && !window.confirm("Load the synthetic demo? This will replace the current local workspace.")) return;
    commit(() => makeDemoWorkspace());
    navigate("dashboard");
  };

  const renameWorkspace = () => {
    if (!workspace) return;
    const name = window.prompt("Workspace name", workspace.name)?.trim();
    if (name) commit((previous) => ({ ...previous, name: name.slice(0, 72) }));
    setWorkspaceMenuOpen(false);
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen((open) => !open); }
      if (event.key === "Escape") { setPaletteOpen(false); if (mobileMenuOpen) closeMobileNavigation(); setWorkspaceMenuOpen(false); }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mobileMenuOpen]);

  const commands: CommandItem[] = [
    { id: "dashboard", label: "Open overview", detail: "Executive audit dashboard", icon: SquaresFour, action: () => navigate("dashboard") },
    { id: "evidence", label: "Open evidence ledger", detail: "Inspect and review transactions", icon: Table, action: () => navigate("evidence") },
    { id: "rules", label: "Open audit rules", detail: "Adjust calculations and thresholds", icon: SlidersHorizontal, action: () => navigate("rules") },
    { id: "exports", label: "Open export console", detail: "Prepare PDF, CSV and communication", icon: FileArrowDown, action: () => navigate("exports") },
    { id: "import", label: "Import a statement", detail: "CSV, XLSX or MT940 file", icon: UploadSimple, action: () => setIngestionOpen(true) },
  ];

  const pendingCount = workspace?.findings.filter((finding) => finding.status === "needs-review").length ?? 0;
  const confirmedCount = workspace?.findings.filter((finding) => finding.status === "confirmed").length ?? 0;

  return (
    <div className="min-h-screen bg-canvas">
      <a href="#main-content" tabIndex={mobileMenuOpen ? -1 : undefined} className="sr-only fixed left-4 top-3 z-[100] rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white focus:not-sr-only">Skip to main content</a>
      {mobileMenuOpen && <button type="button" tabIndex={-1} aria-hidden="true" className="fixed inset-0 z-30 bg-zinc-950/30 lg:hidden" onClick={closeMobileNavigation} />}
      <aside id="workspace-navigation" ref={sidebarRef} role={mobileMenuOpen ? "dialog" : undefined} aria-modal={mobileMenuOpen || undefined} aria-label="Workspace navigation" onKeyDown={onSidebarKeyDown} className={`fixed bottom-3 left-3 top-3 z-40 flex w-[234px] flex-col rounded-xl border border-[#343430] bg-[#1D1D1B] text-zinc-300 shadow-[0_10px_35px_rgba(20,20,20,.15)] transition-transform duration-200 lg:bottom-4 lg:left-4 lg:top-4 ${mobileMenuOpen ? "visible translate-x-0" : "invisible -translate-x-[110%] lg:visible lg:translate-x-0"}`}>
        <div className="border-b border-white/[.08] px-4 pb-4 pt-5">
          <div className="flex items-center gap-2.5 px-1"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#A97852] text-white"><ShieldCheck size={18} weight="duotone" /></span><div><div className="text-[16px] font-medium leading-4 tracking-[-0.045em] text-white">ledgerguard</div><div className="mt-1 text-[9px] font-medium uppercase tracking-[0.18em] text-zinc-400">OPENFORENSIC</div></div><button ref={mobileCloseRef} type="button" aria-label="Close navigation" className="ml-auto text-zinc-300 lg:hidden" onClick={closeMobileNavigation}><X size={17} /></button></div>
          <button type="button" onClick={() => setPaletteOpen(true)} className="mt-6 flex h-9 w-full items-center gap-2 rounded-lg border border-white/[.11] bg-white/[.045] px-2.5 text-left text-xs text-zinc-300 transition-colors hover:border-white/[.2] hover:bg-white/[.08]"><MagnifyingGlass size={14} /><span className="flex-1">Search pages and actions</span><kbd className="rounded border border-white/[.13] px-1.5 py-0.5 font-mono text-[9px] text-zinc-400">⌘ K</kbd></button>
        </div>

        <div className="relative px-3 pt-5">
          <p className="px-2 text-[10px] font-medium uppercase tracking-[.15em] text-zinc-400">CURRENT SPACE</p>
          <button type="button" aria-expanded={workspaceMenuOpen} aria-controls="workspace-actions" onClick={() => setWorkspaceMenuOpen((open) => !open)} className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-white/[.09] bg-white/[.05] p-2.5 text-left hover:bg-white/[.08]"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#393530] text-[#c99a76]"><FolderOpen size={15} /></span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-zinc-200">{workspace?.name ?? "Loading workspace"}</span><span className="mt-0.5 block text-[10px] text-zinc-400">{workspace?.isDemo ? "Synthetic demo" : "Browser local"}</span></span><CaretDown size={12} className="text-zinc-400" /></button>
          {workspaceMenuOpen && <div id="workspace-actions" className="absolute left-3 right-3 top-[89px] z-50 rounded-lg border border-white/[.12] bg-[#2A2A28] p-1.5 shadow-2xl"><button type="button" onClick={renameWorkspace} className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[.08]">Rename workspace</button><button type="button" onClick={startEmptyWorkspace} className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[.08]">New empty workspace</button><button type="button" onClick={loadDemo} className="block w-full rounded-md px-3 py-2 text-left text-xs text-zinc-200 hover:bg-white/[.08]">Load synthetic demo</button></div>}
        </div>

        <nav className="mt-5 flex-1 overflow-y-auto px-3 pb-5" aria-label="Main navigation">
          {navGroups.map((group) => <div key={group.id} className="mb-5"><button type="button" onClick={() => setCollapsed((current) => ({ ...current, [group.id]: !current[group.id] }))} aria-expanded={!collapsed[group.id]} className="flex w-full items-center justify-between px-2 py-2 text-[10px] font-medium tracking-[.15em] text-zinc-400 hover:text-zinc-200"><span>{group.label}</span><CaretDown size={11} className={`transition-transform ${collapsed[group.id] ? "-rotate-90" : ""}`} /></button>{!collapsed[group.id] && <div className="mt-1 space-y-0.5">{group.items.map((item) => <button key={item.view} type="button" onClick={() => navigate(item.view)} aria-current={view === item.view ? "page" : undefined} className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-xs font-medium transition-colors ${view === item.view ? "bg-white/[.1] text-white" : "text-zinc-300 hover:bg-white/[.055] hover:text-white"}`}><item.icon size={16} weight={view === item.view ? "duotone" : "regular"} /><span className="flex-1">{item.label}</span>{item.view === "evidence" && pendingCount > 0 && <span className="rounded bg-[#6B4C37] px-1.5 py-0.5 font-mono text-[10px] text-[#F4D9C2]">{pendingCount}</span>}{item.view === "exports" && confirmedCount > 0 && <span className="rounded bg-white/[.08] px-1.5 py-0.5 font-mono text-[10px] text-zinc-300">{confirmedCount}</span>}</button>)}</div>}</div>)}
          <div className="mt-8 border-t border-white/[.08] pt-4"><button type="button" onClick={() => setIngestionOpen(true)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-xs font-medium text-zinc-300 hover:bg-white/[.06] hover:text-white"><Plus size={15} /> Add statement <ArrowRight size={13} className="ml-auto" /></button></div>
        </nav>

        <div className="m-3 rounded-lg border border-white/[.09] bg-white/[.045] p-3"><div className="flex items-center gap-2"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500/20" /><span className="relative h-2 w-2 rounded-full bg-emerald-500" /></span><span className="text-[11px] font-medium text-zinc-200">Local session</span><CheckCircle size={13} className="ml-auto text-emerald-500" /></div><p className="mt-2 text-[11px] leading-4 text-zinc-300">Statements are parsed and stored in this browser.</p></div>
      </aside>

      <div aria-hidden={mobileMenuOpen || undefined} className="min-w-0 lg:pl-[268px]">
        <header className="sticky top-0 z-20 flex h-[65px] items-center justify-between border-b border-zinc-200/70 bg-canvas/95 px-5 backdrop-blur-md sm:px-8 lg:px-10"><div className="flex min-w-0 items-center gap-3"><button ref={mobileTriggerRef} type="button" aria-label="Open navigation" aria-controls="workspace-navigation" aria-expanded={mobileMenuOpen} className="rounded-md p-1 text-zinc-500 lg:hidden" onClick={openMobileNavigation}><List size={19} /></button><span className="hidden text-[11px] font-medium text-zinc-400 sm:inline">Workspace</span><span className="hidden text-zinc-300 sm:inline">/</span><span className="truncate text-[11px] font-medium text-zinc-800">{viewLabels[view]}</span></div><div className="flex items-center gap-2.5"><span className="hidden items-center gap-1.5 rounded-md border border-emerald-200/70 bg-emerald-50/60 px-2.5 py-1.5 text-[10px] font-medium text-emerald-700 sm:inline-flex"><ShieldCheck size={13} /> Browser local</span><button type="button" onClick={() => setPaletteOpen(true)} aria-label="Open command palette" className="flex h-8 w-8 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 hover:text-zinc-800"><Command size={16} /></button><button type="button" onClick={() => setIngestionOpen(true)} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[11px] font-medium text-white hover:bg-zinc-700"><Plus size={14} /> <span className="hidden sm:inline">Import</span></button></div></header>
        {storageError && <div role="status" className="mx-5 mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-[11px] text-amber-900 sm:mx-8 lg:mx-10">{storageError}</div>}
        <main id="main-content" ref={mainRef} tabIndex={-1} aria-label={viewLabels[view]} className="min-h-[calc(100vh-65px)] outline-none">
          {!workspace ? <div className="mx-auto max-w-[1500px] animate-pulse space-y-5 px-5 pt-9 sm:px-8 lg:px-10"><div className="h-10 w-52 rounded-md bg-zinc-200" /><div className="grid gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((value) => <div key={value} className="h-32 rounded-xl bg-zinc-200/70" />)}</div><div className="h-72 rounded-xl bg-zinc-200/70" /></div> : view === "dashboard" ? <DashboardView workspace={workspace} onOpenIngestion={() => setIngestionOpen(true)} onNavigate={navigate} /> : view === "rules" ? <RulesView workspace={workspace} onApply={onApplySettings} /> : <div className="mx-auto max-w-[1500px] px-5 pb-16 pt-8 sm:px-8 lg:px-10">{view === "evidence" ? <StatementGrid workspace={workspace} onStatusChange={onStatusChange} /> : <ExportConsole workspace={workspace} onGoEvidence={() => navigate("evidence")} />}</div>}
        </main>
      </div>
      {ingestionOpen && <IngestionModal open={ingestionOpen} onClose={() => setIngestionOpen(false)} onImport={onImport} />}
      {paletteOpen && <CommandPalette items={commands} onClose={() => setPaletteOpen(false)} />}
    </div>
  );
}
