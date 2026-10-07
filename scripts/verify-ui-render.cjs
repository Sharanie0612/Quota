// Static rendering of production components; this is not a browser/layout check.
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const cache = new Map();
function load(file) {
  if (cache.has(file)) return cache.get(file);
  const exports = {}; cache.set(file, exports);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function('exports', 'require', js)(exports, name => {
    if (!name.startsWith('.')) return require(name);
    if (name.endsWith('.css')) return {};
    if (name.endsWith('.svg')) return { default: name };
    const base = path.resolve(path.dirname(file), name);
    return load([base, `${base}.ts`, `${base}.tsx`].find(p => fs.existsSync(p) && fs.statSync(p).isFile()));
  });
  return exports;
}
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const { LadderChart } = load(path.resolve(__dirname, '../src/components/LadderChart.tsx'));
const entry = (id, currency, input) => ({ id, name: id, provider: 'deepseek', vendor: 'DeepSeek', price: { currency, input, output: input, unit: '每百万 Token' }, rankings: { general: { rank: 1, score: 90 } }, verifiedAt: '2026-10-04' });
const entries = [entry('model-yuan', 'CNY', 1), entry('model-dollar', 'USD', 1), { ...entry('unknown', 'CNY', null), verifiedAt: null }];
const noExchange = render(LadderChart, {entries, domain:'general', focused:null, onFocus:()=>{}, layout:'combined', exchange:null});
assert.match(noExchange,/可切换人民币或美元/);
assert.match(noExchange,/model-dollar · 未标注 · 等待可用汇率/);
const props = { entries, domain: 'general', focused: null, onFocus: () => {}, exchange: { cnyPerUsd:7, date:"2026-10-02", error:null } };
const split = render(LadderChart, { ...props, layout: 'split' });
const combined = render(LadderChart, { ...props, layout: 'combined' });
assert.equal((combined.match(/role="group"/g) || []).length, 1);
for (const html of [combined]) {
  assert.match(html, /CNY/); assert.match(html, /USD/); assert.match(html, /汇率仅供比较/);
  assert.equal((html.match(/role="button"/g) || []).length, 2);
  assert.ok(!/NaN|Infinity/.test(html));
}
assert.match(combined, /1 USD = 7.0000 CNY/);
assert.match(combined, /CNY统一价格与性能坐标图/);
const noRate = render(LadderChart,{...props,layout:'combined',exchange:null});
assert.equal((noRate.match(/role="button"/g)||[]).length,1);
console.log('PASS one normalized price axis, original prices, FX-unavailable fallback and exclusion of unknown prices');

const { AccountCard } = load(path.resolve(__dirname, '../src/components/AccountCard.tsx'));
const balance = { total: 10, currency: 'CNY', source: 'api', usable: true, note: 'synthetic note', amounts: [{ kind: 'granted', label: '赠送余额', value: 0 }, { kind: 'cumulative_spend', label: '累计消费', value: 25 }] };
const account = { id: 'synthetic', provider: 'zhipu', providerName: 'GLM', label: 'Synthetic', balanceMode: 'auto', balanceSupported: false, low: false, needsApiKey: false, status: { balance, subscription: null, balanceError: 'synthetic failure', modelsError: null, models: [], lastChecked: null } };
const cardProps = { account, busy: false, onRefresh: () => {}, onEdit: () => {}, onUseManual: () => {}, onShowModels: () => {} };
const card = render(AccountCard, cardProps);
assert.match(card, /累计消费/); assert.match(card, /synthetic failure/); assert.match(card, /改用手动余额/);
assert.ok(card.includes('class="balance-spend"')); assert.ok(card.includes('<span>累计消费</span>')); assert.ok(!card.includes('<details open'));
assert.match(card, /0\.00/);
const partialPlan = render(AccountCard, { ...cardProps, account: { ...account, provider: 'mimo-plan', status: { ...account.status, balanceError: null, balance: { ...balance, currency: 'Credits', amounts: [] } } } });
assert.match(partialPlan, /已同步额度/); assert.ok(!partialPlan.includes('暂无订阅额度'));
console.log('PASS account details remain collapsed, zero displayed, unsupported-provider errors visible, partial subscription value retained');

