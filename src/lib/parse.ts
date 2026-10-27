import Papa from "papaparse";
import readXlsxFile, { readSheetNames } from "read-excel-file";
import type { SourceFile, Transaction } from "./types";

export type StatementFormat = SourceFile["format"];
export type MappingField =
  | "date"
  | "description"
  | "debit"
  | "credit"
  | "amount"
  | "direction"
  | "balance"
  | "reference"
  | "account"
  | "currency";

export type ColumnMapping = Record<MappingField, number | null>;

export interface ParsedStatement {
  format: StatementFormat;
  columns: string[];
  rows: string[][];
  rawRows: string[][];
  hasHeader: boolean;
  sheets: string[];
  selectedSheet: string | null;
  transactions: Transaction[];
  warnings: string[];
}

export interface MapOptions {
  sourceName: string;
  account: string;
  currency: string;
  dateOrder?: "DMY" | "MDY";
}

export interface MappingResult {
  transactions: Transaction[];
  skippedRows: number;
  excludedRows: { rowNumber: number; reason: string }[];
}

export function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function detectFormat(file: File): StatementFormat | null {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv") return "CSV";
  if (extension === "xlsx") return "XLSX";
  if (extension === "mt940" || extension === "sta") return "MT940";
  return null;
}

function validateMime(file: File, format: StatementFormat) {
  const mime = file.type.toLowerCase().split(";")[0].trim();
  if (!mime || mime === "application/octet-stream" || mime === "text/plain" || mime === "application/vnd.ms-excel") return;
  const declared: StatementFormat | "PDF" | null = /^(text|application)\/(csv|x-csv)$/.test(mime)
    ? "CSV"
    : mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      ? "XLSX"
      : mime === "application/pdf" ? "PDF" : null;
  if (declared && declared !== format) {
    throw new Error(`The file extension and content type disagree (${format} / ${declared}). Check the source file before importing.`);
  }
}

function readFile(file: File, onProgress?: (percent: number) => void): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(Math.min(95, Math.round((event.loaded / event.total) * 95)));
      }
    };
    reader.onerror = () => reject(new Error("The file could not be read. Try selecting it again."));
    reader.onabort = () => reject(new Error("File reading was interrupted."));
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.readAsArrayBuffer(file);
  });
}

function cellText(value: unknown) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value == null ? "" : String(value).trim();
}

function decodeStatementText(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe
    ? "utf-16le"
    : bytes[0] === 0xfe && bytes[1] === 0xff
      ? "utf-16be"
      : "utf-8";
  const text = new TextDecoder(encoding).decode(buffer).replace(/^\uFEFF/, "");
  if (text.includes("\0")) throw new Error("This file contains binary data and cannot be parsed as a statement.");
  return text;
}

function prepareGrid(rawRows: unknown[][], format: StatementFormat, sheets: string[] = [], selectedSheet: string | null = null): ParsedStatement {
  const rows = rawRows
    .map((row) => row.map(cellText))
    .filter((row) => row.some((cell) => cell !== ""));

  if (!rows.length) throw new Error("This statement has no data rows.");

  const first = rows[0];
  const knownHeaderWords = /\b(date|description|narrative|details|particulars|debit|credit|withdrawal|deposit|amount|balance|reference|account|currency|memo|transaction)\b/i;
  const headerHits = first.filter((cell) => knownHeaderWords.test(cell)).length;
  const hasHeader = rows.length > 1 && headerHits >= 2;
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const rawColumns = hasHeader ? first : Array.from({ length: width }, (_, index) => `Column ${index + 1}`);
  const columns = Array.from({ length: width }, (_, index) => rawColumns[index]?.trim() || `Column ${index + 1}`);
  const dataRows = hasHeader ? rows.slice(1) : rows;
  if (!dataRows.length) throw new Error("The statement contains headers but no transactions.");

  return { format, columns, rows: dataRows, rawRows: rows, hasHeader, sheets, selectedSheet, transactions: [], warnings: [] };
}

export function configureHeaderRow(parsed: ParsedStatement, hasHeader: boolean): ParsedStatement {
  if (parsed.format === "MT940") return parsed;
  if (hasHeader && parsed.rawRows.length < 2) return parsed;
  const width = parsed.rawRows.reduce((max, row) => Math.max(max, row.length), 0);
  const columns = Array.from({ length: width }, (_, index) => hasHeader
    ? parsed.rawRows[0][index]?.trim() || `Column ${index + 1}`
    : `Column ${index + 1}`);
  return { ...parsed, columns, rows: hasHeader ? parsed.rawRows.slice(1) : parsed.rawRows, hasHeader };
}

function validIsoDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date.toISOString().slice(0, 10);
}

export function parseDateValue(raw: string, dateOrder: "DMY" | "MDY" = "DMY"): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (/^\d{5}(?:\.\d+)?$/.test(value)) {
    const serial = Number(value);
    if (serial >= 20000 && serial < 100000) {
      return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000).toISOString().slice(0, 10);
    }
  }

  const iso = value.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[T\s])/);
  if (iso) return validIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = value.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const yearPart = Number(numeric[3]);
    const year = numeric[3].length === 2 ? (yearPart >= 70 ? 1900 + yearPart : 2000 + yearPart) : yearPart;
    const monthFirst = second > 12 || (first <= 12 && second <= 12 && dateOrder === "MDY");
    return validIsoDate(year, monthFirst ? first : second, monthFirst ? second : first);
  }

  if (!/[A-Za-z]/.test(value) || !/\b\d{4}\b/.test(value)) return null;
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return null;
  const date = new Date(timestamp);
  return validIsoDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

export function parseMoneyValue(raw: string): number | null {
  let value = raw.trim().replace(/[\u00a0\u202f]/g, " ");
  if (!value) return null;
  let negative = false;
  if (value.startsWith("(") && value.endsWith(")")) {
    negative = true;
    value = value.slice(1, -1).trim();
  } else if (/[()]/.test(value)) return null;

  const direction = value.match(/(?:\s|\d)(DR|DEBIT|CR|CREDIT)\s*$/i)?.[1]
    ?? value.match(/^(DR|DEBIT|CR|CREDIT)\s*/i)?.[1];
  if (direction) {
    if (/^(DR|DEBIT)/i.test(value)) value = value.slice(direction.length).trim();
    else if (/^(CR|CREDIT)/i.test(value)) value = value.slice(direction.length).trim();
    else value = value.slice(0, -direction.length).trim();
  }

  const currencyPrefix = value.match(/^(?:[A-Z]{3}\s+|[$£€¥₹]\s*)/i);
  if (currencyPrefix) value = value.slice(currencyPrefix[0].length).trim();
  const currencySuffix = value.match(/\s+(?:[A-Z]{3}|[$£€¥₹])$/i);
  if (currencySuffix) value = value.slice(0, -currencySuffix[0].length).trim();

  const signed = value.match(/^([+\-−])\s*|\s*([\-−])$/);
  if (signed) {
    if (negative) return null;
    negative = (signed[1] || signed[2]) !== "+";
    value = signed[1] ? value.slice(signed[0].length).trim() : value.slice(0, -signed[0].length).trim();
  }
  if (direction) {
    const debit = /^(DR|DEBIT)$/i.test(direction);
    if (!debit && negative) return null;
    negative = negative || debit;
  }

  if (/\s/.test(value)) {
    if (!/^\d{1,3}(?: \d{3})+(?:[.,]\d{1,2})?$/.test(value)) return null;
    value = value.replace(/ /g, "");
  }
  if (!/^\d[\d.,]*$/.test(value)) return null;

  const lastComma = value.lastIndexOf(",");
  const lastDot = value.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    const grouping = decimal === "," ? "." : ",";
    const decimalIndex = value.lastIndexOf(decimal);
    const whole = value.slice(0, decimalIndex);
    const fraction = value.slice(decimalIndex + 1);
    const groupPattern = grouping === "." ? /^\d{1,3}(?:\.\d{3})+$/ : /^\d{1,3}(?:,\d{3})+$/;
    if (!groupPattern.test(whole) || !/^\d{1,2}$/.test(fraction)) return null;
    value = `${whole.split(grouping).join("")}.${fraction}`;
  } else if (lastComma >= 0 || lastDot >= 0) {
    const separator = lastComma >= 0 ? "," : ".";
    const parts = value.split(separator);
    if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d{1,2}$/.test(parts[1])) {
      value = `${parts[0]}.${parts[1]}`;
    } else if (parts.length > 2 && /^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((part) => /^\d{3}$/.test(part))) {
      value = parts.join("");
    } else return null;
  }

  const amount = Number(value);
  return Number.isFinite(amount) ? (negative ? -amount : amount) : null;
}

function parseMt940Amount(raw: string): number | null {
  // LedgerGuard reports two decimal places; reject finer MT940 precision instead of rounding it silently.
  if (/^\d+,\d{3,}$/.test(raw)) return null;
  if (/^\d+(?:,\d{1,2})?$/.test(raw)) {
    const amount = Number(raw.replace(",", "."));
    return Number.isFinite(amount) ? amount : null;
  }
  return parseMoneyValue(raw);
}

