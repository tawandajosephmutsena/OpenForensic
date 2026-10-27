import { formatMoney, titleCase } from "./format";
import { hasRequiredMapping, type ColumnMapping, type MappingField } from "./parse";
import type { Finding, Workspace } from "./types";

export type AgentTask = "map" | "interpret" | "draft";

export interface AgentStatus {
  connected: boolean;
  provider?: "chatgpt" | "api-key" | null;
  accountLabel?: string;
  model?: string;
  error?: string;
}

export interface AgentBridge {
  connect(apiKey: string): Promise<{ connected: boolean; error?: string }>;
  disconnect(): Promise<void>;
  signInChatGPT(): Promise<AgentStatus>;
  signOutChatGPT(): Promise<void>;
  status(): Promise<AgentStatus>;
  ask(request: { task: AgentTask; input: string }): Promise<string>;
}

declare global {
  interface Window {
    openForensicAgent?: AgentBridge;
  }
}

const mappingFields: MappingField[] = ["date", "description", "amount", "direction", "debit", "credit", "balance", "reference", "account", "currency"];

export function parseAgentMapping(raw: string, columnCount: number): ColumnMapping {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("The agent did not return a usable column map. Map the fields manually.");
  let value: Record<string, unknown>;
  try {
    value = JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    throw new Error("The agent returned invalid mapping data. Map the fields manually.");
  }
  const mapping = {} as ColumnMapping;
  for (const field of mappingFields) {
    const index = value[field];
    mapping[field] = Number.isInteger(index) && typeof index === "number" && index >= 0 && index < columnCount ? index : null;
  }
  if (!hasRequiredMapping(mapping)) throw new Error("The suggested map is incomplete or assigns one column twice. Check it manually.");
  return mapping;
}

export function confirmedFindings(workspace: Workspace) {
  return workspace.findings.filter((finding) => finding.status === "confirmed");
}

function findingRecord(workspace: Workspace, finding: Finding) {
  const transaction = workspace.transactions.find((row) => row.id === finding.transactionId);
  return {
    id: finding.id,
    type: finding.type,
    date: transaction?.date ?? "Unknown",
    description: (transaction?.description ?? "Unknown transaction").slice(0, 180),
    reference: (transaction?.reference ?? "").slice(0, 80),
    charged: finding.actual,
    expected: finding.expected,
    potentialDifference: finding.discrepancy,
    status: finding.status,
    explanation: finding.explanation.slice(0, 350),
    calculation: finding.calculation.slice(0, 450),
  };
}

export function interpretationInput(workspace: Workspace) {
  const findings = workspace.findings.filter((finding) => finding.status !== "excluded");
  return JSON.stringify({
    currency: workspace.currency,
    profileConfirmed: workspace.profileConfirmed,
    auditProfile: workspace.settings,
    totalFindings: findings.length,
    includedFindings: findings.slice(0, 25).map((finding) => findingRecord(workspace, finding)),
    omittedFindings: Math.max(0, findings.length - 25),
    instruction: "Explain what the screening found in plain language. Reference each discussed finding by its id. Separate confirmed and needs-review items. Do not assert overcharging or legal liability. State what evidence still needs verification.",
  });
}

export interface LetterDetails {
  bank: string;
  contact: string;
  sender: string;
}

export function buildReviewLetter(workspace: Workspace, details: LetterDetails) {
  const findings = confirmedFindings(workspace);
  const total = findings.reduce((sum, finding) => sum + finding.discrepancy, 0);
  const date = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(new Date());
  const recipient = details.contact.trim() ? `Dear ${details.contact.trim()},` : "Dear Banking Team,";
  const bankLine = details.bank.trim() ? `${details.bank.trim()}\n` : "";
  const items = findings.map((finding, index) => {
    const transaction = workspace.transactions.find((row) => row.id === finding.transactionId);
    return `${index + 1}. ${transaction?.date ?? "Date unknown"} — ${transaction?.description ?? titleCase(finding.type)}${transaction?.reference ? ` (ref. ${transaction.reference})` : ""}: ${formatMoney(finding.discrepancy, workspace.currency)} potential difference. ${finding.calculation}`;
  });
  return `${date}\n${bankLine}\n${recipient}\n\nSubject: Request for review of ${workspace.name}\n\nI am requesting a review of ${findings.length} transaction${findings.length === 1 ? "" : "s"} identified during a preliminary screening of the available statements. The combined potential difference under the configured assumptions is ${formatMoney(total, workspace.currency)}. These amounts are not verified claims.\n\n${items.join("\n\n")}\n\nPlease check the applicable tariff, account agreement, interest rate history, value dates, exemptions, and calculation records for each item. I would appreciate a written explanation of your findings and any correction you consider appropriate.\n\nKind regards,\n${details.sender.trim() || "[Your name]"}`;
}

export function draftInput(workspace: Workspace, details: LetterDetails) {
  return JSON.stringify({
    recipient: details,
    currency: workspace.currency,
    confirmedFindings: confirmedFindings(workspace).slice(0, 25).map((finding) => findingRecord(workspace, finding)),
    omittedFindings: Math.max(0, confirmedFindings(workspace).length - 25),
    instruction: "Write a concise formal request for review addressed to the recipient. Use only confirmed items. Preserve the exact figures and dates. Do not invent account numbers, conclusions, or legal citations. Keep placeholders where recipient details are missing. Include the sender name and ask for a written explanation.",
  });
}