// Model families use their own local logos, rather than parent-company graphics.
const modelNames=['GPT-6','Claude Opus','Gemini Flash','Gemma 4','Nano Banana 2','DeepSeek V4','Kimi K3','GLM-5','MiMo-V2','Qwen3','Grok 4','Muse Spark','Wan 3'];
const {ModelLogo,modelBrand}=load(path.resolve(__dirname,'../src/components/ModelLogo.tsx'));
const allModels=render(LadderChart,{...props,entries:modelNames.map((name,i)=>({...entry('model-'+i,'CNY',i+1),name}))});
for(const name of modelNames) assert.equal(allModels.split('data-model-brand="'+modelBrand(name)+'"').length-1,2);
for(const [name,file] of [['Claude Opus','claude-color'],['Gemini Flash','gemini-color'],['Gemma 4','gemma-color'],['GLM-5','zai'],['MiMo-V2','xiaomimimo'],['Qwen3','qwen-color'],['Grok 4','grok']]) assert.ok(render(ModelLogo,{name}).includes(file+'.svg'));
assert.ok(render(ModelLogo,{name:'Muse Spark'}).includes('Muse 模型缩写'));
assert.ok(!allModels.includes('scatter-dot'));
const selectedCard=render(LadderChart,{...props,focused:entries[0]});
assert.match(selectedCard,/scatter-selection-ring/);
console.log('PASS model-family logos identify chart points and legends; missing independent logos use labelled model initials');
const overlapping=[entry('overlap-a','CNY',1),entry('overlap-b','CNY',1),entry('neighbour','CNY',1.01),entry('axis-end','CNY',10)];
const overlapHtml=render(LadderChart,{...props,entries:overlapping,focused:overlapping[1]});
assert.match(overlapHtml,/同坐标 2 个型号/);
assert.match(overlapHtml,/此位置附近 3 个型号/);
for(const id of ['overlap-a','overlap-b','neighbour']) assert.ok(overlapHtml.includes(id));
const {ladderScale}=load(path.resolve(__dirname,'../src/lib/ladderPlot.ts'));
const scale=ladderScale(overlapping.map(e=>({cost:e.price.input+e.price.output,score:90})));
const pointTags=[...overlapHtml.matchAll(/data-cost="([^"]+)" data-score="([^"]+)" data-plot-x="([^"]+)" data-plot-y="([^"]+)"/g)];
assert.equal(pointTags.length,3);
for(const [,cost,score,x,y] of pointTags){assert.equal(Number(x),scale.x(Number(cost)));assert.equal(Number(y),scale.y(Number(score)));}
const precise=render(LadderChart,{...props,entries:[entry('micro','CNY',0.000001)],focused:entry('micro','CNY',0.000001)});
assert.match(precise,/¥0.000002/);
for(const rate of [0,-1,NaN,Infinity]){const invalidRate=render(LadderChart,{...props,exchange:{...props.exchange,cnyPerUsd:rate}});assert.match(invalidRate,/可切换人民币或美元/);assert.equal((invalidRate.match(/role="group"/g)||[]).length,1);}
console.log('PASS overlapping markers keep exact numeric coordinates and all models selectable; small-price precision and invalid-FX fallback retained');