function parseMt940(text: string, sourceName: string): ParsedStatement {
  const lines = text.replace(/\r/g, "").split("\n");
  let account = "Unspecified account";
  let currency = "XXX";
  let runningBalance: number | null = null;
  let current: { date: string; debit: number; credit: number; reference: string; description: string; account: string; currency: string } | null = null;
  let blockStart = 0;
  const transactions: Transaction[] = [];
  const warnings: string[] = [];
  let lastTag = "";

  const commit = () => {
    if (!current) return;
    if (runningBalance !== null) runningBalance += current.credit - current.debit;
    transactions.push({
      id: createId(),
      date: current.date,
      description: current.description.trim() || "Unspecified transaction",
      debit: current.debit,
      credit: current.credit,
      balance: runningBalance,
      reference: current.reference,
      account: current.account,
      source: sourceName,
      currency: current.currency,
    });
    current = null;
  };

  for (const line of lines) {
    const tag = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (!tag) {
      if (current && (lastTag === "86" || lastTag === "61") && line.trim()) current.description += ` ${line.trim()}`;
      continue;
    }
    const [, key, value] = tag;
    lastTag = key;
    if (key === "25") {
      commit();
      account = value.trim() || account;
      currency = "XXX";
      runningBalance = null;
      blockStart = transactions.length;
    } else if (key === "60F" || key === "60M") {
      commit();
      blockStart = transactions.length;
      const match = value.match(/^([DC])\d{6}([A-Z]{3})([\d,.]+)/);
      if (match) {
        currency = match[2];
        const opening = parseMt940Amount(match[3]);
        runningBalance = opening === null ? null : match[1] === "D" ? -opening : opening;
      } else {
        runningBalance = null;
        warnings.push("An MT940 opening balance could not be parsed.");
      }
    } else if (key === "61") {
      commit();
      const match = value.match(/^(\d{6})(?:\d{4})?(RC|RD|C|D)(?:[A-Z])?([\d,.]+)(.*)$/);
      if (!match) {
        warnings.push(`One MT940 transaction could not be read: ${value.slice(0, 36)}`);
        continue;
      }
      const yy = Number(match[1].slice(0, 2));
      const year = yy >= 70 ? 1900 + yy : 2000 + yy;
      const date = validIsoDate(year, Number(match[1].slice(2, 4)), Number(match[1].slice(4, 6)));
      const amount = parseMt940Amount(match[3]);
      if (!date || amount === null) {
        warnings.push(`One MT940 transaction has an invalid date or amount: ${value.slice(0, 36)}`);
        continue;
      }
      const debit = match[2] === "D" || match[2] === "RC";
      const trailing = match[4].trim();
      const references = trailing.replace(/^[A-Z][A-Z0-9]{3}/, "").split("//");
      const ownerReference = references[0]?.trim() || "";
      const reference = ownerReference && ownerReference !== "NONREF" ? ownerReference : references[1]?.trim() || "";
      current = {
        date,
        debit: debit ? Math.abs(amount) : 0,
        credit: debit ? 0 : Math.abs(amount),
        reference,
        description: ownerReference === "NONREF" ? "" : ownerReference,
        account,
        currency,
      };
    } else if (key === "86" && current) {
      current.description = `${current.description} ${value.trim()}`.trim();
    } else if (key === "62F" || key === "62M") {
      commit();
      const match = value.match(/^([DC])\d{6}([A-Z]{3})([\d,.]+)/);
      const amount = match ? parseMt940Amount(match[3]) : null;
      if (!match || amount === null) {
        warnings.push("An MT940 closing balance could not be parsed.");
        continue;
      }
      const closing = match[1] === "D" ? -amount : amount;
      if (currency !== "XXX" && currency !== match[2]) {
        warnings.push(`MT940 opening currency ${currency} differs from closing currency ${match[2]}.`);
      }
      if (currency === "XXX") currency = match[2];
      for (let index = blockStart; index < transactions.length; index++) {
        if (transactions[index].currency === "XXX") transactions[index].currency = match[2];
      }
      if (runningBalance === null) {
        let balance = closing;
        for (let index = transactions.length - 1; index >= blockStart; index--) {
          transactions[index].balance = balance;
          balance -= transactions[index].credit - transactions[index].debit;
        }
      } else if (Math.abs(runningBalance - closing) > 0.01) {
        warnings.push(`MT940 opening balance and transactions differ from the closing balance by ${Math.abs(runningBalance - closing).toFixed(2)} ${match[2]}.`);
      }
      runningBalance = closing;
      blockStart = transactions.length;
    }
  }
  commit();
  if (!transactions.length) throw new Error("No MT940 transactions were found. Check that this is a valid MT940 statement.");
  if (transactions.some((transaction) => transaction.currency === "XXX")) warnings.push("The MT940 file does not specify a currency for every transaction.");
  return { format: "MT940", columns: [], rows: [], rawRows: [], hasHeader: false, sheets: [], selectedSheet: null, transactions, warnings };
}

