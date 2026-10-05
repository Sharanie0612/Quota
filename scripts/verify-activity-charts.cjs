// Execute production date bucketing and server-render the real chart component.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', js)(exports, name => {
    if (!name.startsWith('.')) return require(name);
    if (name.endsWith('.css')) return {};
    const base = path.resolve(path.dirname(file), name);
    const found = [base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!found) throw Error(name);
    return load(found);
  });
  return exports;
}
const { usageCalendar, bucketUsage, heatLevel, emptyTokens, parseDay } = load(path.resolve(__dirname, '../src/lib/activityCharts.ts'));
const row = (key, total) => ({ key, tokens: { ...emptyTokens(), input: total * .8, cached: total * .4, output: total * .2, total }, calls: 0, sessions: 1 });
const now = new Date(2026, 9, 4, 8, 30);
const rows = [row('2026-09-28', 100), row('2026-09-30', 200), row('2026-10-04', 300), row('2026-10-05', 900), row('2026-02-30', 999)];
const days = usageCalendar(rows, 7, now);
assert.equal(days.length, 7); assert.equal(days[0].key, '2026-09-28'); assert.equal(days[6].key, '2026-10-04');
assert.equal(days.reduce((n, d) => n + d.tokens.total, 0), 600);
assert.equal(days[1].tokens.total, 0); assert.equal(days[1].recorded, false);
assert.equal(parseDay('2026-02-30'), null);
assert.equal(usageCalendar([row('2024-02-29', 10)], 0, now, 2024).length, 366);
console.log('PASS local calendar boundaries, leap year, missing days and future/invalid dates');
for (const scale of ['day', 'week', 'month']) {
  const groups = bucketUsage(days, scale);
  assert.equal(groups.reduce((n, d) => n + d.tokens.total, 0), 600);
  assert.equal(groups.reduce((n, d) => n + d.tokens.cached, 0), 240);
}
assert.equal(bucketUsage(days, 'week')[0].key, '2026-09-28');
assert.equal(bucketUsage(days, 'month').length, 2);
assert.equal(heatLevel(0, 100), 0); assert.equal(heatLevel(1, 100), 1); assert.equal(heatLevel(100, 100), 4);
assert.equal(usageCalendar([row('2026-10-04', 10), row('2026-10-04', 20)], 1, now)[0].tokens.total, 30);
console.log('PASS day/week/month totals conserved; cache remains a subset; heat intensity and duplicate days');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ActivityCharts } = load(path.resolve(__dirname, '../src/components/ActivityCharts.tsx'));
const html = renderToStaticMarkup(React.createElement(ActivityCharts, { rows, days: 7, model: 'test-model', metric:'total', setMetric:()=>{}, range:null, onRange:()=>{} }));
assert.match(html, /test-model每日 Token 平滑曲线图/);
assert.match(html, /Token 活动热力图/);
assert.equal((html.match(/class="heatmap-cell /g) || []).length, 7);
assert.equal((html.match(/tabindex="0"/g) || []).length, 2); // one day cell and keyboard-accessible trend
assert.ok(!/NaN|Infinity/.test(html));
console.log('PASS real React chart renders model scope, day line, seven keyboard-accessible cells and finite coordinates');

const {smoothUsagePath}=load(path.resolve(__dirname, "../src/lib/activityCharts.ts"));
assert.equal(smoothUsagePath([]), "");
assert.match(smoothUsagePath([{x:0,y:10},{x:3,y:0},{x:6,y:20}]), /M 0 10 C 1 10, 2 0, 3 0 C 4 0, 5 20, 6 20/);
assert.match(html, /class="usage-area"/);

const {periodRange}=load(path.resolve(__dirname,'../src/lib/activityCharts.ts'));
assert.deepEqual(periodRange('2026-09-28','week','2026-09-30','2026-10-04'),{from:'2026-09-30',to:'2026-10-04'});
assert.deepEqual(periodRange('2024-02-01','month','2024-01-01','2024-03-01'),{from:'2024-02-01',to:'2024-02-29'});
assert.equal(periodRange('2026-02-30','day','2026-01-01','2026-12-31'),null);
console.log('PASS selected period clips to visible range, leap-month and invalid date handling');
