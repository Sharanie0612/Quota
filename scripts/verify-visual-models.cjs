const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const modules = new Map();
function load(name) {
  if (modules.has(name)) return modules.get(name);
  const file = path.resolve(__dirname, '../src/lib', name + '.ts');
  const { outputText } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const module = { exports: {} };
  const resolve = name => name.startsWith('./') ? load(name.slice(2)) : require(name);
  new Function('require', 'module', 'exports', outputText)(resolve, module, module.exports);
  modules.set(name, module.exports);
  return module.exports;
}

const { aaDomains, aaVersion, evaluationWeight } = load('aaMethodology');
const { filterVisualModels, inEvaluationWindow, modelIdentity, rankVisualModels, visualModels } = load('visualModels');
const version = 'Intelligence Index v5.0.1';
const sourceId = 'artificial-analysis';
const profile = (id, index) => ({
  id, index, modelId: 'test', vendor: 'Vendor', name: `Test (${id})`, setting: id, sourceId, version,
});
const observations = [
  ['AA-Briefcase v1.1', 1500, 'Elo'],
  ['AutomationBench-AA', 100],
  ['GDP.pdf', 0],
  ['FrontierCode 2.0', 80],
  ['Terminal-Bench 4.0', 30],
  ['Terminal-Bench-Science 0.1', 50],
  ['CritPt v2 · hard subset', 75],
  ['HLE-Diamond', 50],
  ['AA-Omniscience v1.1 · accuracy', 40],
  ['AA-Omniscience v1.1 · non-hallucination', 80],
  ['MMMU-Pro', 99],
].map(([metric, value, unit = 'percent']) => ({
  sourceId, profileId: 'High', modelId: 'test', vendor: 'Vendor', setting: 'High', metric, unit, value, official: false,
}));
observations.push(
  { ...observations[3], profileId: 'Low', setting: 'Low', value: 18 },
  { ...observations[4], profileId: 'Low', setting: 'High', value: 75 },
  { ...observations[3], value: 99, vendor: 'Impostor' },
  { ...observations[3], value: 99, sourceId: 'official-openai' },
  { ...observations[5] },
);
const result = profile => ({ sourceId, profileId: profile.id, score: profile.index, url: 'https://artificialanalysis.ai/leaderboards/models' });
const profiles = [profile('High', 58.12345), profile('Low', 58.12345)];
const board = {
  sources: [{ id: sourceId, checkedAt: '2026-11-12T00:00:00Z', edition: { version, publishedAt: '', primaryProfiles: ['High'] } }],
  models: [{ id: 'test', name: 'Test', vendor: 'Vendor', observations, results: profiles.map(result) }],
  profiles,
  releases: [{ id: 'test', name: 'Test', vendor: 'Vendor', releasedAt: '2026-06-20' }],
};
const registry = { models: [{ available: true, name: 'Test', apiId: 'test', vendor: 'Impostor', verifiedAt: '2026-11-12T00:00:00Z', price: { currency: 'CNY', input: 1, output: 1 } }] };

assert.equal(aaDomains.flatMap(domain => domain.evaluations).length, 9);
for (const domain of aaDomains) assert.equal(domain.evaluations.reduce((sum, evaluation) => sum + evaluationWeight(evaluation), 0), 25);
assert.equal(aaVersion('Intelligence Index v5'), 'v5.0');
assert.equal(aaVersion(version), 'v5.0.1');
assert.equal(aaVersion('Intelligence Index v5.1'), null);
assert.notEqual(modelIdentity('Model (0902)'), modelIdentity('Model (0903)'));
assert.equal(modelIdentity('Model (High, Default Fallback)'), modelIdentity('Model'));

let rows = visualModels(board, registry, null);
assert.equal(rows.length, 2);
const high = rows.find(row => row.profile.id === 'High');
const low = rows.find(row => row.profile.id === 'Low');
assert.deepEqual(high.breakdown.scores, { 'knowledge-work': 50, coding: 60, science: 60, 'general-knowledge': 52 });
assert.equal(high.breakdown.coverage, 9);
assert.equal(high.breakdown.raw.get('AA-Briefcase v1.1').unit, 'Elo');
assert.equal(high.breakdown.raw.get('GDP.pdf').value, 0);
assert.equal(high.breakdown.raw.get('MMMU-Pro').value, 99);
assert.equal(low.breakdown.coverage, 1);
assert.equal(low.entry.rankings.coding, undefined);
assert.equal(high.entry.rankings.general.score, 58.12345, 'AA published score stays exact');
assert.equal(high.entry.price.input, null, 'same name across vendors must not borrow pricing');
assert.deepEqual(rankVisualModels(rows, 'general').map(row => row.rank), [1, 1]);
assert.deepEqual(rankVisualModels(rows, 'coding').map(row => row.model.profile.id), ['High']);

observations.push({ ...observations[3], value: 81 });
assert.equal(visualModels(board, registry, null)[0].breakdown.scores.coding, undefined, 'conflicting duplicate cannot become a score');
observations.pop();
registry.models[0].vendor = 'Vendor';
rows = visualModels(board, registry, null);
assert.equal(rows[0].entry.price.input, 1);
assert.equal(rows[0].release.releasedAt, '2026-06-20');

const today = new Date(2026, 10, 12, 12);
assert(inEvaluationWindow('2026-10-14', 30, today));
assert(!inEvaluationWindow('2026-10-13', 30, today));
assert(!inEvaluationWindow('2026-11-13', 30, today));
assert(!inEvaluationWindow('2026-02-30', 30, today));
assert.equal(filterVisualModels(rows, 'all30', today).length, 0, 'unknown patch day cannot inherit the original launch day');
assert.deepEqual(filterVisualModels(rows, 'main', today).map(model => model.profile.id), ['High']);
board.sources[0].edition.publishedAt = '2026-10-27';
rows = visualModels(board, registry, null);
assert.equal(filterVisualModels(rows, 'all30', today).length, 2, 'old model release is irrelevant to edition freshness');
assert.equal(filterVisualModels(rows, 'main30', today).length, 1);
board.sources[0].edition.publishedAt = '2026-10-01';
rows = visualModels(board, registry, null);
assert.equal(filterVisualModels(rows, 'main30', today).length, 0, 'fresh retrieval cannot renew an old evaluation');
assert.equal(filterVisualModels(rows, 'all', today).length, 2);
console.log('PASS AA weights and four scores, raw Elo and zeros, configuration isolation, conflict rejection, ranking ties, vendor pricing and edition freshness');
