import type { AuditSettings, Finding, ReviewStatus, Transaction } from "./types";

export const defaultSettings: AuditSettings = {
  baseRate: 9,
  marginRate: 3.5,
  dayBasis: 365,
  interestMethod: "simple",
  taxRate: 2,
  taxMinimum: 0,
  taxCap: 0,
  taxExemptKeywords: "",
  duplicateWindowDays: 0,
  discrepancyTolerance: 0.5,
};

const MS_PER_DAY = 86_400_000;
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const dayNumber = (date: string) => Math.floor(new Date(`${date}T00:00:00Z`).getTime() / MS_PER_DAY);
const normalizeDescription = (value: string) => value.toLowerCase().replace(/\d+/g, "").replace(/[^a-z]+/g, " ").trim();

function makeFinding(
  transaction: Transaction,
  type: Finding["type"],
  expected: number,
  explanation: string,
  calculation: string,
  priorStatuses: Map<string, ReviewStatus>,
  tolerance: number,
): Finding | null {
  const actual = round(transaction.debit);
  const discrepancy = round(actual - expected);
  if (!Number.isFinite(discrepancy) || discrepancy <= tolerance) return null;
  const id = `${transaction.id}:${type}`;
  return {
    id,
    transactionId: transaction.id,
    type,
    actual,
    expected: round(expected),
    discrepancy,
    status: priorStatuses.get(id) ?? "needs-review",
    explanation,
    calculation,
  };
}

function calculateInterest(balance: number, days: number, settings: AuditSettings, accrued: number) {
  if (balance >= 0 || days <= 0) return accrued;
  const principal = Math.abs(balance);
  const rate = (settings.baseRate + settings.marginRate) / 100 / settings.dayBasis;
  if (settings.interestMethod === "compound") return (principal + accrued) * Math.pow(1 + rate, days) - principal;
  return accrued + principal * rate * days;
}

