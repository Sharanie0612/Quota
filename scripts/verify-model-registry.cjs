const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
const root=path.resolve(__dirname,'..');
const snapshot=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/ai-models.json'),'utf8'));
assert.equal(snapshot.schema,1);assert.equal(snapshot.sources.length,10);assert.ok(Number.isFinite(Date.parse(snapshot.checkedAt)));
assert.equal(new Set(snapshot.models.map(model=>model.id)).size,snapshot.models.length);
let current=0;
for(const model of snapshot.models){
  assert.equal(model.id,`${model.provider}:${model.apiId}`);
  if(model.verifiedAt){assert.ok(Number.isFinite(Date.parse(model.verifiedAt)));assert.ok(model.source.startsWith('https://'));assert.ok(model.price);}
  for(const price of [model.price,...model.priceOptions.map(option=>option.price)].filter(Boolean)){
    assert.ok(['CNY','USD'].includes(price.currency));
    for(const key of ['input','output','cachedInput','cacheWrite','cacheWriteLong'])if(price[key]!=null)assert.ok(Number.isFinite(price[key])&&price[key]>=0,model.id+' '+key);
  }
  for(const write of model.cacheWrites){assert.ok(write.ttlSeconds>0&&Number.isFinite(write.price)&&write.price>=0);}
  if(model.verifiedAt===snapshot.checkedAt)current++;
}
assert.equal(current,snapshot.sources.reduce((sum,source)=>sum+source.models,0));
assert.equal(snapshot.models.filter(model=>model.available).length,current);
for(const [apiId,vendor] of [['deepseek-flash','DeepSeek'],['glm-5.3','Z AI'],['kimi-k2.6','Kimi'],['mimo-v2.6-pro','Xiaomi']]){
  const models=snapshot.models.filter(model=>model.apiId===apiId);assert.equal(models.length,1,apiId+' must have one original vendor');assert.equal(models[0].vendor,vendor);
}
for(const source of snapshot.sources){assert.equal(source.error,null);assert.ok(source.models>0);assert.equal(source.checkedAt,snapshot.checkedAt);}
for(const id of ['gpt-6.1-sol','kimi-k3.1-pro','claude-fable-5-1'])assert.ok(snapshot.models.some(model=>model.apiId===id));
console.log(`PASS registry identities, provenance, ${current} current official quotes across ten sources and cache TTLs`);