const {activityModelChoices,activityModelIdentity}=load(path.resolve(__dirname,'../src/lib/activityModels.ts'));
const modelRows=['openai/gpt-5.4 (high)','gpt-5.4 (low)','zai/glm-5','deepseek/deepseek-v3','custom/model-x',''].map((key,i)=>({key,tokens:{total:100*(i+1)},sessions:i,calls:0}));
assert.equal(activityModelIdentity('openai/gpt-5.4').vendor,'OpenAI');
assert.equal(activityModelIdentity('zai/glm-5').provider,'zhipu');
assert.equal(activityModelIdentity('o3').vendor,'OpenAI');
assert.equal(activityModelIdentity('custom/model-x').vendor,'其他 / 未识别');
assert.equal(activityModelChoices(modelRows,'OpenAI high').map(r=>r.key).join(','),'openai/gpt-5.4 (high)');
assert.equal(activityModelChoices(modelRows,'智谱').map(r=>r.key).join(','),'zai/glm-5');
assert.equal(activityModelChoices(modelRows,'nonesuch').length,0);
assert.equal(activityModelChoices(modelRows,'').length,5);
const {ActivityModelPicker}=load(path.resolve(__dirname,'../src/components/ActivityModelPicker.tsx'));
const picker=render(ActivityModelPicker,{rows:modelRows,value:'openai/gpt-5.4 (high)',onChange:()=>{},loading:false});
assert.match(picker,/openai\/gpt-5\.4 \(high\)/);assert.match(picker,/OpenAI/);assert.match(picker,/供应商汇总/);assert.match(picker,/vendor:custom/);assert.match(picker,/搜索模型或厂商/);
const pendingPicker=render(ActivityModelPicker,{rows:[],value:'',onChange:()=>{},loading:true});assert.match(pendingPicker,/disabled/);assert.ok(!pendingPicker.includes('0 Token'));
const absentPicker=render(ActivityModelPicker,{rows:modelRows,value:'missing-model',onChange:()=>{},loading:false});assert.match(absentPicker,/missing-model/);
console.log('PASS model namespaces/effort IDs preserved, vendor search and unknown recovery, vendor totals and loading state');

const {AbilityRadar}=load(path.resolve(__dirname,'../src/components/AbilityRadar.tsx'));
const incomplete=render(AbilityRadar,{entries:[entry('sparse','CNY',1)]});
assert.ok(!incomplete.includes('fill-opacity="0.08"')); // missing five axes never become zero
const completeEntry={...entry('complete','CNY',1),rankings:Object.fromEntries(['general','coding','math','science','reasoning','agents'].map(key=>[key,{score:50}]))};
assert.match(render(AbilityRadar,{entries:[completeEntry]}),/fill-opacity="0.08"/);
const {CacheUsage}=load(path.resolve(__dirname,'../src/components/CacheUsage.tsx'));
const cacheRows=['gpt-6.1-sol','GLM-5.3','deepseek-flash'].map(key=>({key,tokens:{input:100,cached:70},sessions:1,calls:0}));
const cacheProps={rows:cacheRows,modelKeys:cacheRows.map(row=>row.key),format:String,onModel:()=>{}};
const cacheHtml=render(CacheUsage,cacheProps);assert.match(cacheHtml,/70.0%/);assert.match(cacheHtml,/>30<\/td>/);
const colors=[...cacheHtml.matchAll(/class="cache-color" style="background:([^\"]+)/g)].map(m=>m[1]);assert.equal(new Set(colors).size,3);
const onlyOne=render(CacheUsage,{...cacheProps,rows:[cacheRows[1]]});assert.ok(onlyOne.includes(`background:${colors[1]}`));
console.log('PASS six-dimensional radar never fills missing axes; cache ratios, miss counts and scoped model colors stay consistent');

const {SettingsView}=load(path.resolve(__dirname,'../src/views/SettingsView.tsx'));
const settingsHtml=render(SettingsView,{settings:{autoRefresh:true,refreshIntervalMinutes:30,notifyLowBalance:true,closeToTray:true,defaultLowThreshold:5,notifyRecharge:true,trayAlert:true,ladderAutoUpdate:true},onUpdate:()=>{},info:null});
assert.match(settingsHtml,/>导出<\/button>/);assert.match(settingsHtml,/Token 采集频率/);assert.match(settingsHtml,/导出备份/);assert.ok(!settingsHtml.includes('飞书'));assert.ok(!settingsHtml.includes('导出数据</button>'));
assert.match(settingsHtml,/导入数据 \/ 迁移账户/);assert.match(settingsHtml,/未选内容保留/);assert.match(settingsHtml,/macOS/);
assert.match(settingsHtml,/跨设备同步/);assert.match(settingsHtml,/iCloud Drive/);assert.match(settingsHtml,/不含任何登录凭据/);
console.log('PASS unified backup export/import, configurable collection frequency, shared account privacy boundary and no Feishu sync entry');

const {priceText}=load(path.resolve(__dirname,'../src/lib/format.ts'));
assert.equal(priceText(0.0125,'CNY'),'¥0.0125');assert.equal(priceText(123.456,'USD'),'$123.456');assert.equal(priceText(0.000001,'USD'),'$0.000001');
console.log('PASS official price precision retained for small cache rates and large values');
