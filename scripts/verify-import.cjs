const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");
const ts = require("typescript");

const sourcePath = path.join(__dirname, "../src/lib/parse.ts");
const javascript = ts.transpileModule(fs.readFileSync(sourcePath, "utf8"), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const compiled = new Module(sourcePath, module);
compiled.filename = sourcePath;
compiled.paths = Module._nodeModulePaths(path.dirname(sourcePath));
compiled._compile(javascript, sourcePath);
const { parseMoneyValue, parseStatementFile, suggestMapping, mapStatementRows, hasRequiredMapping } = compiled.exports;

for (const [input, expected] of [
  ["1,234.56", 1234.56],
  ["1.234,56", 1234.56],
  ["1,234,567", 1234567],
  ["1.234.567", 1234567],
  ["1 234,56", 1234.56],
  ["USD 1,234.56", 1234.56],
  ["$1,234.56", 1234.56],
  ["(100.00)", -100],
  ["100.00 DR", -100],
  ["100.00 CR", 100],
  ["1O0.00", null],
  ["12,34.56", null],
  ["1,234", null],
  ["1.234", null],
  ["1-2", null],
  ["100.00 CR DR", null],
]) {
  assert.equal(parseMoneyValue(input), expected, `Money parsing: ${input}`);
}

const columns = ["Date", "Description", "Amount", "Direction", "Balance"];
const parsed = {
  format: "CSV", columns, hasHeader: true, rawRows: [], sheets: [], selectedSheet: null,
  transactions: [], warnings: [],
  rows: [
    ["2026-01-05", "Supplier transfer", "1,234.56", "DR", "-1,234.56"],
    ["2026-01-06", "Refund", "USD 100.50", "CR", "-1,134.06"],
    ["2026-01-07", "Bad amount", "1O0.00", "DR", ""],
    ["2026-01-08", "Conflicting direction", "-50.00", "CR", ""],
    ["2026-01-09", "Bad grouping", "12,34.56", "DR", ""],
    ["2026-01-10", "Bad balance", "25.00", "DR", "1O0.00"],
    ["2026-01-11", "Missing direction", "25.00", "", ""],
  ],
};
const mapping = suggestMapping(columns);
assert.ok(hasRequiredMapping(mapping));
const result = mapStatementRows(parsed, mapping, { sourceName: "test.csv", account: "Test account", currency: "USD" });
assert.equal(result.transactions.length, 2);
assert.equal(result.skippedRows, 5);
assert.deepEqual(result.excludedRows.map(({ rowNumber }) => rowNumber), [3, 4, 5, 6, 7]);
assert.equal(result.excludedRows[3].reason, "Invalid running balance.");
assert.equal(result.transactions[0].debit, 1234.56);
assert.equal(result.transactions[0].balance, -1234.56);
assert.equal(result.transactions[1].credit, 100.5);

const splitMapping = suggestMapping(["Date", "Description", "Amount", "Debit", "Credit"]);
assert.equal(splitMapping.amount, null);
assert.ok(hasRequiredMapping(splitMapping));

global.FileReader = class {
  readAsArrayBuffer(file) {
    file.arrayBuffer().then((buffer) => {
      this.result = buffer;
      this.onload?.();
    }).catch((error) => {
      this.error = error;
      this.onerror?.();
    });
  }
};

async function verifyMt940() {
  const statement = [
    ":20:TEST",
    ":25:ACCOUNT-1",
    ":60F:C261001USD1000,00",
    ":61:261002D1,000NTRFBAD",
    ":61:261002D100,00NTRFGOOD",
    ":86:Supplier transfer",
    ":62F:C261002USD900,00",
  ].join("\n");
  const parsedStatement = await parseStatementFile(new File([statement], "statement.mt940"));
  assert.equal(parsedStatement.transactions.length, 1);
  assert.equal(parsedStatement.transactions[0].balance, 900);
  assert.equal(parsedStatement.transactions[0].currency, "USD");
  assert.ok(parsedStatement.warnings.some((warning) => warning.includes("invalid date or amount")));
}

verifyMt940().then(() => {
  console.log("Import checks passed: numeric formats, excluded rows, and MT940 precision warnings.");
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
