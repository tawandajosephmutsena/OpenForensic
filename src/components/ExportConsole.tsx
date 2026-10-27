"use client";

import { useMemo, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  Check,
  ClipboardText,
  DownloadSimple,
  EnvelopeSimple,
  FileCsv,
  FilePdf,
  Info,
  SealCheck,
} from "@phosphor-icons/react";
import { formatMoney, titleCase } from "@/lib/format";
import { buildEvidenceCsv } from "@/lib/csv";
import type { Finding, Workspace } from "@/lib/types";

interface Props {
  workspace: Workspace;
  onGoEvidence: () => void;
}

function saveBlob(content: Blob, filename: string) {
  const url = URL.createObjectURL(content);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function reportName(workspace: Workspace) {
  return `open-forensic-${workspace.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "audit"}`;
}

function wrapPdf(doc: import("jspdf").jsPDF, text: string, x: number, y: number, width: number, lineHeight = 5) {
  const lines = doc.splitTextToSize(text, width) as string[];
  doc.text(lines, x, y);
  return y + lines.length * lineHeight;
}

function categoryTotals(findings: Finding[]) {
  return (["interest", "tax", "duplicate", "penalty"] as const).map((type) => ({
    type,
    value: findings.filter((finding) => finding.type === type).reduce((sum, finding) => sum + finding.discrepancy, 0),
  })).filter(({ value }) => value > 0);
}

export function ExportConsole({ workspace, onGoEvidence }: Props) {
  const [bankName, setBankName] = useState("");
  const [contactName, setContactName] = useState("");
  const [copied, setCopied] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [exportError, setExportError] = useState("");
  const [customBody, setCustomBody] = useState<string | null>(null);
  const [csvScope, setCsvScope] = useState<"confirmed" | "all">("confirmed");
  const [includeCalculation, setIncludeCalculation] = useState(true);
  const confirmed = useMemo(() => workspace.findings.filter((finding) => finding.status === "confirmed"), [workspace.findings]);
  const total = confirmed.reduce((sum, finding) => sum + finding.discrepancy, 0);
  const transactions = useMemo(() => new Map(workspace.transactions.map((transaction) => [transaction.id, transaction])), [workspace.transactions]);
  const totals = categoryTotals(confirmed);
  const subject = `Request for review · ${workspace.name} · ${confirmed.length} ledger item${confirmed.length === 1 ? "" : "s"}`;
  const recipient = contactName.trim() ? `Dear ${contactName.trim()},` : "Dear Banking Team,";
  const draft = `${bankName.trim() ? `To: ${bankName.trim()}\n\n` : ""}${recipient}\n\nWe have completed an initial review of account activity in ${workspace.name}. The attached schedule identifies ${confirmed.length} item${confirmed.length === 1 ? "" : "s"} for your review, with a combined potential discrepancy of ${formatMoney(total, workspace.currency)}.\n\nThese figures are based on the stated audit assumptions and the transaction records available to us. Please verify the underlying tariff, interest basis, value dates, exemptions and any applicable account terms, then provide your calculation and supporting records for each item.\n\nWe would appreciate a written response with the outcome of your review and any correction you consider appropriate.\n\nKind regards,\nAudit team`;
  const emailBody = customBody ?? draft;

  const downloadCsv = () => {
    const csv = buildEvidenceCsv(workspace, csvScope, includeCalculation);
    saveBlob(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" }), `${reportName(workspace)}-${csvScope === "confirmed" ? "confirmed-findings" : "full-ledger"}.csv`);
  };

  const downloadPdf = async () => {
    if (!confirmed.length) return;
    setPdfBusy(true);
    setExportError("");
    try {
      const { jsPDF } = await import("jspdf");
      const doc = new jsPDF({ unit: "mm", format: "a4" });
      const left = 20;
      const right = 190;
      let y = 20;
      const pageFooter = () => {
        doc.setDrawColor(226, 225, 222);
        doc.line(left, 278, right, 278);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(125, 124, 118);
        doc.setFontSize(8);
        doc.text("OPEN FORENSIC  /  LOCAL AUDIT DRAFT", left, 284);
        doc.text(String(doc.getNumberOfPages()), right, 284, { align: "right" });
      };
      const nextPage = () => { pageFooter(); doc.addPage(); y = 22; };
      const writePaged = (value: string, x: number, width: number, lineHeight = 4.5) => {
        const lines = doc.splitTextToSize(value, width) as string[];
        for (const line of lines) {
          if (y > 268) nextPage();
          doc.text(line, x, y);
          y += lineHeight;
        }
      };
      const scheduleRow = (finding: Finding) => {
        const transaction = transactions.get(finding.transactionId);
        const description = `${transaction?.date ?? ""}   ${transaction?.description ?? ""}   ${transaction?.reference ?? ""}`;
        const amounts = `Charged ${formatMoney(finding.actual, workspace.currency)}   /   Expected ${formatMoney(finding.expected, workspace.currency)}`;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8);
        const lineCount = [description, amounts, finding.calculation]
          .reduce((count, value) => count + (doc.splitTextToSize(value, 160) as string[]).length, 0);
        return { description, amounts, height: 25 + lineCount * 4.5 };
      };
      doc.setFillColor(8, 126, 120);
      doc.roundedRect(left, y, 9, 9, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.text("O", 24.5, y + 6, { align: "center" });
      doc.setTextColor(39, 39, 36);
      doc.setFontSize(12);
      doc.text("Open Forensic", 33, y + 6.5);
      y += 25;
      doc.setTextColor(230, 106, 48);
      doc.setFontSize(9);
      doc.text("FINANCIAL FORENSICS / REVIEW DRAFT", left, y);
      y += 15;
      doc.setTextColor(28, 28, 27);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(26);
      y = wrapPdf(doc, "Discrepancy review", left, y, 160, 11) + 5;
      doc.setFontSize(11);
      doc.setTextColor(112, 112, 108);
      y = wrapPdf(doc, workspace.name, left, y, 155, 6) + 15;
      doc.setDrawColor(223, 222, 218);
      doc.line(left, y, right, y);
      y += 13;
      doc.setFontSize(9);
      doc.text("CONFIRMED FOR REVIEW", left, y);
      doc.text("POTENTIAL DISCREPANCY", 105, y);
      y += 11;
      doc.setTextColor(28, 28, 27);
      doc.setFontSize(18);
      doc.text(String(confirmed.length).padStart(2, "0"), left, y);
      doc.text(formatMoney(total, workspace.currency), 105, y);
      y += 15;
      doc.setFontSize(9);
      doc.setTextColor(110, 110, 105);
      doc.text(`Generated ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}`, left, y);
      y += 17;
      doc.setTextColor(35, 35, 33);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Executive summary", left, y);
      y += 9;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(88, 88, 84);
      y = wrapPdf(doc, `This draft summarizes ${confirmed.length} reviewed ledger finding${confirmed.length === 1 ? "" : "s"}. Amounts are potential discrepancies under the configured rules, not verified claims. Reconcile each item with the bank's tariff, value dates, account agreement and applicable tax rules before sending.`, left, y, 170, 5) + 13;
      for (const category of totals) {
        doc.setTextColor(92, 92, 87);
        doc.text(titleCase(category.type), left, y);
        doc.setTextColor(35, 35, 33);
        doc.text(formatMoney(category.value, workspace.currency), right, y, { align: "right" });
        y += 9;
      }
      y += 12;
      if (confirmed.length && y + 11 + 10 + scheduleRow(confirmed[0]).height > 270) nextPage();
      doc.setDrawColor(223, 222, 218);
      doc.line(left, y, right, y);
      y += 11;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("Schedule of findings", left, y);
      y += 10;
      for (let index = 0; index < confirmed.length; index++) {
        const finding = confirmed[index];
        const row = scheduleRow(finding);
        if (y + row.height > 270) nextPage();
        doc.setFontSize(8);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(137, 101, 70);
        doc.text(`${String(index + 1).padStart(2, "0")}  ${titleCase(finding.type)}`, left, y);
        doc.setTextColor(33, 33, 31);
        doc.text(formatMoney(finding.discrepancy, workspace.currency), right, y, { align: "right" });
        y += 7;
        doc.setFont("helvetica", "normal");
        doc.setTextColor(60, 60, 56);
        writePaged(row.description, left + 5, 160);
        y += 1;
        writePaged(row.amounts, left + 5, 160);
        y += 1;
        writePaged(finding.calculation, left + 5, 160);
        y += 8;
        if (y > 272) nextPage();
        doc.setDrawColor(235, 234, 231);
        doc.line(left, y, right, y);
        y += 8;
      }
      const profileText = `Interest: ${(workspace.settings.baseRate + workspace.settings.marginRate).toFixed(2)}% annualized; ${workspace.settings.interestMethod}; ${workspace.settings.dayBasis}-day basis. Tax: ${workspace.settings.taxRate}% with ${formatMoney(workspace.settings.taxMinimum, workspace.currency)} minimum transfer${workspace.settings.taxCap > 0 ? ` and ${formatMoney(workspace.settings.taxCap, workspace.currency)} cap` : " and no cap"}. Duplicate window: ${workspace.settings.duplicateWindowDays} day(s).`;
      const disclaimerText = "Prepared locally in the browser. This is a screening report for review; it is not a legal opinion or determination of liability.";
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);
      const profileHeight = 15 + ((doc.splitTextToSize(profileText, 170) as string[]).length + (doc.splitTextToSize(disclaimerText, 170) as string[]).length) * 4.5;
      if (y + profileHeight > 270) nextPage();
      doc.setFont("helvetica", "bold");
      doc.setTextColor(35, 35, 33);
      doc.setFontSize(10);
      doc.text("Audit profile used", left, y);
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setTextColor(88, 88, 84);
      doc.setFontSize(8);
      y = wrapPdf(doc, profileText, left, y, 170, 4.5) + 8;
      wrapPdf(doc, disclaimerText, left, y, 170, 4.5);
      pageFooter();
      doc.save(`${reportName(workspace)}-review-draft.pdf`);
    } catch {
      setExportError("The PDF could not be prepared. Please try again or export the CSV schedule.");
    } finally {
      setPdfBusy(false);
    }
  };

  const copyEmail = async () => {
    try {
      await navigator.clipboard.writeText(`Subject: ${subject}\n\n${emailBody}`);
      setCopied(true);
      setExportError("");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setExportError("Clipboard access is unavailable. Select the draft text and copy it manually.");
    }
  };

  const buttonBase = "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="space-y-6 pb-12">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.16em] text-brand-orange">Output / 04</p>
          <h1 className="text-[29px] font-medium tracking-[-0.045em] text-zinc-900 sm:text-[34px]">Export &amp; communication</h1>
          <p className="mt-2 max-w-xl text-[13px] leading-6 text-zinc-500">Turn reviewed evidence into a clear schedule and a measured request for the bank to verify its calculations.</p>
        </div>
        <button type="button" onClick={onGoEvidence} className={`${buttonBase} border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`}>
          Review findings <ArrowRight size={15} />
        </button>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.42fr)_minmax(300px,.9fr)]">
        <div className="overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-panel">
          <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4">
            <div className="flex items-center gap-2.5 text-[13px] font-medium text-zinc-800"><FilePdf size={17} className="text-brand-orange" /> Executive report preview</div>
            <span className="rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 font-mono text-[10px] text-zinc-500">PDF · A4</span>
          </div>
          <div className="bg-[#EAF6F1] px-5 py-7 sm:px-9 sm:py-9">
            <div className="mx-auto min-h-[520px] max-w-[520px] bg-white px-8 py-9 shadow-[0_10px_35px_rgba(34,32,28,.1)] sm:px-11 sm:py-11">
              <div className="flex items-center gap-2 border-b border-zinc-200 pb-5">
                <img src="/logo-mark.svg" alt="" width="28" height="28" className="h-7 w-7 rounded-md" />
                <span className="text-[14px] font-semibold tracking-[-0.04em] text-[#153A3B]">Open Forensic</span>
                <span className="ml-auto font-mono text-[9px] tracking-[0.1em] text-zinc-400">REVIEW DRAFT</span>
              </div>
              <p className="mt-9 text-[10px] font-medium uppercase tracking-[0.16em] text-brand-orange">Financial forensics / audit schedule</p>
              <h2 className="mt-3 text-[30px] font-medium leading-tight tracking-[-0.05em] text-zinc-900">Discrepancy<br />review</h2>
              <p className="mt-2 text-[12px] text-zinc-500">{workspace.name}</p>
              <div className="mt-10 grid grid-cols-2 gap-3 border-y border-zinc-200 py-5">
                <div><p className="text-[9px] uppercase tracking-[0.12em] text-zinc-400">Confirmed items</p><p className="mt-2 font-mono text-[23px] tracking-tight text-zinc-900">{String(confirmed.length).padStart(2, "0")}</p></div>
                <div><p className="text-[9px] uppercase tracking-[0.12em] text-zinc-400">Potential discrepancy</p><p className="mt-2 font-mono text-[23px] tracking-tight text-zinc-900">{formatMoney(total, workspace.currency)}</p></div>
              </div>
              <div className="mt-7 flex items-center justify-between"><span className="text-[11px] font-medium text-zinc-800">Finding summary</span><span className="text-[9px] uppercase tracking-wider text-zinc-400">By category</span></div>
              <div className="mt-3 space-y-0 border-t border-zinc-100">
                {totals.length ? totals.map(({ type, value }) => <div key={type} className="flex items-center justify-between border-b border-zinc-100 py-2.5 text-[11px]"><span className="text-zinc-500">{titleCase(type)}</span><span className="font-mono text-zinc-800">{formatMoney(value, workspace.currency)}</span></div>) : <p className="py-6 text-center text-[11px] text-zinc-400">Confirm findings to populate this report.</p>}
              </div>
              <div className="mt-9 border-l-2 border-[#E66A30] pl-3 text-[10px] leading-5 text-zinc-500">Screening results based on configured rules. Verify agreements, value dates and applicable tax treatment before external use.</div>
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-xl border border-zinc-200/80 bg-white p-6 shadow-panel">
            <div className="mb-5 flex items-center gap-2.5"><SealCheck size={17} className="text-emerald-700" /><h3 className="text-[14px] font-medium tracking-tight text-zinc-900">Ready to package</h3></div>
            <div className="flex items-center justify-between border-b border-zinc-100 pb-4 text-[12px]"><span className="text-zinc-500">Reviewed &amp; confirmed</span><span className="font-mono text-zinc-900">{confirmed.length} / {workspace.findings.length}</span></div>
            <div className="flex items-center justify-between py-4 text-[12px]"><span className="text-zinc-500">Included discrepancy</span><span className="font-mono text-zinc-900">{formatMoney(total, workspace.currency)}</span></div>
            <div className="border-t border-zinc-100 pt-4">
              <label htmlFor="csv-scope" className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-400">CSV schedule</label>
              <select id="csv-scope" value={csvScope} onChange={(event) => setCsvScope(event.target.value as "confirmed" | "all")} className="mt-2 h-9 w-full rounded-lg border border-zinc-200 bg-white px-3 text-[11px] font-medium text-zinc-700 outline-none focus:border-zinc-400"><option value="confirmed">Confirmed findings only</option><option value="all">Full transaction ledger</option></select>
              <label className="mt-3 flex cursor-pointer items-center gap-2 text-[11px] text-zinc-500"><input type="checkbox" checked={includeCalculation} onChange={(event) => setIncludeCalculation(event.target.checked)} className="h-3.5 w-3.5 accent-zinc-900" />Include calculation notes</label>
            </div>
            <div className="space-y-2 border-t border-zinc-100 pt-5">
              <button type="button" onClick={downloadPdf} disabled={!confirmed.length || pdfBusy} className={`${buttonBase} w-full bg-brand-teal text-white hover:bg-[#076D68]`}><FilePdf size={16} />{pdfBusy ? "Preparing PDF…" : "Download review PDF"}<ArrowDown size={14} className="ml-auto" /></button>
              <button type="button" onClick={downloadCsv} disabled={csvScope === "confirmed" ? !confirmed.length : !workspace.transactions.length} className={`${buttonBase} w-full border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`}><FileCsv size={16} />Export evidence CSV<DownloadSimple size={15} className="ml-auto" /></button>
            </div>
            <p className="mt-4 flex items-start gap-2 text-[11px] leading-5 text-zinc-400"><Info size={14} className="mt-0.5 shrink-0" />The PDF uses confirmed items. CSV follows the selected scope. Files are generated in this browser.</p>
            {exportError && <p role="alert" className="mt-3 text-[11px] leading-5 text-amber-800">{exportError}</p>}
          </div>
          <div className="rounded-xl border border-zinc-200/80 bg-[#F7FCFA] p-6 shadow-panel">
            <div className="flex items-center gap-2.5"><EnvelopeSimple size={17} className="text-brand-orange" /><h3 className="text-[14px] font-medium text-zinc-900">Bank communication</h3></div>
            <p className="mt-2 text-[12px] leading-5 text-zinc-500">A measured request for verification, ready to refine in your email client.</p>
            <div className="mt-5 grid grid-cols-2 gap-3">
              <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Bank name<input value={bankName} onChange={(event) => setBankName(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-zinc-800 outline-none focus:border-zinc-400" /></label>
              <label className="text-[10px] font-medium uppercase tracking-wider text-zinc-400">Contact<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Optional" className="mt-2 w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-[12px] font-normal normal-case tracking-normal text-zinc-800 outline-none focus:border-zinc-400" /></label>
            </div>
            <div className="mt-4 rounded-lg border border-zinc-200 bg-white p-4">
              <p className="mb-3 border-b border-zinc-100 pb-3 text-[11px] text-zinc-600"><span className="text-zinc-400">Subject&nbsp; </span>{subject}</p>
              <textarea aria-label="Edit bank communication draft" value={emailBody} onChange={(event) => setCustomBody(event.target.value)} className="h-48 w-full resize-y bg-transparent text-[11px] leading-[1.7] text-zinc-600 outline-none" />
            </div>
            {customBody !== null && <button type="button" onClick={() => setCustomBody(null)} className="mt-2 text-[10px] font-medium text-zinc-500 underline decoration-zinc-300 underline-offset-2 hover:text-zinc-800">Reset generated text</button>}
            <div className="mt-4 flex gap-2">
              <button type="button" onClick={copyEmail} disabled={!confirmed.length} className={`${buttonBase} flex-1 border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50`}>{copied ? <Check size={15} /> : <ClipboardText size={15} />}{copied ? "Copied" : "Copy draft"}</button>
              <a aria-disabled={!confirmed.length} tabIndex={confirmed.length ? 0 : -1} href={confirmed.length ? `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(emailBody)}` : undefined} className={`${buttonBase} flex-1 bg-brand-teal text-white hover:bg-[#076D68] ${confirmed.length ? "" : "pointer-events-none opacity-40"}`}><EnvelopeSimple size={15} />Open email</a>
            </div>
            <p className="mt-3 text-[10px] leading-4 text-zinc-400">Attach the exported report yourself. No message is sent by Open Forensic.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