export function analyzeTransactions(
  transactions: Transaction[],
  settings: AuditSettings,
  previousFindings: Finding[] = [],
): Finding[] {
  const previousStatuses = new Map(previousFindings.map((finding) => [finding.id, finding.status]));
  const byAccount = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    const key = `${transaction.account}:${transaction.currency}`;
    const group = byAccount.get(key);
    if (group) group.push(transaction);
    else byAccount.set(key, [transaction]);
  }
  const findings: Finding[] = [];
  const exemptWords = settings.taxExemptKeywords.split(",").map((word) => word.trim().toLowerCase()).filter(Boolean);

  for (const accountTransactions of byAccount.values()) {
    const ordered = accountTransactions.map((transaction, index) => ({ transaction, index }))
      .sort((a, b) => a.transaction.date.localeCompare(b.transaction.date) || a.index - b.index)
      .map(({ transaction }) => transaction);
    let interestAccrued = 0;
    let lastDate: string | null = null;
    let lastBalance: number | null = null;
    const previousFees = new Map<string, Transaction>();
    const transfersByReference = new Map<string, Transaction>();

    for (const transaction of ordered) {
      const description = transaction.description.toLowerCase();
      const days = lastDate ? Math.max(0, dayNumber(transaction.date) - dayNumber(lastDate)) : 0;
      if (lastBalance !== null && days > 0) interestAccrued = calculateInterest(lastBalance, days, settings, interestAccrued);

      if (transaction.debit > 0 && /\binterest\b/.test(description)) {
        const expected = round(interestAccrued);
        if (lastDate !== null && interestAccrued > 0) {
          const finding = makeFinding(
            transaction, "interest", expected,
            "Charged interest exceeds the modeled accrual across the available negative daily balances.",
            `${settings.interestMethod === "compound" ? "Daily compound" : "Simple daily"} interest at ${(settings.baseRate + settings.marginRate).toFixed(2)}% annualized on negative balances, ${settings.dayBasis}-day basis. This is a screening calculation; verify the bank's rate history and value dates.`,
            previousStatuses, settings.discrepancyTolerance,
          );
          if (finding) findings.push(finding);
        }
        interestAccrued = 0;
      }

      if (transaction.debit > 0 && /\b(imtt|transfer tax|transaction tax|levy)\b/.test(description)) {
        const linked = transaction.reference ? transfersByReference.get(transaction.reference) : undefined;
        const withinLinkWindow = linked && dayNumber(transaction.date) - dayNumber(linked.date) <= 1;
        if (linked && withinLinkWindow) {
          const exempt = exemptWords.some((word) => linked.description.toLowerCase().includes(word));
          let expected = exempt || linked.debit < settings.taxMinimum ? 0 : linked.debit * settings.taxRate / 100;
          if (settings.taxCap > 0) expected = Math.min(expected, settings.taxCap);
          const finding = makeFinding(
            transaction, "tax", round(expected),
            `Tax charge linked to ${linked.description} (${linked.reference}) exceeds the configured profile.`,
            `${exempt ? "Exempt keyword matched" : `${settings.taxRate}% × ${linked.debit.toFixed(2)}`} · minimum transfer ${settings.taxMinimum.toFixed(2)}${settings.taxCap > 0 ? ` · cap ${settings.taxCap.toFixed(2)}` : ""}. Rule inputs are user supplied; confirm exemptions and law before raising a claim.`,
            previousStatuses, settings.discrepancyTolerance,
          );
          if (finding) findings.push(finding);
        }
      }

      if (transaction.debit > 0 && /\b(fee|charge|commission)\b/.test(description) &&
          !/\b(imtt|tax|levy|interest|penalty)\b/.test(description)) {
        const feeKey = `${normalizeDescription(transaction.description)}:${round(transaction.debit)}`;
        const candidate = previousFees.get(feeKey);
        const match = candidate && dayNumber(transaction.date) - dayNumber(candidate.date) <= settings.duplicateWindowDays ? candidate : undefined;
        if (match) {
          const finding = makeFinding(
            transaction, "duplicate", 0,
            `A matching fee appears on ${match.date} with the same amount and description.`,
            `Matched ${match.reference || match.id} to ${transaction.reference || transaction.id} within ${settings.duplicateWindowDays} day${settings.duplicateWindowDays === 1 ? "" : "s"}. Review the bank tariff for legitimate repeated fees.`,
            previousStatuses, settings.discrepancyTolerance,
          );
          if (finding) findings.push(finding);
        }
        previousFees.set(feeKey, transaction);
      }

      if (transaction.debit > 0 && transaction.reference && !/\b(imtt|tax|levy|fee|charge|commission|interest|penalty)\b/.test(description)) {
        transfersByReference.set(transaction.reference, transaction);
      }

      if (transaction.debit > 0 && /\b(overdraft|overlimit|excess)\b.*\b(penalty|fee|charge)\b|\b(penalty|fee|charge)\b.*\b(overdraft|overlimit|excess)\b/.test(description)) {
        const beforeCharge = transaction.balance === null ? lastBalance : transaction.balance + transaction.debit - transaction.credit;
        if (beforeCharge !== null && beforeCharge > 0) {
          const finding = makeFinding(
            transaction, "penalty", 0,
            "An overdraft-related penalty was posted while the available running balance was positive before the charge.",
            `Reconstructed pre-charge balance: ${round(beforeCharge).toFixed(2)}. Cleared versus available funds and value dates may differ; verify against the account agreement.`,
            previousStatuses, settings.discrepancyTolerance,
          );
          if (finding) findings.push(finding);
        }
      }

      if (transaction.balance !== null) lastBalance = transaction.balance;
      else if (lastBalance !== null) lastBalance = round(lastBalance + transaction.credit - transaction.debit);
      lastDate = transaction.date;
    }
  }
  return findings.sort((a, b) => b.discrepancy - a.discrepancy);
}
