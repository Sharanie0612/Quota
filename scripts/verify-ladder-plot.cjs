// Execute production price/coordinate functions with unit and conversion edge cases.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const source = fs.readFileSync(path.join(__dirname, '../src/lib/ladderPlot.ts'), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText, {exports:exportsObject});
const {comparisonPrice,plotPrice,ladderScale,tokenUnitMultiplier,plotBounds}=exportsObject;
const entry=(price={})=>({price:{currency:'USD',unit:'每百万 tokens',input:1,output:2,...price}});
assert.equal(comparisonPrice(entry(),'total'),3);
assert.equal(comparisonPrice(entry({unit:'每 1K tokens',input:0.001,output:0.002}),'total'),3);
assert.equal(comparisonPrice(entry({input:null}),'input'),null);
assert.equal(comparisonPrice(entry({input:null}),'output'),2);
for(const unit of ['','每张图片','每 MB']) assert.equal(tokenUnitMultiplier(unit),null);
for(const price of [{input:-1},{input:NaN},{output:Infinity},{input:Number.MAX_VALUE,output:Number.MAX_VALUE}])assert.equal(comparisonPrice(entry(price),'total'),null);
assert.equal(comparisonPrice(entry({input:0,output:0}),'total'),0);
const rate={cnyPerUsd:7,date:'2026-10-07',error:null};
assert.equal(plotPrice(entry(),'total','CNY',rate),21);
assert.equal(plotPrice(entry({currency:'CNY'}),'total','CNY',rate),3);
assert.equal(plotPrice(entry(),'total','USD',rate),3);
assert.equal(plotPrice(entry({currency:'CNY',input:7,output:14}),'total','USD',rate),3);
for(const value of [0,-1,NaN,Infinity])assert.equal(plotPrice(entry(),'total','CNY',{...rate,cnyPerUsd:value}),null);
assert.equal(plotPrice(entry({currency:'EUR'}),'total','CNY',rate),null);
assert.equal(plotPrice(entry({input:Number.MAX_VALUE,output:0}),'total','CNY',rate),null);
console.log('PASS explicit Token unit normalization, missing/invalid prices, free models and finite FX conversion');
const points=[{cost:0,score:0},{cost:2,score:90},{cost:2.01,score:91},{cost:21,score:100}];
const scale=ladderScale(points);
assert.equal(scale.x(0),plotBounds.left);assert.ok(scale.x(21)<plotBounds.right);
assert.equal(scale.y(0),plotBounds.bottom);assert.equal(scale.y(100),plotBounds.top);
assert.ok(scale.x(2)<scale.x(2.01));assert.ok(scale.y(90)>scale.y(91));
const duplicated=ladderScale([...points,...Array.from({length:30},()=>points[1])]);
assert.equal(scale.x(2),duplicated.x(2));assert.equal(scale.y(90),duplicated.y(90));
for(const point of points){assert.ok(Number.isFinite(scale.x(point.cost)));assert.ok(Number.isFinite(scale.y(point.score)));}
assert.equal(scale.ticks[0],0);assert.equal(scale.ticks.at(-1),scale.max);
for(let i=1;i<scale.ticks.length;i++)assert.ok(scale.ticks[i]>scale.ticks[i-1]);
const perfect=ladderScale([{cost:0,score:100}]);assert.ok(Number.isFinite(perfect.y(100)));
const narrow=ladderScale([{cost:.002,score:81},{cost:.003,score:82}]);
assert.ok(narrow.min>79&&narrow.maxScore<84);
assert.ok(narrow.minCost>0&&narrow.minCost<.002&&narrow.max>.003&&narrow.max<.004);
assert.ok(narrow.x(.003)-narrow.x(.002)>500);
for(const values of [[],[{cost:0,score:50}],[{cost:.01,score:50}],[{cost:Number.MIN_VALUE,score:100}],[{cost:Number.MAX_VALUE,score:0}],[{cost:0,score:50},{cost:Number.MAX_VALUE,score:51}]]){
  const adapted=ladderScale(values);
  for(const p of values){assert.ok(Number.isFinite(adapted.x(p.cost)));assert.ok(Number.isFinite(adapted.y(p.score)));assert.ok(adapted.x(p.cost)>=plotBounds.left-.001&&adapted.x(p.cost)<=plotBounds.right+.001);}
  assert.ok(adapted.ticks.every(Number.isFinite));assert.ok(adapted.scoreTicks.every(Number.isFinite));
}
console.log('PASS automatic price and score domains expand narrow ranges, include all data and handle empty/free/extreme models');
console.log('PASS price/ability coordinates are monotonic, exact and independent of duplicates; endpoints and ticks remain finite');
