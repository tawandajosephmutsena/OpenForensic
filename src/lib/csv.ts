import type { Finding, Workspace } from "./types";

export type CsvScope = "confirmed" | "all";

function safeCsv(value: unknown) {
  const text = String(value ?? "");
  const numeric = /^-?\d+(?:\.\d+)?$/.test(text.trim());
  const protectedText = !numeric && /^[\s]*[=+@-]/.test(text) ? `'${text}` : text;
  return `"${protectedText.replaceAll('"', '""')}"`;
}

export function buildEvidenceCsv(workspace: Workspace, scope: CsvScope, includeCalculation: boolean) {
  const header = [
    "Date", "Account", "Reference", "Description", "Debit", "Credit", "Running balance",
    "Category", "Charged", "Expected", "Potential discrepancy", "Currency", "Review status", "Source file",
    ...(includeCalculation ? ["Calculation / assumption"] : []),
  ];
  const findings = scope === "confirmed"
    ? workspace.findings.filter((finding) => finding.status === "confirmed")
    : workspace.findings;
  const byTransaction = new Map<string, Finding[]>();
  for (const finding of findings) {
    byTransaction.set(finding.transactionId, [...(byTransaction.get(finding.transactionId) ?? []), finding]);
  }
  const selectedTransactions = scope === "confirmed"
    ? workspace.transactions.filter((transaction) => byTransaction.has(transaction.id))
    : workspace.transactions;
  const rows = selectedTransactions.flatMap((transaction) => {
    const matches = byTransaction.get(transaction.id) ?? [];
    return (matches.length ? matches : [null]).map((finding) => [
      transaction.date, transaction.account, transaction.reference, transaction.description,
      transaction.debit.toFixed(2), transaction.credit.toFixed(2), transaction.balance?.toFixed(2) ?? "",
      finding ? finding.type.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "None",
      (finding?.actual ?? transaction.debit).toFixed(2),
      finding?.expected.toFixed(2) ?? "",
      finding?.discrepancy.toFixed(2) ?? "",
      transaction.currency, finding?.status ?? "clear", transaction.source,
      ...(includeCalculation ? [finding?.calculation ?? ""] : []),
    ]);
  });
  return [header, ...rows].map((row) => row.map(safeCsv).join(",")).join("\r\n");
}
