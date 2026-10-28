const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
function load(name){const result={};new Function('exports',ts.transpileModule(fs.readFileSync(path.join(__dirname,'../src/lib',name),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText)(result);return result;}
const {shares,cacheShares}=load('activityShares.ts');
const row=(key,total,input=total,cached=0)=>({key,tokens:{total,input,cached,cacheWrite:input/2,output:0,reasoning:0},calls:1,sessions:1});
const rows=Array.from({length:12},(_,i)=>row('m'+i,i+1));
const grouped=shares(rows,k=>k,4);
assert.equal(grouped.length,5);assert.equal(grouped.at(-1).name,'其他');
assert.equal(grouped.reduce((sum,r)=>sum+r.value,0),rows.reduce((sum,r)=>sum+r.tokens.total,0));
assert.deepEqual(shares([row('zero',0),row('missing',NaN)],k=>k),[]);
assert.deepEqual(cacheShares([row('one',130,100,40)]).map(r=>r.value),[40,60]);
assert.deepEqual(cacheShares([row('one',100,100,120),row('negative',0,-4,-5)]).map(r=>r.value),[100,0]);
assert.deepEqual(cacheShares([]).map(r=>r.value),[0,0]);
const {frontier}=load('benchmarkCharts.ts');
const profile=(cost,index)=>({cost,index,modelId:'fixture'});
const points=[profile(1,20),profile(2,15),profile(3,25),profile(3,30),profile(null,100),profile(0,80),profile(NaN,40)];
assert.deepEqual(frontier(points).map(p=>[p.cost,p.index]),[[1,20],[3,30]]);assert.equal(points.length,7);
assert.deepEqual(frontier([]),[]);
const seed=JSON.parse(fs.readFileSync(path.join(__dirname,'../src-tauri/data/benchmarks.json'),'utf8'));
assert.equal(seed.schema,3);
assert.ok(seed.epoch.models.length>=200);
assert.ok(seed.epoch.curves.length>=50);
assert.equal(new Set(seed.epoch.records.map(r=>[r.modelId,r.configuration,r.benchmark].join('|'))).size,seed.epoch.records.length);
for(const m of seed.epoch.models){assert.ok(m.benchmarkCount>=4);if(m.lower!=null)assert.ok(m.lower<=m.score&&m.upper>=m.score);}
const curves=new Map(seed.epoch.curves.map(c=>[c.name,c]));
for(const r of seed.epoch.records){const c=curves.get(r.benchmark);assert.ok(c);assert.ok(Math.abs(r.normalized-Math.max(0,Math.min(1,(r.raw-c.baseline)/(c.ceiling-c.baseline))))<1e-10);}
const policy=JSON.parse(fs.readFileSync(path.join(__dirname,'../src-tauri/data/benchmark-policy.json'),'utf8'));
assert.equal(policy.minimumBenchmarks,2);assert.equal(policy.domains.length,4);assert.ok(policy.domains.every(d=>!d.benchmarks.includes('Terminal Bench')));
assert.equal(new Set(seed.profiles.map(p=>p.id)).size,seed.profiles.length);
assert.ok(seed.profiles.every(p=>p.id));
const weights=seed.sources.find(s=>s.id==='livebench').weights;
assert.equal(weights['LiveBench Long Agentic'],2);assert.equal(weights['LiveBench Coding'],1.5);assert.equal(weights['LiveBench Design'],1.5);
assert.ok(seed.sources.some(s=>s.id==='official-anthropic'&&!s.automatic));
for(const o of seed.observations){assert.ok(o.url.startsWith('https://'));assert.ok(Number.isFinite(Date.parse(o.checkedAt)));assert.ok(Number.isFinite(o.value));}
for(const p of seed.profiles){assert.equal(p.version,'Intelligence Index v5');assert.ok(p.cost==null||p.cost>=0);}
console.log('PASS top-model shares preserve totals, zero/invalid data, cache subsets never double-count, cost/quality Pareto frontier and benchmark provenance');
