// Run the production TS projection against synthetic balances; no account data is read.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const ts = require("typescript");
const source = fs.readFileSync(path.join(__dirname, "../src/lib/accountOverview.ts"), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
const exported = {};
vm.runInNewContext(compiled, { exports: exported }, { filename: "accountOverview.ts" });
const { balanceBreakdown, isSubscriptionAccount, overviewState } = exported;
const amount = (kind, value, label = kind) => ({ kind, value, label });
const { fields, spend, extra } = balanceBreakdown({ amounts: [
  amount("cash", 10), amount("granted", 0), amount("cumulative_recharge", 25, "累计充值"),
  amount("cumulative_spend", 15, "累计消费"), amount("frozen", 3), amount("overdraft", 2), amount("bad", NaN),
] });
assert.equal(fields.map(field => field.item.value).join(","), "10,0,25");
assert.equal(extra.map(item => item.kind).join(","), "frozen,overdraft");
assert.equal(balanceBreakdown(null).fields.filter(field => field.item).length, 0);
assert.equal(balanceBreakdown({ amounts: [amount("topped_up", 12)] }).fields[2].item, undefined);
console.log("PASS all returned details retained; zero differs from missing; recharge balance never substituted for lifetime recharge");

const account = (provider, extra = {}) => ({ provider, balanceMode: "auto", low: false, status: { balance: null, subscription: null, balanceError: null }, ...extra });
const accounts = [account("deepseek"), account("moonshot"), account("zhipu"), account("mimo"), account("mimo-plan"), account("custom"), account("unknown-legacy")];
assert.equal(accounts.filter(isSubscriptionAccount).length, 2);
assert.equal(accounts.filter(a => !isSubscriptionAccount(a)).length, 5);
assert.equal(isSubscriptionAccount(account("other", { balanceMode: "codex" })), true);
console.log("PASS complete account partition includes legacy and unknown providers without hiding them");

const state = overviewState([
  account("deepseek", { status: { balance: { total: 0, usable: false }, subscription: null, balanceError: null } }),
  account("mimo-plan", { status: { balance: null, subscription: null, balanceError: "synthetic failure" } }),
  account("zhipu"),
]);
assert.equal(state.low, 1); assert.equal(state.failed, 1); assert.equal(state.pending, 1);
console.log("PASS unavailable balances, failed queries and pending queries cannot appear as all healthy");

const recorded=balanceBreakdown({amounts:[],currency:"CNY"},{manualRechargeTotal:0,manualRechargeCurrency:"USD"});
assert.equal(recorded.fields[2].item.value,0);assert.equal(recorded.fields[2].item.currency,"USD");
assert.equal(balanceBreakdown({amounts:[{kind:"cumulative_recharge",label:"累计充值",value:80}]},{manualRechargeTotal:99,manualRechargeCurrency:"CNY"}).fields[2].item.value,80);
assert.equal(balanceBreakdown(null,{manualRechargeTotal:-1,manualRechargeCurrency:"CNY"}).fields[2].item,undefined);
console.log("PASS manual cumulative recharge zero and currency preserved; official value takes precedence");

assert.equal(spend.value,15);
assert.equal(balanceBreakdown({amounts:[amount("total_spend_amount",0)]}).spend.value,0);
assert.equal(balanceBreakdown({amounts:[amount("cash",2),amount("cumulative_recharge",10)]}).spend,undefined);
assert.equal(balanceBreakdown(null,{manualSpendTotal:0,manualSpendCurrency:"USD"}).spend.currency,"USD");
assert.equal(balanceBreakdown({amounts:[amount("cumulative_spend",3)]},{manualSpendTotal:20,manualSpendCurrency:"CNY"}).spend.value,3);
assert.equal(balanceBreakdown(null,{manualSpendTotal:-1,manualSpendCurrency:"CNY"}).spend,undefined);
console.log("PASS cumulative spend always projected separately; official zero/precedence and manual currency retained; no balance subtraction");
