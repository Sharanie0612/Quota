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
const { LadderChart, ladderCurrencyGroups } = load(path.resolve(__dirname, '../src/components/LadderChart.tsx'));
const entry = (id, currency, input) => ({ id, name: id, provider: 'deepseek', vendor: 'DeepSeek', price: { currency, input, output: input }, rankings: { general: { rank: 1, score: 90 } }, verifiedAt: '2026-10-04' });
const entries = [entry('model-yuan', 'CNY', 1), entry('model-dollar', 'USD', 1), { ...entry('unknown', 'CNY', null), verifiedAt: null }];
const noExchange = render(LadderChart, {entries, domain:'general', focused:null, onFocus:()=>{}, layout:'combined', exchange:null});
assert.match(noExchange,/美元型号不会被隐藏/);
assert.match(noExchange,/aria-label="model-dollar，/);
assert.equal(ladderCurrencyGroups(entries).map(group => group.currency).join(','), 'CNY,USD');
const props = { entries, domain: 'general', focused: null, onFocus: () => {}, exchange: { cnyPerUsd:7, date:"2026-10-02", error:null } };
const split = render(LadderChart, { ...props, layout: 'split' });
const combined = render(LadderChart, { ...props, layout: 'combined' });
assert.equal((split.match(/role="group"/g) || []).length, 2);
assert.equal((combined.match(/role="group"/g) || []).length, 1);
for (const html of [split, combined]) {
  assert.match(html, /CNY/); assert.match(html, /USD/); assert.match(html, /不修改官方价格/);
  assert.equal((html.match(/role="button"/g) || []).length, 2);
  assert.ok(!/NaN|Infinity/.test(html));
}
assert.match(combined, /1 USD = 7.0000 CNY/);
assert.match(combined, /CNY统一价格与性能坐标图/);
const noRate = render(LadderChart,{...props,layout:'combined',exchange:null});
assert.equal((noRate.match(/role="button"/g)||[]).length,2);
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

// Chart and legend use the requested circular markers and the same vendor colors.
const vendorNames=['OpenAI','Anthropic','Google','DeepSeek','Kimi','Z AI','Xiaomi','Alibaba','SpaceXAI','Meta'];
const allVendors=render(LadderChart,{...props,layout:'combined',entries:vendorNames.map((vendor,i)=>({...entry('vendor-'+i,'CNY',i+1),vendor}))});
const markers=[...allVendors.matchAll(/<circle[^>]*fill="([^"]+)"[^>]*class="scatter-dot"[^>]*data-vendor="([^"]+)"/g)];
assert.equal(markers.length,20);
assert.equal(new Set(markers.map(m=>m[1])).size,10);
for(const vendor of vendorNames) assert.equal(markers.filter(m=>m[2]===vendor).length,2);
const selectedCard=render(LadderChart,{...props,focused:entries[0]});
assert.match(selectedCard,/scatter-selection-ring/);
const css=fs.readFileSync(path.resolve(__dirname,'../src/styles.css'),'utf8');
const paletteBlocks=[...css.matchAll(/:root \{ (--model-1:[^}]+)\}/g)].map(m=>m[1]);
const palettes=paletteBlocks.map(block=>[...block.matchAll(/--model-\d+:(#[a-f0-9]{6})/g)].map(c=>c[1]));
const outlines=paletteBlocks.map(block=>[...block.matchAll(/--model-\d+-border:(#[a-f0-9]{6})/g)].map(c=>c[1]));
assert.equal(palettes.length,2);
function luminance(hex){const values=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4));return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;}
for(let i=0;i<2;i++){assert.equal(palettes[i].length,10);assert.equal(outlines[i].length,10);for(const c of outlines[i]){const bg=luminance(i?'#2c2c2e':'#ffffff'),fg=luminance(c);assert.ok((Math.max(bg,fg)+0.05)/(Math.min(bg,fg)+0.05)>=3,c+' circle boundary contrast below 3:1');}}
console.log('PASS ten bright vendor colors on circular markers and matching legend; selected ring; light/dark boundary contrast >=3:1');

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
assert.match(picker,/openai\/gpt-5\.4 \(high\)/);assert.match(picker,/OpenAI/);assert.match(picker,/清除模型筛选/);assert.match(picker,/个会话/);assert.match(picker,/占当前范围/);assert.match(picker,/aria-haspopup="dialog"/);
const pendingPicker=render(ActivityModelPicker,{rows:[],value:'',onChange:()=>{},loading:true});assert.match(pendingPicker,/正在读取模型用量/);assert.ok(!pendingPicker.includes('0 Token'));
const absentPicker=render(ActivityModelPicker,{rows:modelRows,value:'missing-model',onChange:()=>{},loading:false});assert.match(absentPicker,/当前范围暂无记录/);
console.log('PASS model namespaces/effort IDs preserved, vendor search and unknown recovery, clear filter and scoped usage summary');

const {SettingsView}=load(path.resolve(__dirname,'../src/views/SettingsView.tsx'));
const settingsHtml=render(SettingsView,{settings:{autoRefresh:true,refreshIntervalMinutes:30,notifyLowBalance:true,closeToTray:true,defaultLowThreshold:5,notifyRecharge:true,trayAlert:true,ladderAutoUpdate:true},onUpdate:()=>{},info:null});
assert.match(settingsHtml,/>导出<\/button>/);assert.match(settingsHtml,/Token 采集频率/);assert.match(settingsHtml,/导出备份/);assert.ok(!settingsHtml.includes('飞书'));assert.ok(!settingsHtml.includes('导出数据</button>'));
assert.match(settingsHtml,/导入数据 \/ 迁移账户/);assert.match(settingsHtml,/未选内容保留/);assert.match(settingsHtml,/macOS/);
assert.match(settingsHtml,/跨设备同步/);assert.match(settingsHtml,/iCloud Drive/);assert.match(settingsHtml,/不含任何登录凭据/);
console.log('PASS unified backup export/import, configurable collection frequency, shared account privacy boundary and no Feishu sync entry');

const {priceText}=load(path.resolve(__dirname,'../src/lib/format.ts'));
assert.equal(priceText(0.0125,'CNY'),'¥0.0125');assert.equal(priceText(123.456,'USD'),'$123.456');assert.equal(priceText(0.000001,'USD'),'$0.000001');
console.log('PASS official price precision retained for small cache rates and large values');

function lab(hex){const rgb=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);const f=v=>v>.008856?Math.cbrt(v):7.787*v+16/116;const x=f((rgb[0]*.4124564+rgb[1]*.3575761+rgb[2]*.1804375)/.95047),y=f(rgb[0]*.2126729+rgb[1]*.7151522+rgb[2]*.072175),z=f((rgb[0]*.0193339+rgb[1]*.119192+rgb[2]*.9503041)/1.08883);return [116*y-16,500*(x-y),200*(y-z)];}
const labs=palettes[0].map(lab);let minimum=Infinity;for(let i=0;i<labs.length;i++)for(let j=i+1;j<labs.length;j++)minimum=Math.min(minimum,Math.hypot(...labs[i].map((v,k)=>v-labs[j][k])));assert.ok(minimum>=22,'vendor palette contains perceptually similar colors: '+minimum);console.log('PASS vendor palette minimum CIELAB separation '+minimum.toFixed(1));
