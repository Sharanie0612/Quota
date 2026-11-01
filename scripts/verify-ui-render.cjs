// Static rendering of production components; this is not a browser/layout check.
const path = require('path');
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const load = require('./lib/source-loader.cjs').createSourceLoader();
const render = (Component, props) => renderToStaticMarkup(React.createElement(Component, props));
const { LadderChart } = load(path.resolve(__dirname, '../src/components/LadderChart.tsx'));
const entry = (id, currency, input) => ({ id, name: id, provider: 'deepseek', vendor: 'DeepSeek', price: { currency, input, output: input, unit: '每百万 Token' }, rankings: { general: { rank: 1, score: 90 } }, verifiedAt: '2026-10-04' });
const entries = [entry('model-yuan', 'CNY', 1), entry('model-dollar', 'USD', 1), { ...entry('unknown', 'CNY', null), verifiedAt: null }];
const noExchange = render(LadderChart, {entries, domain:'general', focused:null, onFocus:()=>{}, exchange:null});
assert.match(noExchange,/按原币种分别绘图/);
assert.equal((noExchange.match(/role="group"/g)||[]).length,2); assert.match(noExchange,/能力排名 · 价格待确认/);
const props = { entries, domain: 'general', focused: null, onFocus: () => {}, exchange: { cnyPerUsd:7, date:"2026-10-02", error:null } };
const combined = render(LadderChart, props);
assert.equal((combined.match(/role="group"/g) || []).length, 1);
for (const html of [combined]) {
  assert.match(html, /CNY/); assert.match(html, /USD/); assert.match(html, /汇率仅供比较/);
  assert.equal((html.match(/role="button"/g) || []).length, 2);
  assert.ok(!/NaN|Infinity/.test(html));
}
assert.match(combined, /1 USD = 7.0000 CNY/);
assert.match(combined, /CNY统一价格与性能坐标图/);
const noRate = render(LadderChart,{...props,exchange:null});
assert.equal((noRate.match(/role="button"/g)||[]).length,2);
console.log('PASS one normalized price axis, original prices, FX-unavailable fallback and exclusion of unknown prices');
const onlyUsd=render(LadderChart,{...props,entries:[entry('usd-only','USD',1)],exchange:null});
assert.match(onlyUsd,/USD统一价格与性能坐标图/);
assert.equal((onlyUsd.match(/role="button"/g)||[]).length,1);
const unpriced=render(LadderChart,{...props,entries:[{...entry('unknown','CNY',null),verifiedAt:null}],onShowList:()=>{}});
assert.match(unpriced,/查看模型列表/);
console.log('PASS USD-only chart without exchange rate and actionable missing-price state');
const otherDomain={...entry('audio-only','USD',1),rankings:{audio:{rank:1,score:80}}};
const retained=render(LadderChart,{...props,entries:[...entries,otherDomain]});
assert.match(retained,/能力排名 · 价格待确认/);
assert.match(retained,/unknown/);
assert.ok(!retained.includes('audio-only'));

const { AccountCard } = load(path.resolve(__dirname, '../src/components/AccountCard.tsx'));
const balance = { total: 10, currency: 'CNY', source: 'api', usable: true, note: 'synthetic note', amounts: [{ kind: 'granted', label: '赠送余额', value: 0 }, { kind: 'cumulative_spend', label: '累计消费', value: 25 }] };
const account = { id: 'synthetic', provider: 'zhipu', providerName: 'GLM', label: 'Synthetic', balanceMode: 'auto', balanceSupported: false, low: false, needsApiKey: false, status: { balance, subscription: null, balanceError: 'synthetic failure', modelsError: null, models: [], lastChecked: null } };
const cardProps = { account, busy: false, onRefresh: () => {}, onEdit: () => {}, onUseManual: () => {}, onShowModels: () => {} };
const card = render(AccountCard, cardProps);
assert.ok(!card.includes("累计消费")); assert.match(card, /synthetic failure/); assert.match(card, /改用手动余额/);
assert.ok(!card.includes('class="balance-spend"')); assert.ok(!card.includes('<details open'));
assert.match(card, /0\.00/);
const partialPlan = render(AccountCard, { ...cardProps, account: { ...account, provider: 'mimo-plan', status: { ...account.status, balanceError: null, balance: { ...balance, currency: 'Credits', amounts: [] } } } });
assert.match(partialPlan, /已同步额度/); assert.ok(!partialPlan.includes('暂无订阅额度'));
console.log('PASS account details remain collapsed, zero displayed, unsupported-provider errors visible, partial subscription value retained');

