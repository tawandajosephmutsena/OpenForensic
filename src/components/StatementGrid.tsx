"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CaretLeft,
  CaretRight,
  Check,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { formatDate, formatMoney } from "@/lib/format";
import type {
  Finding,
  FindingType,
  ReviewStatus,
  Transaction,
  Workspace,
} from "@/lib/types";

type EvidenceRow = { transaction: Transaction; findings: Finding[]; variance: number };
type SortField = "date" | "description" | "debit" | "discrepancy";
type StatusFilter = "all" | ReviewStatus | "clear";

const PAGE_SIZE = 40;
const categories: { value: "all" | FindingType; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "interest", label: "Interest" },
  { value: "tax", label: "Tax & levy" },
  { value: "duplicate", label: "Duplicate fees" },
  { value: "penalty", label: "Penalties" },
];

const typeLabel: Record<FindingType, string> = {
  interest: "Interest",
  tax: "Tax & levy",
  duplicate: "Duplicate fee",
  penalty: "Penalty",
};

const statusLabel: Record<ReviewStatus, string> = {
  "needs-review": "Needs review",
  confirmed: "Confirmed",
  excluded: "Excluded",
};

function rowStatus(findings: Finding[]): ReviewStatus | "clear" {
  if (findings.length === 0) return "clear";
  if (findings.some((finding) => finding.status === "needs-review")) return "needs-review";
  if (findings.some((finding) => finding.status === "confirmed")) return "confirmed";
  return "excluded";
}