export async function parseStatementFile(file: File, onProgress?: (percent: number) => void, sheetName?: string): Promise<ParsedStatement> {
  if (!file.size) throw new Error("This file is empty. Select a statement with transactions.");
  const format = detectFormat(file);
  if (!format) throw new Error("Unsupported file type. Select a CSV, XLSX, or MT940 (.mt940 or .sta) file.");
  validateMime(file, format);
  const buffer = await readFile(file, onProgress);
  onProgress?.(96);

  if (format === "CSV") {
    const text = decodeStatementText(buffer);
    const result = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    if (result.errors.length) {
      const firstError = result.errors[0];
      const rowLabel = typeof firstError.row === "number" ? ` on row ${firstError.row + 1}` : "";
      throw new Error(`CSV parsing failed${rowLabel}: ${firstError.message}`);
    }
    const parsed = prepareGrid(result.data, format);
    onProgress?.(100);
    return parsed;
  }

  if (format === "XLSX") {
    const blob = new Blob([buffer], { type: file.type });
    const sheets = await readSheetNames(blob);
    if (!sheets.length) throw new Error("This workbook has no sheets.");
    const candidates = sheetName ? [sheetName] : sheets;
    for (const candidate of candidates) {
      const rows = await readXlsxFile(blob, { sheet: candidate });
      try {
        const parsed = prepareGrid(rows, format, sheets, candidate);
        onProgress?.(100);
        return parsed;
      } catch (cause) {
        if (sheetName) throw cause;
      }
    }
    throw new Error("No transaction rows were found in this workbook.");
  }

  const parsed = parseMt940(decodeStatementText(buffer), file.name);
  onProgress?.(100);
  return parsed;
}

const headerMatchers: Record<MappingField, RegExp> = {
  date: /\b(date|posted|posting|effective)\b/,
  description: /\b(description|narrative|details|particulars|memo|payee|remarks)\b/,
  debit: /\b(debit|withdrawal|money out|paid out|charge)\b/,
  credit: /\b(credit|deposit|money in|paid in)\b/,
  amount: /^(amount|transaction amount|value)$/,
  direction: /^(direction|debit credit|dr cr)$/,
  balance: /\b(balance|running balance)\b/,
  reference: /\b(reference|ref|transaction id|trace)\b/,
  account: /\b(account|acct)\b/,
  currency: /\b(currency|ccy)\b/,
};

export function suggestMapping(columns: string[]): ColumnMapping {
  const mapping = {} as ColumnMapping;
  for (const field of Object.keys(headerMatchers) as MappingField[]) {
    const index = columns.findIndex((column) => {
      const normalized = column.toLowerCase().replace(/[_/\-]/g, " ").replace(/\s+/g, " ").trim();
      if (field === "debit" && /\bcredit\b/.test(normalized)) return false;
      if (field === "credit" && /\bdebit\b/.test(normalized)) return false;
      if (field === "account" && /\bbalance\b/.test(normalized)) return false;
      return headerMatchers[field].test(normalized);
    });
    mapping[field] = index >= 0 ? index : null;
  }
  if (mapping.amount !== null && (mapping.debit !== null || mapping.credit !== null)) {
    if (mapping.debit !== null && mapping.credit !== null) mapping.amount = null;
    else {
      mapping.debit = null;
      mapping.credit = null;
    }
  }
  return mapping;
}

export function hasRequiredMapping(mapping: ColumnMapping) {
  const selected = Object.values(mapping).filter((index): index is number => index !== null);
  return mapping.date !== null && mapping.description !== null &&
    (mapping.amount !== null || mapping.debit !== null || mapping.credit !== null) &&
    (mapping.amount === null || (mapping.debit === null && mapping.credit === null)) &&
    new Set(selected).size === selected.length;
}

