const assert=require('node:assert/strict'),fs=require('node:fs'),ts=require('typescript'),path=require('node:path');
function load(name){const src=fs.readFileSync(path.resolve(__dirname,'../src/lib',name+'.ts'),'utf8'),out=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;const mod={exports:{}};new Function('require','module','exports',out)(require,mod,mod.exports);return mod.exports;}
const {callLayout,nearestCall}=load('outputCalls'),{scatterClusters,plotPriceLabel}=load('scatterLayout');
const rows=Array.from({length:10000},(_,i)=>({id:'call-'+i,completedAt:1000000+Math.floor(i/2)*1000,speed:i%2?50:100}));
const layout=callLayout(rows,900,310);assert.equal(layout.points.length,10000);assert.equal(new Set(layout.points.map(p=>p.call.id)).size,10000);
for(const p of layout.points){assert(p.x>=layout.left&&p.x<=layout.right);assert(p.y>=layout.top&&p.y<=layout.bottom);}
assert.equal(layout.points[0].x,layout.points[1].x);assert.notEqual(layout.points[0].y,layout.points[1].y);
assert.equal(nearestCall(layout.points,layout.points[0].x,layout.points[0].y).call.speed,100);assert.equal(nearestCall(layout.points,-500,-500),undefined);
const singleton=callLayout([rows[0]],900,310);assert.equal(singleton.points[0].x,(singleton.left+singleton.right)/2);assert(callLayout([],900,310).points.length===0);
for(const width of [620,950,1800]){
  const points=Array.from({length:77},(_,i)=>({id:String(i),cost:i/3,score:i/2,x:45+i%12*width/40,y:40+Math.floor(i/12)*19}));
  const clusters=scatterClusters(points),members=clusters.flatMap(c=>c.members);assert.equal(members.length,77);assert.equal(new Set(members.map(p=>p.id)).size,77);
  for(let i=0;i<clusters.length;i++){assert(points.includes(clusters[i].anchor));for(let j=0;j<i;j++)assert(Math.hypot(clusters[i].anchor.x-clusters[j].anchor.x,clusters[i].anchor.y-clusters[j].anchor.y)>=28);}
  members.forEach(p=>assert.equal(p,points.find(raw=>raw.id===p.id)));
}
assert.equal(plotPriceLabel(79.996784739,'CNY'),'¥80');assert.equal(plotPriceLabel(.000001,'CNY'),'¥1.00e-6');
console.log('PASS 10000 distinct calls, duplicate timestamps, exact sample speeds, hover, singleton/empty, collision-free groups and unmodified source coordinates');
