const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const Papa = require("papaparse");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/csv.ts");
const javascript = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const compiled = new Module(sourcePath, module);
compiled.filename = sourcePath;
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
compiled._compile(javascript, sourcePath);
const { buildEvidenceCsv } = compiled.exports;

const workspace = {
  transactions: [
    { id: "debit", date: "2026-01-01", account: "Account 1", reference: "A", description: "Service fee", debit: 10, credit: 0, balance: -10, currency: "USD", source: "test.csv" },
    { id: "credit", date: "2026-01-02", account: "Account 1", reference: "B", description: "=SUM(1,1)", debit: 0, credit: 200, balance: 190, currency: "USD", source: "test.csv" },
  ],
  findings: [{ id: "debit:duplicate", transactionId: "debit", type: "duplicate", actual: 10, expected: 0, discrepancy: 10, status: "confirmed", calculation: "Repeated fee" }],
};

const full = Papa.parse(buildEvidenceCsv(workspace, "all", true), { header: true }).data;
assert.equal(full.length, 2);
assert.equal(full[0]["Debit"], "10.00");
assert.equal(full[0]["Running balance"], "-10.00");
assert.equal(full[0]["Calculation / assumption"], "Repeated fee");
assert.equal(full[1]["Credit"], "200.00");
assert.equal(full[1]["Running balance"], "190.00");
assert.equal(full[1]["Description"], "'=SUM(1,1)");
assert.equal(full[1]["Review status"], "clear");

const confirmed = Papa.parse(buildEvidenceCsv(workspace, "confirmed", false), { header: true }).data;
assert.equal(confirmed.length, 1);
assert.equal(confirmed[0]["Potential discrepancy"], "10.00");
assert.equal(confirmed[0]["Review status"], "confirmed");
assert.ok(!Object.hasOwn(confirmed[0], "Calculation / assumption"));

console.log("CSV export checks passed: complete ledger, confirmed scope, and formula protection.");
