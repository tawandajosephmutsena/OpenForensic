"use client";

import { useMemo } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  ChartLineUp,
  CheckCircle,
  Clock,
  FileText,
  ShieldCheck,
  UploadSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate, formatMoney } from "@/lib/format";
import type { FindingType, ViewId, Workspace } from "@/lib/types";

interface DashboardViewProps {
  workspace: Workspace;
  onOpenIngestion: () => void;
  onNavigate: (view: ViewId) => void;
}

const categoryMeta: Record<
  FindingType,
  { label: string; color: string; lightColor: string }
> = {
  interest: { label: "Interest", color: "#a76c43", lightColor: "#f5eee8" },
  tax: { label: "Tax & levy", color: "#bc9070", lightColor: "#f7f0e9" },
  duplicate: { label: "Duplicate fees", color: "#57534e", lightColor: "#f1f0ee" },
  penalty: { label: "Penalty fees", color: "#96918b", lightColor: "#f3f2f0" },
};

const categories: FindingType[] = ["interest", "tax", "duplicate", "penalty"];

function monthKey(date: string) {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? "" : date.slice(0, 7);
}

function shortDate(value: string) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(parsed);
}

function FindingLabel({ type }: { type: FindingType }) {
  const meta = categoryMeta[type];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium leading-none"
      style={{ backgroundColor: meta.lightColor, color: meta.color }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
      {meta.label}
    </span>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon: Icon,
  emphasized = false,
  sparkline,
  sparklineColor = "#a76c43",
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof ChartLineUp;
  emphasized?: boolean;
  sparkline?: number[];
  sparklineColor?: string;
}) {
  const highest = Math.max(...(sparkline ?? []), 0);
  const lowest = Math.min(...(sparkline ?? []), 0);
  const points = sparkline?.map((amount, index) => `${index * 12},${20 - ((amount - lowest) / (highest - lowest || 1)) * 17}`).join(" ");
  return (
    <div className="min-w-0 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[12px] font-medium tracking-tight text-zinc-500">{label}</span>
        {sparkline?.length ? <svg aria-hidden="true" width="62" height="24" viewBox="0 0 62 24" className="shrink-0 overflow-visible"><polyline points={points} fill="none" stroke={sparklineColor} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg> : <Icon size={16} weight="regular" className="shrink-0 text-zinc-400" />}
      </div>
      <div
        className={`mt-5 truncate font-medium tracking-[-0.055em] text-zinc-900 ${
          emphasized ? "text-[30px] leading-none sm:text-[34px]" : "text-[27px] leading-none sm:text-[30px]"
        }`}
        title={value}
      >
        {value}
      </div>
      <div className="mt-3 truncate text-[11px] text-zinc-400" title={detail}>
        {detail}
      </div>
    </div>
  );
}