function StatusPill({ status }: { status: ReviewStatus | "clear" }) {
  const styles: Record<ReviewStatus | "clear", string> = {
    "needs-review": "border-amber-200/80 bg-amber-50 text-amber-800",
    confirmed: "border-emerald-200/80 bg-emerald-50 text-emerald-700",
    excluded: "border-zinc-200 bg-zinc-100 text-zinc-500",
    clear: "border-zinc-200/70 bg-white text-zinc-400",
  };

  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-1 text-[10px] font-medium tracking-[0.01em] ${styles[status]}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${status === "confirmed" ? "bg-emerald-500" : status === "needs-review" ? "bg-amber-500" : "bg-zinc-300"}`} />
      {status === "clear" ? "Clear" : statusLabel[status]}
    </span>
  );
}

function money(value: number, currency: string) {
  return formatMoney(value, currency);
}

export default function StatementGrid({
  workspace,
  onStatusChange,
}: {
  workspace: Workspace;
  onStatusChange: (findingId: string, status: ReviewStatus) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<"all" | FindingType>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [sortField, setSortField] = useState<SortField>("date");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const detailRef = useRef<HTMLElement>(null);
  const detailCloseRef = useRef<HTMLButtonElement>(null);

  const findingsByTransaction = useMemo(() => {
    const index = new Map<string, Finding[]>();
    for (const finding of workspace.findings) {
      const current = index.get(finding.transactionId) ?? [];
      current.push(finding);
      index.set(finding.transactionId, current);
    }
    return index;
  }, [workspace.findings]);

  const rows = useMemo<EvidenceRow[]>(
    () => workspace.transactions.map((transaction) => {
      const findings = findingsByTransaction.get(transaction.id) ?? [];
      return {
        transaction,
        findings,
        variance: findings.reduce((sum, finding) => sum + finding.discrepancy, 0),
      };
    }),
    [workspace.transactions, findingsByTransaction],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (category !== "all" && !row.findings.some((finding) => finding.type === category)) return false;
      if (status === "clear" && row.findings.length !== 0) return false;
      if (status !== "all" && status !== "clear" && !row.findings.some((finding) => finding.status === status)) return false;
      if (!query) return true;

      const transaction = row.transaction;
      return [
        transaction.date,
        transaction.description,
        transaction.reference,
        transaction.account,
        transaction.source,
        transaction.id,
        ...row.findings.map((finding) => typeLabel[finding.type]),
      ].some((value) => value.toLowerCase().includes(query));
    });

    filtered.sort((a, b) => {
      let comparison = 0;
      if (sortField === "date") comparison = a.transaction.date.localeCompare(b.transaction.date);
      if (sortField === "description") comparison = a.transaction.description.localeCompare(b.transaction.description);
      if (sortField === "debit") comparison = a.transaction.debit - b.transaction.debit;
      if (sortField === "discrepancy") comparison = a.variance - b.variance;
      return (sortDirection === "asc" ? comparison : -comparison) || b.transaction.date.localeCompare(a.transaction.date);
    });
    return filtered;
  }, [rows, search, category, status, sortField, sortDirection]);

  useEffect(() => setPage(1), [search, category, status, sortField, sortDirection]);

  useEffect(() => {
    if (!selectedId) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    detailCloseRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => { window.removeEventListener("keydown", onKeyDown); previousFocus?.focus(); };
  }, [selectedId]);

  const onDetailKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") return;
    const focusable = Array.from(detailRef.current?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  const selected = selectedId ? rows.find((row) => row.transaction.id === selectedId) : undefined;
  const pageCount = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount);
  const visibleRows = filteredRows.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const firstVisible = filteredRows.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const lastVisible = Math.min(currentPage * PAGE_SIZE, filteredRows.length);
  const reviewCount = workspace.findings.filter((finding) => finding.status === "needs-review").length;
  const flaggedCount = rows.filter((row) => row.findings.length > 0).length;

  function changeSort(field: SortField) {
    if (field === sortField) {
      setSortDirection((direction) => direction === "desc" ? "asc" : "desc");
    } else {
      setSortField(field);
      setSortDirection(field === "description" ? "asc" : "desc");
    }
  }

  function sortIcon(field: SortField) {
    if (sortField !== field) return <ArrowDown size={12} className="opacity-0 transition-opacity group-hover:opacity-40" />;
    return sortDirection === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />;
  }

  return (
    <section className="min-w-0 space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            Evidence ledger <span className="h-px w-5 bg-zinc-300" /> {workspace.transactions.length.toLocaleString()} transactions
          </div>
          <h1 className="text-[27px] font-medium tracking-[-0.045em] text-zinc-900">Statement analysis</h1>
          <p className="mt-1 text-[13px] text-zinc-500">Trace every finding to its source transaction and review the calculation.</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-zinc-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-amber-500" />{reviewCount.toLocaleString()} to review</span>
          <span className="h-4 w-px bg-zinc-200" />
          <span>{flaggedCount.toLocaleString()} flagged entries</span>
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.035)]">
        <div className="border-b border-zinc-200/70 px-4 pb-4 pt-4 sm:px-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative min-w-[230px] flex-1 sm:max-w-[360px]">
              <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
              <input
                aria-label="Search transactions"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search transactions or references..."
                className="h-9 w-full rounded-lg border border-zinc-200 bg-zinc-50/60 pl-9 pr-3 text-xs text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:bg-white focus:ring-2 focus:ring-zinc-900/5"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="sr-only" htmlFor="evidence-status">Filter by review status</label>
              <select
                id="evidence-status"
                value={status}
                onChange={(event) => setStatus(event.target.value as StatusFilter)}
                className="h-9 rounded-lg border border-zinc-200 bg-white px-3 text-xs font-medium text-zinc-600 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-900/5"
              >
                <option value="all">All statuses</option>
                <option value="needs-review">Needs review</option>
                <option value="confirmed">Confirmed</option>
                <option value="excluded">Excluded</option>
                <option value="clear">Clear</option>
              </select>
            </div>
          </div>
          <div className="mt-4 flex gap-1 overflow-x-auto pb-0.5">
            {categories.map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => setCategory(item.value)}
                aria-pressed={category === item.value}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-[11px] font-medium transition ${category === item.value ? "bg-zinc-900 text-white" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        <div className="divide-y divide-zinc-100 sm:hidden">
          {visibleRows.map((row) => {
            const transaction = row.transaction;
            const primaryFinding = row.findings[0];
            return (
              <article key={transaction.id} className="px-4 py-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium tabular-nums text-zinc-500">{formatDate(transaction.date)}</p>
                    <h3 className="mt-1 text-sm font-medium leading-5 text-zinc-900">{transaction.description}</h3>
                    <p className="mt-0.5 break-all font-mono text-[11px] text-zinc-500">{transaction.reference || transaction.id}</p>
                  </div>
                  <StatusPill status={rowStatus(row.findings)} />
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 rounded-lg bg-zinc-50 px-3 py-3">
                  <div className="col-span-2 min-w-0"><dt className="text-[10px] uppercase tracking-wide text-zinc-500">Account</dt><dd className="mt-0.5 break-words text-xs font-medium text-zinc-700">{transaction.account}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wide text-zinc-500">Debit</dt><dd className="mt-0.5 text-xs font-medium tabular-nums text-zinc-800">{transaction.debit ? money(transaction.debit, transaction.currency) : "—"}</dd></div>
                  <div><dt className="text-[10px] uppercase tracking-wide text-zinc-500">Credit</dt><dd className="mt-0.5 text-xs font-medium tabular-nums text-zinc-800">{transaction.credit ? money(transaction.credit, transaction.currency) : "—"}</dd></div>
                </dl>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs">
                  <span className="min-w-0 text-zinc-600">{primaryFinding ? <><span className="font-medium text-amber-800">{typeLabel[primaryFinding.type]}</span>{row.findings.length > 1 && <span className="ml-1 text-zinc-500">+{row.findings.length - 1}</span>}</> : "No finding"}</span>
                  <span className={`shrink-0 font-mono font-medium tabular-nums ${row.findings.length ? "text-amber-800" : "text-zinc-400"}`}>{row.findings.length ? money(row.variance, transaction.currency) : "—"}</span>
                </div>
                <button type="button" onClick={() => setSelectedId(transaction.id)} aria-label={`View evidence for ${transaction.description}`} className="mt-3 flex w-full items-center justify-between border-t border-zinc-100 pt-3 text-xs font-medium text-zinc-800">
                  View evidence <ArrowRight size={14} aria-hidden="true" />
                </button>
              </article>
            );
          })}
        </div>

        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[1010px] table-fixed border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-zinc-50/95 backdrop-blur-sm">
              <tr className="border-b border-zinc-200/80 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
                <th className="w-[94px] px-5 py-3 font-medium" aria-sort={sortField === "date" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("date")} className="group flex items-center gap-1.5 hover:text-zinc-700">Date {sortIcon("date")}</button>
                </th>
                <th className="w-[258px] px-3 py-3 font-medium" aria-sort={sortField === "description" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("description")} className="group flex items-center gap-1.5 hover:text-zinc-700">Transaction / reference {sortIcon("description")}</button>
                </th>
                <th className="w-[106px] px-3 py-3 font-medium">Account</th>
                <th className="w-[112px] px-3 py-3 text-right font-medium" aria-sort={sortField === "debit" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("debit")} className="group ml-auto flex items-center gap-1.5 hover:text-zinc-700">Debit {sortIcon("debit")}</button>
                </th>
                <th className="w-[112px] px-3 py-3 text-right font-medium">Credit</th>
                <th className="w-[120px] px-3 py-3 font-medium">Finding</th>
                <th className="w-[118px] px-3 py-3 text-right font-medium" aria-sort={sortField === "discrepancy" ? sortDirection === "asc" ? "ascending" : "descending" : "none"}>
                  <button type="button" onClick={() => changeSort("discrepancy")} className="group ml-auto flex items-center gap-1.5 hover:text-zinc-700">Variance {sortIcon("discrepancy")}</button>
                </th>
                <th className="w-[118px] px-3 py-3 font-medium">Review</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {visibleRows.map((row) => {
                const transaction = row.transaction;
                const primaryFinding = row.findings[0];
                return (
                  <tr
                    key={transaction.id}
                    onClick={() => setSelectedId(transaction.id)}
                    className="group cursor-pointer transition-colors hover:bg-zinc-50/80"
                  >
                    <td className="whitespace-nowrap px-5 py-3.5 text-[11px] tabular-nums text-zinc-500">{formatDate(transaction.date, { year: "2-digit" })}</td>
                    <td className="px-3 py-3.5">
                      <button type="button" className="block w-full text-left focus-visible:rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-zinc-900" aria-label={`View evidence for ${transaction.description}`}>
                        <span className="block truncate text-xs font-medium text-zinc-800 group-hover:text-zinc-950">{transaction.description}</span>
                        <span className="mt-0.5 block truncate font-mono text-[10px] text-zinc-400">{transaction.reference || transaction.id}</span>
                      </button>
                    </td>
                    <td className="truncate px-3 py-3.5 text-[11px] text-zinc-500" title={transaction.account}>{transaction.account}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right text-[11px] font-medium tabular-nums text-zinc-700">{transaction.debit ? money(transaction.debit, transaction.currency) : "—"}</td>
                    <td className="whitespace-nowrap px-3 py-3.5 text-right text-[11px] font-medium tabular-nums text-zinc-700">{transaction.credit ? money(transaction.credit, transaction.currency) : "—"}</td>
                    <td className="px-3 py-3.5">
                      {primaryFinding ? (
                        <span className="inline-flex max-w-full items-center gap-1.5">
                          <span className="truncate rounded-md border border-amber-200/70 bg-amber-50/70 px-2 py-1 text-[10px] font-medium text-amber-800">{typeLabel[primaryFinding.type]}</span>
                          {row.findings.length > 1 && <span className="text-[10px] text-zinc-400">+{row.findings.length - 1}</span>}
                        </span>
                      ) : <span className="text-[11px] text-zinc-300">No finding</span>}
                    </td>
                    <td className={`whitespace-nowrap px-3 py-3.5 text-right text-[11px] font-medium tabular-nums ${row.findings.length ? "text-amber-800" : "text-zinc-300"}`}>
                      {row.findings.length ? money(row.variance, transaction.currency) : "—"}
                    </td>
                    <td className="px-3 py-3.5"><StatusPill status={rowStatus(row.findings)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {visibleRows.length === 0 && (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
            <MagnifyingGlass size={20} className="text-zinc-300" />
            <h3 className="mt-3 text-sm font-medium text-zinc-800">No matching transactions</h3>
            <p className="mt-1 max-w-sm text-xs leading-5 text-zinc-500">Adjust the search or filters to see more of this ledger.</p>
            <button type="button" onClick={() => { setSearch(""); setCategory("all"); setStatus("all"); }} className="mt-4 text-xs font-medium text-zinc-800 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-800">Clear filters</button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200/70 px-5 py-3 text-[11px] text-zinc-500">
          <span>Showing <span className="font-medium text-zinc-700">{firstVisible}–{lastVisible}</span> of <span className="font-medium text-zinc-700">{filteredRows.length.toLocaleString()}</span> transactions</span>
          <div className="flex items-center gap-2">
            <span className="mr-1 tabular-nums">Page {currentPage} of {pageCount}</span>
            <button type="button" onClick={() => setPage((value) => Math.max(1, value - 1))} disabled={currentPage === 1} aria-label="Previous page" className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"><CaretLeft size={13} /></button>
            <button type="button" onClick={() => setPage((value) => Math.min(pageCount, value + 1))} disabled={currentPage === pageCount} aria-label="Next page" className="flex h-7 w-7 items-center justify-center rounded-md border border-zinc-200 text-zinc-600 transition hover:border-zinc-300 hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-35"><CaretRight size={13} /></button>
          </div>
        </div>
      </div>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end" role="presentation">
          <button type="button" tabIndex={-1} aria-hidden="true" onClick={() => setSelectedId(null)} className="absolute inset-0 bg-zinc-950/25 backdrop-blur-[2px]" />
          <aside ref={detailRef} role="dialog" aria-modal="true" aria-labelledby="evidence-detail-title" onKeyDown={onDetailKeyDown} className="relative flex h-full w-full max-w-[490px] flex-col border-l border-zinc-200 bg-[#FBFBFD] shadow-[-12px_0_40px_rgba(0,0,0,0.08)]">
            <div className="flex items-start justify-between border-b border-zinc-200/80 bg-white px-6 py-5">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Transaction evidence</p>
                <h2 id="evidence-detail-title" className="mt-1 text-lg font-medium tracking-[-0.035em] text-zinc-900">{selected.transaction.description}</h2>
                <p className="mt-1 font-mono text-[11px] text-zinc-400">{selected.transaction.reference || selected.transaction.id}</p>
              </div>
              <button ref={detailCloseRef} type="button" onClick={() => setSelectedId(null)} aria-label="Close details" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"><X size={16} /></button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
              <div className="rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium text-zinc-800">Source transaction</h3>
                  <StatusPill status={rowStatus(selected.findings)} />
                </div>
                <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4">
                  <Detail label="Posted" value={formatDate(selected.transaction.date)} />
                  <Detail label="Account" value={selected.transaction.account} />
                  <Detail label="Debit" value={money(selected.transaction.debit, selected.transaction.currency)} mono />
                  <Detail label="Credit" value={money(selected.transaction.credit, selected.transaction.currency)} mono />
                  <Detail label="Running balance" value={selected.transaction.balance === null ? "Not provided" : money(selected.transaction.balance, selected.transaction.currency)} mono />
                  <Detail label="Source file" value={selected.transaction.source} />
                </dl>
              </div>

              <div className="mt-7 flex items-center justify-between">
                <h3 className="text-xs font-medium text-zinc-800">Audit findings</h3>
                <span className="font-mono text-[11px] text-zinc-400">{String(selected.findings.length).padStart(2, "0")}</span>
              </div>
              {selected.findings.length === 0 ? (
                <div className="mt-3 rounded-xl border border-zinc-200/80 bg-white px-5 py-8 text-center">
                  <div className="mx-auto flex h-8 w-8 items-center justify-center rounded-full bg-zinc-100 text-zinc-500"><Check size={16} /></div>
                  <p className="mt-3 text-xs font-medium text-zinc-700">No rule findings on this transaction</p>
                  <p className="mt-1 text-[11px] leading-5 text-zinc-500">This entry remains visible for source traceability.</p>
                </div>
              ) : (
                <div className="mt-3 space-y-3">
                  {selected.findings.map((finding) => (
                    <div key={finding.id} className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
                      <div className="flex items-center justify-between gap-2 border-b border-zinc-100 px-5 py-3.5">
                        <span className="text-xs font-medium text-zinc-800">{typeLabel[finding.type]}</span>
                        <StatusPill status={finding.status} />
                      </div>
                      <div className="px-5 py-4">
                        <p className="text-xs leading-5 text-zinc-600">{finding.explanation}</p>
                        <div className="mt-4 grid grid-cols-3 gap-3 rounded-lg border border-zinc-100 bg-zinc-50/70 p-3">
                          <Detail label="Bank charged" value={money(finding.actual, selected.transaction.currency)} mono />
                          <Detail label="Expected" value={money(finding.expected, selected.transaction.currency)} mono />
                          <Detail label="Difference" value={money(finding.discrepancy, selected.transaction.currency)} mono emphasis />
                        </div>
                        <div className="mt-4">
                          <p className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">Audit math / assumptions</p>
                          <p className="mt-1.5 whitespace-pre-wrap text-[11px] leading-5 text-zinc-600">{finding.calculation}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-end gap-2 border-t border-zinc-100 bg-zinc-50/50 px-4 py-3">
                        {finding.status === "needs-review" ? (
                          <>
                            <button type="button" onClick={() => onStatusChange(finding.id, "excluded")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"><X size={12} />Exclude</button>
                            <button type="button" onClick={() => onStatusChange(finding.id, "confirmed")} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-zinc-900 px-3 text-[11px] font-medium text-white hover:bg-zinc-700"><Check size={12} />Confirm finding</button>
                          </>
                        ) : (
                          <button type="button" onClick={() => onStatusChange(finding.id, "needs-review")} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-[11px] font-medium text-zinc-600 hover:border-zinc-300 hover:text-zinc-900"><ArrowCounterClockwise size={12} />Reopen review</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="border-t border-zinc-200/80 bg-white px-6 py-3 text-[10px] leading-4 text-zinc-400">Findings are calculated from the active audit rules. Review source documents and assumptions before using them externally.</div>
          </aside>
        </div>
      )}
    </section>
  );
}

function Detail({ label, value, mono = false, emphasis = false }: { label: string; value: string; mono?: boolean; emphasis?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[10px] text-zinc-400">{label}</dt>
      <dd className={`mt-1 break-words text-[11px] ${mono ? "font-mono tabular-nums" : "font-medium"} ${emphasis ? "text-amber-800" : "text-zinc-700"}`}>{value}</dd>
    </div>
  );
}
