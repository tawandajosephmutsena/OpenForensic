const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/audit.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const javascript = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = new Module(sourcePath, module);
compiled.filename = sourcePath;
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
compiled._compile(javascript, sourcePath);
const { analyzeTransactions, defaultSettings } = compiled.exports;

const transactions = [
  ["2026-01-01", "Opening position", 0, 0, -1000, "OPEN"],
  ["2026-01-02", "Account service fee", 10, 0, -1010, "A"],
  ["2026-01-02", "Account service fee", 10, 0, -1020, "B"],
  ["2026-01-03", "Electronic transfer", 100, 0, -1120, "T"],
  ["2026-01-03", "IMTT transfer tax", 4, 0, -1124, "T"],
  ["2026-01-04", "Deposit", 0, 2000, 876, "D"],
  ["2026-01-04", "Overdraft penalty fee", 20, 0, 856, "P"],
  ["2026-01-05", "Payment", 2000, 0, -1144, "PAY"],
  ["2026-01-31", "Debit interest charge", 100, 0, -1244, "INT"],
].map(([date, description, debit, credit, balance, reference], index) => ({
  id: `t${index}`, date, description, debit, credit, balance, reference,
  account: "Test account", source: "fixture.csv", currency: "USD",
}));

const findings = analyzeTransactions(transactions, defaultSettings);
assert.deepEqual(new Set(findings.map((finding) => finding.type)), new Set(["interest", "tax", "duplicate", "penalty"]));
assert.equal(findings.find((finding) => finding.type === "tax").discrepancy, 2);
assert.equal(findings.find((finding) => finding.type === "duplicate").discrepancy, 10);
assert.equal(findings.find((finding) => finding.type === "penalty").discrepancy, 20);

const reviewed = findings.map((finding) => finding.type === "tax" ? { ...finding, status: "confirmed" } : finding);
assert.equal(analyzeTransactions(transactions, defaultSettings, reviewed).find((finding) => finding.type === "tax").status, "confirmed");

const compoundSettings = { ...defaultSettings, interestMethod: "compound" };
const uninterrupted = analyzeTransactions(transactions, compoundSettings).find((finding) => finding.type === "interest").expected;
const checkpoint = { ...transactions[7], id: "checkpoint", date: "2026-01-20", description: "Balance checkpoint", debit: 0, credit: 0 };
const split = analyzeTransactions([...transactions.slice(0, 8), checkpoint, transactions[8]], compoundSettings).find((finding) => finding.type === "interest").expected;
assert.equal(split, uninterrupted);

console.log("Audit rules passed: four finding types, review status retention, compound-interest consistency.");
