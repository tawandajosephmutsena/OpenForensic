import { analyzeTransactions } from "./audit";
import { makeDemoWorkspace } from "./demo";
import { loadWorkspace, saveWorkspace } from "./storage";
import type { SourceFile, Transaction, Workspace } from "./types";

function transactionKey(transaction: Transaction) {
  return [
    transaction.account,
    transaction.currency,
    transaction.date,
    transaction.reference,
    transaction.description.trim().toLowerCase(),
    transaction.debit.toFixed(2),
    transaction.credit.toFixed(2),
    transaction.balance?.toFixed(2) ?? "",
  ].join("|");
}

export function mergeStatement(workspace: Workspace, transactions: Transaction[], source: SourceFile): Workspace {
  if (!transactions.length) throw new Error("No valid transactions were found in this statement.");
  const currencies = new Set(transactions.map((row) => row.currency));
  if (currencies.size !== 1) throw new Error("This statement contains multiple currencies. Split it by currency before importing.");
  const currency = transactions[0].currency;
  if (!workspace.isDemo && workspace.transactions.length && workspace.currency !== currency) {
    throw new Error(`This workspace uses ${workspace.currency}. Start a new workspace before importing ${currency} transactions.`);
  }
  if (!workspace.isDemo && workspace.sources.some((existing) => existing.name.toLowerCase() === source.name.toLowerCase())) {
    throw new Error("A source with this filename is already in the workspace.");
  }
  if (!workspace.isDemo && workspace.transactions.length) {
    const existing = new Set(workspace.transactions.map(transactionKey));
    const overlap = transactions.filter((row) => existing.has(transactionKey(row))).length;
    if (overlap) throw new Error(`${overlap} transaction${overlap === 1 ? "" : "s"} already appear in this workspace. Remove overlap before importing.`);
  }
  const merged = [...(workspace.isDemo ? [] : workspace.transactions), ...transactions];
  const profileConfirmed = !workspace.isDemo && workspace.profileConfirmed;
  return {
    ...workspace,
    name: workspace.isDemo ? `${source.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ")} audit` : workspace.name,
    isDemo: false,
    profileConfirmed,
    currency,
    transactions: merged,
    findings: profileConfirmed ? analyzeTransactions(merged, workspace.settings, workspace.findings) : [],
    sources: [...(workspace.isDemo ? [] : workspace.sources), source],
    updatedAt: new Date().toISOString(),
  };
}

export async function importStatement(transactions: Transaction[], source: SourceFile) {
  const current = await loadWorkspace() ?? makeDemoWorkspace();
  const next = mergeStatement(current, transactions, source);
  await saveWorkspace(next);
  return next;
}
