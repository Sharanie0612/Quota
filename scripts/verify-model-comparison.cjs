/* 执行生产 TS 分组逻辑：验证币种/单位隔离和缺失价格，不依赖 UI 演示数据。 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/lib/modelComparison.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported }, { filename: "modelComparison.ts" });
const { comparisonCost, groupModelComparisons } = exported;
const card = (id, price = {}) => ({ id, price: { currency: "CNY", unit: "每 1M tokens", input: 2, output: 8, ...price } });

const groups = groupModelComparisons([
  card("cny", { input: 9, output: 11 }), card("usd", { currency: "USD", input: 1, output: 2 }),
  card("thousand", { unit: "每 1K tokens", input: 100, output: 300 }),
  card("alias", { currency: " cny ", unit: "每百万 Token", input: 1, output: 2 }),
  card("partial", { input: null }), card("free", { input: 0, output: 0 }),
]);
assert.equal(groups.length, 3);
const million = groups.find(g => g.currency === "CNY" && g.unit === "每百万 Token");
assert.equal(million.cards.map(c => c.id).join(","), "free,alias,cny,partial");
assert.equal(million.maxCost, 20);
assert.equal(groups.find(g => g.currency === "USD").maxCost, 3);
assert.equal(groups.find(g => g.unit === "每 1K tokens").maxCost, 400);
console.log("PASS currencies and units separated; canonical million-token aliases share a scale; maxima independent");

for (const price of [{ input: null }, { output: null }, { currency: "" }, { unit: "" }, { input: -1 }, { output: NaN }, { input: Infinity }, { input: Number.MAX_VALUE, output: Number.MAX_VALUE }]) {
  assert.equal(comparisonCost(card("invalid", price)), Infinity);
}
assert.equal(comparisonCost({ id: "unknown", price: null }), Infinity);
assert.equal(comparisonCost(card("free", { input: 0, output: 0 })), 0);
const allMissing = groupModelComparisons([card("one", { input: null }), card("two", { output: null })]);
assert.equal(allMissing[0].maxCost, 0);
assert.equal(allMissing[0].cards.map(c => c.id).join(","), "one,two");
console.log("PASS missing, negative, nonfinite and overflow costs excluded; real zero and stable unknown order retained");

assert.equal(groupModelComparisons([card("one", { unit: "每 MB" }), card("two", { unit: "每 Mb" })]).length, 2);
assert.equal(groupModelComparisons([card("one", { unit: "" }), card("two")]).length, 2);
assert.equal(groupModelComparisons([card("one", { currency: "" }), card("two")]).length, 2);
assert.equal(groupModelComparisons([]).length, 0);
console.log("PASS unknown units and currencies stay separate; case-sensitive non-token units not guessed equivalent");
