const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");

require.extensions[".ts"] = (module, filename) => {
  const javascript = ts.transpileModule(fs.readFileSync(filename, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  module._compile(javascript, filename);
};

const { parseAgentMapping, buildReviewLetter } = require("../src/lib/agent.ts");
const { mergeStatement } = require("../src/lib/import-workspace.ts");
const { defaultSettings } = require("../src/lib/audit.ts");

const mapping = parseAgentMapping('{"date":0,"description":1,"amount":2,"balance":3}', 4);
assert.equal(mapping.amount, 2);
assert.equal(mapping.debit, null);
assert.throws(() => parseAgentMapping('{"date":0,"description":1,"amount":7}', 4), /incomplete/);
assert.throws(() => parseAgentMapping('{"date":0,"description":0,"amount":2}', 4), /incomplete/);

const first = { id: "tx-1", date: "2026-01-02", description: "Service charge", debit: 20, credit: 0, balance: -20, reference: "A", account: "Account", source: "one.csv", currency: "USD" };
const second = { ...first, id: "tx-2", date: "2026-01-03", description: "Other charge", reference: "B", source: "two.csv" };
const confirmed = { id: "tx-1:duplicate", transactionId: "tx-1", type: "duplicate", actual: 20, expected: 0, discrepancy: 20, status: "confirmed", explanation: "Repeated fee", calculation: "Same fee twice" };
const excluded = { ...confirmed, id: "tx-2:duplicate", transactionId: "tx-2", status: "excluded" };
const workspace = { id: "case-1", name: "Case", isDemo: false, profileConfirmed: true, currency: "USD", transactions: [first, second], findings: [confirmed, excluded], sources: [{ id: "s1", name: "one.csv", format: "CSV", importedAt: "2026-01-02", rowCount: 2 }], settings: defaultSettings, updatedAt: "2026-01-02" };

const letter = buildReviewLetter(workspace, { bank: "Example Bank", contact: "Alex", sender: "Pat" });
assert.match(letter, /Example Bank/);
assert.match(letter, /Same fee twice/);
assert.match(letter, /Pat/);
assert.doesNotMatch(letter, /Other charge/);
assert.match(letter, /not verified claims/);

const source = { id: "s2", name: "two.csv", format: "CSV", importedAt: "2026-01-03", rowCount: 1 };
const merged = mergeStatement(workspace, [{ ...second, id: "tx-3", date: "2026-01-04" }], source);
assert.equal(merged.transactions.length, 3);
assert.equal(merged.sources.length, 2);
assert.equal(merged.id, workspace.id);
assert.equal(merged.isDemo, false);
assert.throws(() => mergeStatement(workspace, [first], source), /already appear/);
assert.throws(() => mergeStatement(workspace, [{ ...first, currency: "EUR" }], source), /uses USD/);

console.log("Agent checks passed: model mapping validation, confirmed-only letter, and import safeguards.");
