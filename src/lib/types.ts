export type ViewId = "dashboard" | "evidence" | "rules" | "exports";
export type FindingType = "interest" | "tax" | "duplicate" | "penalty";
export type ReviewStatus = "needs-review" | "confirmed" | "excluded";

export interface Transaction {
  id: string;
  date: string;
  description: string;
  debit: number;
  credit: number;
  balance: number | null;
  reference: string;
  account: string;
  source: string;
  currency: string;
}

export interface Finding {
  id: string;
  transactionId: string;
  type: FindingType;
  actual: number;
  expected: number;
  discrepancy: number;
  status: ReviewStatus;
  explanation: string;
  calculation: string;
}

export interface SourceFile {
  id: string;
  name: string;
  importedAt: string;
  rowCount: number;
  format: "CSV" | "XLSX" | "MT940";
}

export interface AuditSettings {
  baseRate: number;
  marginRate: number;
  dayBasis: 360 | 365;
  interestMethod: "simple" | "compound";
  taxRate: number;
  taxMinimum: number;
  taxCap: number;
  taxExemptKeywords: string;
  duplicateWindowDays: number;
  discrepancyTolerance: number;
}

export interface Workspace {
  name: string;
  isDemo: boolean;
  profileConfirmed: boolean;
  currency: string;
  transactions: Transaction[];
  findings: Finding[];
  sources: SourceFile[];
  settings: AuditSettings;
  updatedAt: string;
}