export function mapStatementRows(parsed: ParsedStatement, mapping: ColumnMapping, options: MapOptions): MappingResult {
  if (!hasRequiredMapping(mapping)) return {
    transactions: [],
    skippedRows: parsed.rows.length,
    excludedRows: parsed.rows.map((_, index) => ({ rowNumber: index + 1, reason: "Complete the required column mapping." })),
  };
  const transactions: Transaction[] = [];
  const excludedRows: MappingResult["excludedRows"] = [];
  const get = (row: string[], field: MappingField) => mapping[field] === null ? "" : (row[mapping[field]!] || "").trim();
  const exclude = (rowNumber: number, reason: string) => excludedRows.push({ rowNumber, reason });

  for (const [index, row] of parsed.rows.entries()) {
    const rowNumber = index + 1;
    const dateText = get(row, "date");
    const date = parseDateValue(dateText, options.dateOrder);
    const description = get(row, "description");
    const amountText = get(row, "amount");
    const signed = parseMoneyValue(amountText);
    const debitText = get(row, "debit");
    const creditText = get(row, "credit");
    const rawDebit = parseMoneyValue(debitText);
    const rawCredit = parseMoneyValue(creditText);
    const rawDirection = get(row, "direction").toLowerCase();
    if (!date) { exclude(rowNumber, dateText ? "Invalid date." : "Missing date."); continue; }
    if (!description) { exclude(rowNumber, "Missing description."); continue; }
    if (mapping.amount !== null && signed === null) { exclude(rowNumber, "Missing or invalid amount."); continue; }
    if (debitText && rawDebit === null) { exclude(rowNumber, "Invalid debit amount."); continue; }
    if (creditText && rawCredit === null) { exclude(rowNumber, "Invalid credit amount."); continue; }
    let debit = rawDebit === null ? 0 : Math.abs(rawDebit);
    let credit = rawCredit === null ? 0 : Math.abs(rawCredit);

    if (mapping.amount !== null && mapping.debit === null && mapping.credit === null && signed !== null) {
      const debitDirection = /^(d|dr|debit|withdrawal|out|money out)$/.test(rawDirection);
      const creditDirection = /^(c|cr|credit|deposit|in|money in)$/.test(rawDirection);
      if (mapping.direction !== null && !debitDirection && !creditDirection) {
        exclude(rowNumber, "Missing or unrecognized debit/credit direction.");
        continue;
      }
      if ((creditDirection && (signed < 0 || /\b(?:DR|DEBIT)\b|(?:DR|DEBIT)$/i.test(amountText))) ||
          (debitDirection && /\b(?:CR|CREDIT)\b|(?:CR|CREDIT)$/i.test(amountText))) {
        exclude(rowNumber, "Amount sign or marker conflicts with direction.");
        continue;
      }
      debit = debitDirection || (mapping.direction === null && signed < 0) ? Math.abs(signed) : 0;
      credit = creditDirection || (mapping.direction === null && signed > 0) ? Math.abs(signed) : 0;
    }

    if (debit === 0 && credit === 0) {
      exclude(rowNumber, "No nonzero debit or credit amount.");
      continue;
    }
    if (debit > 0 && credit > 0) {
      exclude(rowNumber, "Both debit and credit contain amounts.");
      continue;
    }

    const balanceText = get(row, "balance");
    const balance = parseMoneyValue(balanceText);
    if (balanceText && balance === null) {
      exclude(rowNumber, "Invalid running balance.");
      continue;
    }
    const rawCurrency = get(row, "currency").toUpperCase();
    const defaultCurrency = options.currency.trim().toUpperCase();
    if (rawCurrency && rawCurrency !== "XXX" && !/^[A-Z]{3}$/.test(rawCurrency)) {
      exclude(rowNumber, "Invalid currency code.");
      continue;
    }
    const resolvedCurrency = /^[A-Z]{3}$/.test(rawCurrency) && rawCurrency !== "XXX"
      ? rawCurrency
      : /^[A-Z]{3}$/.test(defaultCurrency) && defaultCurrency !== "XXX" ? defaultCurrency : null;
    if (!resolvedCurrency) {
      exclude(rowNumber, "No valid three-letter currency code.");
      continue;
    }
    transactions.push({
      id: createId(),
      date,
      description,
      debit,
      credit,
      balance,
      reference: get(row, "reference"),
      account: get(row, "account") || options.account.trim() || `Unspecified · ${options.sourceName}`,
      source: options.sourceName,
      currency: resolvedCurrency,
    });
  }

  return { transactions, skippedRows: excludedRows.length, excludedRows };
}