// Model families use their own local logos, rather than parent-company graphics.
const modelNames=['GPT-6','Claude Opus','Gemini Flash','Gemma 4','Nano Banana 2','DeepSeek V4','Kimi K3','GLM-5','MiMo-V2','Qwen3','Grok 4','Muse Spark','Wan 3'];
const {ModelLogo,modelBrand}=load(path.resolve(__dirname,'../src/components/ModelLogo.tsx'));
for(const name of modelNames) assert.ok(render(ModelLogo,{name}).includes('data-model-brand="'+modelBrand(name)+'"'));
for(const [name,file] of [['Claude Opus','claude-color'],['Gemini Flash','gemini-color'],['Gemma 4','gemma-color'],['GLM-5','zai'],['MiMo-V2','xiaomimimo'],['Qwen3','qwen-color'],['Grok 4','grok']]) assert.ok(render(ModelLogo,{name}).includes(file+'.svg'));
assert.ok(render(ModelLogo,{name:'Muse Spark'}).includes('Muse 模型缩写'));
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
console.log('PASS sparse radar keeps missing axes unknown');

// Trae usage channels: models Trae provides and models reached with the user's own key stay separate.
const {activityModelName,activityModelChannel,activityChannelName,activityChannels,activityFilterLabel}=load(path.resolve(__dirname,'../src/lib/activityModels.ts'));
const channelKey=(name,channel)=>name+'\u001f'+channel;
assert.equal(activityModelName(channelKey('deepseek-v4-pro','api')),'deepseek-v4-pro');
assert.equal(activityModelChannel(channelKey('deepseek-v4-pro','api')),'api');
assert.equal(activityModelChannel('deepseek-v4-pro'),'');
assert.equal(activityChannelName('trae'),'Trae 提供');
assert.equal(activityChannelName('api'),'API 接入 Trae');
assert.equal(activityChannelName('unknown'),'未鉴别');
assert.equal(activityModelIdentity(channelKey('deepseek-v4-pro','api')).provider,'deepseek');
assert.equal(activityModelIdentity(channelKey('GLM-5.3','trae')).provider,'zhipu');
assert.deepEqual(activityChannels([{key:channelKey('a','api')},{key:'b'},{key:channelKey('c','trae')}]),['trae','api']);
assert.equal(activityFilterLabel('channel:api'),'API 接入 Trae');
assert.equal(activityFilterLabel(channelKey('glm-5.3','trae')),'glm-5.3 · Trae 提供');
const channelRows=[{key:channelKey('deepseek-v4-pro','api'),tokens:{input:100,cached:70,total:100},sessions:1,calls:0},{key:channelKey('glm-5.3','trae'),tokens:{input:100,cached:70,total:50},sessions:1,calls:0}];
assert.equal(activityModelChoices(channelRows,'API 接入').length,1);
assert.equal(activityModelChoices(channelRows,'Trae 提供').length,1);
const channelPicker=render(ActivityModelPicker,{rows:channelRows,value:'',onChange:()=>{},loading:false});
assert.match(channelPicker,/label="Trae 提供/);assert.match(channelPicker,/value="vendor:trae"/);assert.match(channelPicker,/channel:api/);
assert.ok(channelPicker.includes('deepseek-v4-pro · API 接入'));
assert.ok(channelPicker.includes('glm-5.3 · Trae 提供'));
assert.ok(!channelPicker.includes('label="DeepSeek"'));
assert.ok(!channelPicker.includes('label="智谱 GLM"'));
const mixedPicker=render(ActivityModelPicker,{rows:[...channelRows,{...channelRows[0],key:'deepseek-v4-pro'}],value:'',onChange:()=>{},loading:false});
assert.match(mixedPicker,/label="DeepSeek"/);assert.match(mixedPicker,/>deepseek-v4-pro<\/option>/);
assert.ok(mixedPicker.includes('deepseek-v4-pro · API 接入'));
const selectedChannelPicker=render(ActivityModelPicker,{rows:channelRows,value:channelKey('glm-5.3','trae'),onChange:()=>{},loading:false});
assert.ok(selectedChannelPicker.includes(`value="${channelKey('glm-5.3','trae')}" selected=""`));
const unknownPicker=render(ActivityModelPicker,{rows:[{...channelRows[0],key:channelKey('auto','unknown')}],value:'',onChange:()=>{},loading:false});
assert.match(unknownPicker,/vendor:trae/);assert.match(unknownPicker,/channel:unknown/);assert.ok(unknownPicker.includes('auto · 未鉴别'));
const {modelFamilies,modelFamily,releaseDates,releasedWithin}=load(path.resolve(__dirname,'../src/lib/ladderModels.ts'));
const variantEntries=[{...entry('gpt-high','USD',1),name:'GPT Example (High)',vendor:'OpenAI',releasedAt:'2026-10-02'},{...entry('gpt-low','USD',1),name:'GPT Example (Low)',vendor:'OpenAI'},{...entry('gemini','USD',1),name:'Gemini Example',vendor:'Google',releasedAt:'invalid'},{...entry('other','USD',1),name:'GPT Example (High)',vendor:'Other'}];
const families=modelFamilies(variantEntries);assert.equal(families.length,3);assert.equal(families[0].vendor,'Google');assert.equal(modelFamilies(variantEntries,'name')[0].name,'Gemini Example');
const dates=releaseDates(variantEntries);assert.equal(dates.get(modelFamily(variantEntries[1])),'2026-10-02');assert.ok(!dates.has(modelFamily(variantEntries[3])));
const today=new Date(2026,9,8,12);assert.ok(releasedWithin('2026-10-02',7,today));assert.ok(!releasedWithin('2026-10-01',7,today));assert.ok(!releasedWithin('2026-10-09',7,today));assert.ok(!releasedWithin(undefined,7,today));
assert.equal(families.find(g=>g.vendor==='OpenAI').variants.map(e=>e.id).join(','),'gpt-low,gpt-high');
console.log('PASS exact vendor/model grouping, reasoning variants, release-date inheritance and seven-calendar-day boundaries');

const {SettingsView}=load(path.resolve(__dirname,'../src/views/SettingsView.tsx'));
const settingsHtml=render(SettingsView,{settings:{autoRefresh:true,refreshIntervalMinutes:30,notifyLowBalance:true,closeToTray:true,defaultLowThreshold:5,notifyRecharge:true,trayAlert:true,ladderAutoUpdate:true},onUpdate:()=>{},info:null});
assert.match(settingsHtml,/>导出<\/button>/);assert.match(settingsHtml,/Token 采集频率/);assert.match(settingsHtml,/导出备份/);assert.ok(!settingsHtml.includes('飞书'));assert.ok(!settingsHtml.includes('导出数据</button>'));
assert.match(settingsHtml,/导入数据 \/ 迁移账户/);assert.match(settingsHtml,/未选内容保留/);assert.match(settingsHtml,/macOS/);
assert.match(settingsHtml,/跨设备同步/);assert.match(settingsHtml,/iCloud Drive/);assert.match(settingsHtml,/密钥和登录信息留在本机/);
console.log('PASS unified backup export/import, configurable collection frequency, shared account privacy boundary and no Feishu sync entry');

const {priceText}=load(path.resolve(__dirname,'../src/lib/format.ts'));
assert.equal(priceText(0.0125,'CNY'),'¥0.0125');assert.equal(priceText(123.456,'USD'),'$123.456');assert.equal(priceText(0.000001,'USD'),'$0.000001');
console.log('PASS official price precision retained for small cache rates and large values');