export default function DashboardView({
  workspace,
  onOpenIngestion,
  onNavigate,
}: DashboardViewProps) {
  const data = useMemo(() => {
    const transactionsById = new Map(workspace.transactions.map((row) => [row.id, row]));
    const activeFindings = workspace.findings.filter(
      (finding) => finding.status !== "excluded" && finding.discrepancy > 0,
    );
    const potential = activeFindings.reduce((sum, finding) => sum + finding.discrepancy, 0);
    const confirmed = activeFindings
      .filter((finding) => finding.status === "confirmed")
      .reduce((sum, finding) => sum + finding.discrepancy, 0);
    const needsReview = workspace.findings.filter(
      (finding) => finding.status === "needs-review",
    ).length;
    const reviewed = workspace.findings.length - needsReview;
    const categoriesWithTotals = categories.map((type) => {
      const matching = activeFindings.filter((finding) => finding.type === type);
      return {
        type,
        amount: matching.reduce((sum, finding) => sum + finding.discrepancy, 0),
        count: matching.length,
      };
    });

    const datedTransactions = workspace.transactions
      .map((row) => monthKey(row.date))
      .filter(Boolean)
      .sort();
    const endMonth = datedTransactions.at(-1);
    const months: { key: string; label: string; amount: number; confirmedAmount: number }[] = [];
    if (endMonth) {
      const [year, month] = endMonth.split("-").map(Number);
      for (let offset = 5; offset >= 0; offset--) {
        const date = new Date(year, month - 1 - offset, 1);
        months.push({
          key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
          label: new Intl.DateTimeFormat("en-US", { month: "short" }).format(date),
          amount: 0,
          confirmedAmount: 0,
        });
      }
      const monthIndex = new Map(months.map((item, index) => [item.key, index]));
      for (const finding of activeFindings) {
        const key = monthKey(transactionsById.get(finding.transactionId)?.date ?? "");
        const index = monthIndex.get(key);
        if (index !== undefined) {
          months[index].amount += finding.discrepancy;
          if (finding.status === "confirmed") months[index].confirmedAmount += finding.discrepancy;
        }
      }
    }

    const recent = [...workspace.findings]
      .sort((a, b) => {
        const aDate = transactionsById.get(a.transactionId)?.date ?? "";
        const bDate = transactionsById.get(b.transactionId)?.date ?? "";
        return bDate.localeCompare(aDate);
      })
      .slice(0, 4)
      .map((finding) => ({ finding, transaction: transactionsById.get(finding.transactionId) }));

    return {
      potential,
      confirmed,
      needsReview,
      reviewed,
      categoriesWithTotals,
      months,
      recent,
    };
  }, [workspace]);

  const hasData = workspace.transactions.length > 0;
  const reviewProgress = workspace.findings.length
    ? Math.round((data.reviewed / workspace.findings.length) * 100)
    : 0;
  const largestCategory = Math.max(...data.categoriesWithTotals.map((item) => item.amount), 0);

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-6 px-5 pb-16 pt-7 sm:px-8 lg:px-10 lg:pt-9">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.18em] text-zinc-400">
            <span className="h-1.5 w-1.5 rounded-full bg-[#b98159]" />
            Audit workspace
            <span className="text-zinc-300">/</span>
            Overview
          </div>
          <h1 className="truncate text-[31px] font-medium tracking-[-0.055em] text-zinc-900 sm:text-[36px]">
            {workspace.name || "Overview"}
          </h1>
          <p className="mt-1.5 text-[13px] text-zinc-500">
            A focused view of statement activity, variances and review progress.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onNavigate("evidence")}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-3.5 text-[12px] font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600"
          >
            Review evidence
            <ArrowUpRight size={14} />
          </button>
          <button
            type="button"
            onClick={onOpenIngestion}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-zinc-900 px-3.5 text-[12px] font-medium text-white shadow-[0_3px_8px_rgba(24,24,27,0.12)] transition-colors hover:bg-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-600"
          >
            <UploadSimple size={15} />
            Import statement
          </button>
        </div>
      </div>

      {workspace.isDemo && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#eadbcb] bg-[#fbf7f2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 flex h-5 w-5 items-center justify-center rounded bg-[#f0e6da]">
              <ShieldCheck size={13} className="text-[#a36b45]" />
            </span>
            <p className="text-[12px] leading-5 text-[#72553f]">
              <span className="font-medium">Demonstration workspace.</span> These are synthetic transactions and findings for product exploration.
            </p>
          </div>
          <button
            type="button"
            onClick={onOpenIngestion}
            className="ml-7 inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-[#8e5b3a] hover:text-[#6f452c] sm:ml-0"
          >
            Use your data <ArrowRight size={13} />
          </button>
        </div>
      )}

      {!workspace.isDemo && !workspace.profileConfirmed && workspace.transactions.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-[#eadbcb] bg-[#fbf7f2] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-[12px] leading-5 text-[#72553f]"><span className="font-medium">Audit profile needs review.</span> Apply verified account and tax assumptions before scanning this statement.</p>
          <button type="button" onClick={() => onNavigate("rules")} className="inline-flex items-center gap-1 whitespace-nowrap text-[11px] font-medium text-[#8e5b3a] hover:text-[#6f452c]">Configure rules <ArrowRight size={13} /></button>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 min-[1400px]:grid-cols-4">
        <MetricCard
          label="Potential overcharge"
          value={workspace.profileConfirmed ? formatMoney(data.potential, workspace.currency) : "—"}
          detail={workspace.profileConfirmed ? `${data.categoriesWithTotals.reduce((sum, item) => sum + item.count, 0)} active positive discrepancies` : "Apply an audit profile to scan"}
          icon={ChartLineUp}
          emphasized
          sparkline={data.months.map((month) => month.amount)}
        />
        <MetricCard
          label="Confirmed amount"
          value={formatMoney(data.confirmed, workspace.currency)}
          detail="From findings marked confirmed"
          icon={CheckCircle}
          sparkline={data.months.map((month) => month.confirmedAmount)}
          sparklineColor="#5F8065"
        />
        <MetricCard
          label="Needs review"
          value={data.needsReview.toLocaleString("en-US")}
          detail={`${workspace.findings.length.toLocaleString("en-US")} findings detected`}
          icon={Clock}
        />
        <MetricCard
          label="Transactions analyzed"
          value={workspace.transactions.length.toLocaleString("en-US")}
          detail={`${workspace.sources.length} source ${workspace.sources.length === 1 ? "file" : "files"} in this workspace`}
          icon={FileText}
        />
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="min-w-0 rounded-xl border border-zinc-200/80 bg-white px-5 pb-4 pt-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:px-6 sm:pt-6 xl:col-span-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Variance activity</p>
              <h2 className="mt-1.5 text-[15px] font-medium tracking-tight text-zinc-800">Detected overcharges over time</h2>
              <p className="mt-1 text-[11px] text-zinc-400">Positive, non-excluded discrepancies by transaction month</p>
            </div>
            <span className="rounded-md border border-zinc-200 px-2.5 py-1.5 text-[10px] font-medium text-zinc-500">
              Last 6 statement months
            </span>
          </div>
          {hasData ? (
            <div className="mt-6 h-[230px] w-full sm:h-[270px]" aria-label="Monthly detected overcharges chart">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.months} margin={{ top: 12, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="ledgerguard-variance-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a76c43" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#a76c43" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#a1a1aa", fontSize: 11 }}
                    tickMargin={12}
                  />
                  <YAxis hide domain={[0, (maximum: number) => Math.ceil(maximum * 1.15)]} />
                  <Tooltip
                    cursor={{ stroke: "#d6d3d1", strokeWidth: 1, strokeDasharray: "3 4" }}
                    content={(tooltip: unknown) => {
                      const { active, payload, label } = tooltip as { active?: boolean; payload?: readonly { value?: unknown }[]; label?: string };
                      return active && payload?.length ? (
                        <div className="rounded-lg border border-white/10 bg-zinc-900/95 px-3 py-2.5 text-white shadow-xl backdrop-blur-sm">
                          <div className="text-[10px] text-zinc-400">{label} · detected variance</div>
                          <div className="mt-1 text-[13px] font-medium tracking-tight">
                            {formatMoney(Number(payload[0].value ?? 0), workspace.currency)}
                          </div>
                        </div>
                      ) : null;
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#a76c43"
                    strokeWidth={2}
                    fill="url(#ledgerguard-variance-fill)"
                    activeDot={{ r: 4, fill: "#a76c43", stroke: "#fff", strokeWidth: 2 }}
                    dot={false}
                    animationDuration={350}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="mt-6 flex h-[230px] flex-col items-center justify-center rounded-lg bg-zinc-50/70 text-center sm:h-[270px]">
              <ChartLineUp size={21} className="text-zinc-300" />
              <p className="mt-3 text-[12px] font-medium text-zinc-600">No statement activity yet</p>
              <p className="mt-1 text-[11px] text-zinc-400">Import a statement to populate the timeline.</p>
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6 xl:col-span-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Exposure mix</p>
              <h2 className="mt-1.5 text-[15px] font-medium tracking-tight text-zinc-800">By discrepancy type</h2>
            </div>
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-zinc-50 text-zinc-400">
              <ChartLineUp size={15} />
            </span>
          </div>
          <div className="mt-7 space-y-6">
            {data.categoriesWithTotals.map((item) => {
              const meta = categoryMeta[item.type];
              return (
                <div key={item.type}>
                  <div className="mb-2.5 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-[11px] font-medium text-zinc-600">
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: meta.color }} />
                      {meta.label}
                      <span className="font-normal text-zinc-400">{item.count}</span>
                    </div>
                    <span className="font-mono text-[11px] text-zinc-700">
                      {formatMoney(item.amount, workspace.currency)}
                    </span>
                  </div>
                  <div className="h-[5px] overflow-hidden rounded-full bg-zinc-100">
                    <div
                      className="h-full rounded-full transition-[width] duration-300"
                      style={{
                        width: largestCategory ? `${(item.amount / largestCategory) * 100}%` : "0%",
                        backgroundColor: meta.color,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onNavigate("rules")}
            className="mt-8 flex w-full items-center justify-between border-t border-zinc-100 pt-4 text-[11px] font-medium text-zinc-600 transition-colors hover:text-zinc-900"
          >
            Review audit rules <ArrowUpRight size={14} />
          </button>
        </section>
      </div>

      <div className="grid gap-3 xl:grid-cols-12">
        <section className="min-w-0 overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] xl:col-span-8">
          <div className="flex items-start justify-between gap-3 px-5 py-5 sm:px-6">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Evidence ledger</p>
              <h2 className="mt-1.5 text-[15px] font-medium tracking-tight text-zinc-800">Recent findings</h2>
            </div>
            <button
              type="button"
              onClick={() => onNavigate("evidence")}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-zinc-500 transition-colors hover:text-zinc-900"
            >
              View all <ArrowUpRight size={13} />
            </button>
          </div>
          {data.recent.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[590px] border-collapse text-left">
                <thead>
                  <tr className="border-y border-zinc-100 bg-zinc-50/60 text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">
                    <th className="py-3 pl-5 pr-3 font-medium sm:pl-6">Transaction</th>
                    <th className="px-3 py-3 font-medium">Finding</th>
                    <th className="px-3 py-3 font-medium">Status</th>
                    <th className="py-3 pl-3 pr-5 text-right font-medium sm:pr-6">Variance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recent.map(({ finding, transaction }) => (
                    <tr key={finding.id} className="border-b border-zinc-100/80 last:border-b-0 hover:bg-zinc-50/60">
                      <td className="py-3.5 pl-5 pr-3 sm:pl-6">
                        <div className="max-w-[220px] truncate text-[11px] font-medium text-zinc-700" title={transaction?.description}>
                          {transaction?.description || "Transaction unavailable"}
                        </div>
                        <div className="mt-0.5 text-[10px] text-zinc-400">
                          {transaction?.date ? formatDate(transaction.date) : "—"}
                          {transaction?.reference ? ` · ${transaction.reference}` : ""}
                        </div>
                      </td>
                      <td className="px-3 py-3.5"><FindingLabel type={finding.type} /></td>
                      <td className="px-3 py-3.5">
                        <span className={`text-[10px] font-medium ${
                          finding.status === "confirmed"
                            ? "text-emerald-700"
                            : finding.status === "excluded"
                              ? "text-zinc-400"
                              : "text-[#9b6b47]"
                        }`}>
                          {finding.status === "needs-review"
                            ? "Needs review"
                            : finding.status === "confirmed"
                              ? "Confirmed"
                              : "Excluded"}
                        </span>
                      </td>
                      <td className="py-3.5 pl-3 pr-5 text-right font-mono text-[11px] font-medium text-zinc-800 sm:pr-6">
                        {formatMoney(finding.discrepancy, transaction?.currency || workspace.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex h-48 flex-col items-center justify-center border-t border-zinc-100 text-center">
              <WarningCircle size={21} className="text-zinc-300" />
              <p className="mt-3 text-[12px] font-medium text-zinc-600">No findings recorded</p>
              <p className="mt-1 text-[11px] text-zinc-400">They will appear here after an audit finds discrepancies.</p>
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-xl border border-zinc-200/80 bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02),0_4px_12px_rgba(0,0,0,0.025)] sm:p-6 xl:col-span-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-400">Review workflow</p>
              <h2 className="mt-1.5 text-[15px] font-medium tracking-tight text-zinc-800">Audit progress</h2>
            </div>
            <span className="font-mono text-[12px] font-medium text-zinc-600">{reviewProgress}%</span>
          </div>
          <div className="mt-7 h-1.5 overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full rounded-full bg-zinc-800 transition-[width] duration-300" style={{ width: `${reviewProgress}%` }} />
          </div>
          <div className="mt-3 flex justify-between text-[11px] text-zinc-400">
            <span>{data.reviewed} reviewed</span>
            <span>{workspace.findings.length} total</span>
          </div>
          <div className="mt-7 space-y-4 border-t border-zinc-100 pt-5">
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2 text-zinc-500"><Clock size={14} className="text-[#b98159]" /> Awaiting review</div>
              <span className="font-mono font-medium text-zinc-700">{data.needsReview}</span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2 text-zinc-500"><CheckCircle size={14} className="text-emerald-600" /> Confirmed</div>
              <span className="font-mono font-medium text-zinc-700">
                {workspace.findings.filter((finding) => finding.status === "confirmed").length}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px]">
              <div className="flex items-center gap-2 text-zinc-500"><WarningCircle size={14} className="text-zinc-400" /> Excluded</div>
              <span className="font-mono font-medium text-zinc-700">
                {workspace.findings.filter((finding) => finding.status === "excluded").length}
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => onNavigate(data.needsReview ? "evidence" : "exports")}
            className="mt-7 flex w-full items-center justify-between rounded-lg bg-zinc-50 px-3.5 py-3 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-100"
          >
            {data.needsReview ? "Continue review" : "Open export console"}
            <ArrowRight size={14} />
          </button>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 px-0.5 text-[10px] text-zinc-400">
        <span>
          {workspace.sources.length ? `Latest source: ${workspace.sources.at(-1)?.name}` : "No source files imported"}
        </span>
        <span>{workspace.updatedAt ? `Workspace updated ${shortDate(workspace.updatedAt)}` : ""}</span>
      </div>
    </div>
  );
}
