import { analyzeTransactions, defaultSettings } from "./audit";
import type { Transaction, Workspace } from "./types";

const months = ["04", "05", "06", "07", "08", "09"];
const taxCharges = [420, 470, 395, 535, 450, 510];
const serviceFees = [650, 750, 700, 820, 730, 900];
const penalties = [950, 1_150, 1_000, 1_325, 1_175, 1_450];
const interestCharges = [1_400, 1_600, 1_550, 1_800, 1_690, 2_200];

export function makeDemoWorkspace(): Workspace {
  const transactions: Transaction[] = [];
  let balance = 15_000;
  let sequence = 0;
  const add = (date: string, description: string, debit: number, credit: number, reference: string) => {
    balance = Math.round((balance + credit - debit) * 100) / 100;
    sequence += 1;
    transactions.push({
      id: `demo-${sequence}`,
      date,
      description,
      debit,
      credit,
      balance,
      reference,
      account: "Operations · 2048",
      source: "synthetic-operations.csv",
      currency: "USD",
    });
  };

  months.forEach((month, index) => {
    const prefix = `2026-${month}`;
    const m = String(index + 4).padStart(2, "0");
    add(`${prefix}-02`, "Client settlement received", 0, 120_000 - balance, `SET-${m}`);
    add(`${prefix}-05`, "Supplier payments batch", 190_000, 0, `BATCH-${m}`);
    add(`${prefix}-08`, "Electronic transfer · regional vendor", 18_000, 0, `TRF-${m}`);
    add(`${prefix}-08`, "IMTT transfer tax", taxCharges[index], 0, `TRF-${m}`);
    add(`${prefix}-11`, "Account service fee", serviceFees[index], 0, `FEE-${m}-A`);
    add(`${prefix}-11`, "Account service fee", serviceFees[index], 0, `FEE-${m}-B`);
    add(`${prefix}-15`, "Client invoice receipts", 0, 160_000, `REC-${m}`);
    add(`${prefix}-16`, "Overdraft penalty fee", penalties[index], 0, `PEN-${m}`);
    add(`${prefix}-18`, "Payroll and contractor payments", 135_000, 0, `PAY-${m}`);
    add(`${prefix}-25`, "Debit interest charge", interestCharges[index], 0, `INT-${m}`);
    add(`${prefix}-27`, "Sales settlement", 0, 50_000, `SALE-${m}`);
  });

  const findings = analyzeTransactions(transactions, defaultSettings);
  const confirmedIds = new Set(["demo-4:tax", "demo-6:duplicate", "demo-8:penalty", "demo-15:tax", "demo-17:duplicate"]);
  for (const finding of findings) if (confirmedIds.has(finding.id)) finding.status = "confirmed";

  return {
    name: "Operations audit",
    isDemo: true,
    profileConfirmed: true,
    currency: "USD",
    transactions,
    findings,
    sources: [{ id: "synthetic-source", name: "synthetic-operations.csv", importedAt: "2026-10-27T08:00:00.000Z", rowCount: transactions.length, format: "CSV" }],
    settings: { ...defaultSettings },
    updatedAt: "2026-10-27T08:00:00.000Z",
  };
}

export function makeEmptyWorkspace(): Workspace {
  return {
    name: "New audit workspace",
    isDemo: false,
    profileConfirmed: false,
    currency: "USD",
    transactions: [],
    findings: [],
    sources: [],
    settings: { ...defaultSettings },
    updatedAt: new Date().toISOString(),
  };
}
