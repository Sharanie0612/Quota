// Built React/CSS with isolated AA API-shaped model, account and activity fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.QUOTA_UI_OUTPUT||path.join(root,'target/model-speed-ui'));fs.mkdirSync(out,{recursive:true});
const model=(id,name,creator,index,costPerTask,releaseDate,modelName=name)=>({id,name,modelName,creator,index,costPerTask,releaseDate});
const snapshot={origin:'historical',indexVersion:'Intelligence Index v5',checkedAt:'2026-11-12T02:00:00Z',models:[
  model('tiny','Tiny','Lab A',5,0.00032,'2026-11-12'),
  model('budget','Budget (Max)','Lab A',32,0.02,'2026-11-12','Budget'),
  model('budget-alt','Budget (Low)','Lab A',31.8,0.02002,'2026-11-12','Budget'),
  model('near','Nearly identical','Lab A',31.99,0.02001,'2026-11-12'),
  model('mid','Mid','Lab B',49,0.2,'2026-11-12'),
  model('peak','Peak','Lab B',58.125,5.0093,'2026-11-12'),
  model('expensive','Expensive','Lab B',42,9.5,'2026-11-12'),
  model('unpriced','Pending Cost','Lab B',51,null,'2026-11-12'),
  ...Array.from({length:22},(_,i)=>model('mid-'+i,'Model '+i,i%2?'Lab A':'Lab B',33+i/3,0.1+i/45,'2026-11-11')),
  model('boundary','Boundary Release','Lab C',18,0.062,'2026-11-10'),
  model('older','Older Release','Lab C',37,0.095,'2026-10-02'),
  model('unknown','Unknown Date','Lab C',52,0.65,null),
]};
require('./lib/preview.cjs').preparePreview(root,snapshot);
const port=Number(process.env.QUOTA_PREVIEW_PORT||4198),base=`http://127.0.0.1:${port}/`;
async function overflow(page){for(const selector of ['.main','.content'])assert(await page.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+1),selector+' overflow');}
async function plotted(page){
 return page.locator('.task-plot-point').evaluateAll(elements=>elements.map(e=>({
  id:e.dataset.id,score:Number(e.dataset.score),cost:Number(e.dataset.cost),
  x:Number(e.dataset.plotX),y:Number(e.dataset.plotY),
  width:Number(e.ownerSVGElement.dataset.plotWidth),height:Number(e.ownerSVGElement.dataset.plotHeight)
 })));
}
async function changeView(page,name){
 await page.getByRole('button',{name:'图表显示设置',exact:true}).click();
 await page.getByRole('dialog',{name:'图表显示设置',exact:true}).getByRole('button',{name,exact:true}).click();
}
async function ids(page){
 const wasChart=await page.locator('.task-models-list').count()===0;
 if(wasChart) await changeView(page,'列表');
 const values=await page.locator('.task-models-list tbody tr').evaluateAll(rows=>rows.map(e=>e.dataset.profileId));
 if(wasChart) await changeView(page,'图表');
 return values;
}
async function selectionCount(page,count){
 await page.waitForFunction(n=>Number(document.querySelector('.task-comparison-status [role="status"]')?.dataset.selected)===n,count);
}
async function expectPicker(page,chart,name,id,total){
 const picker=page.getByRole('dialog',{name:'选择对比模型'});
 await chart.getByRole('button',{name:'选择模型',exact:true}).click();
 await picker.getByLabel('搜索模型或厂商').fill(name);
 await picker.getByRole('checkbox',{name:'加入 '+name,exact:true}).check();
 await picker.getByRole('button',{name:'完成',exact:true}).click();
 await selectionCount(page,total);
 assert((await ids(page)).includes(id));
}
async function main(){
 const server=spawn(process.execPath,[path.join(root,'scripts/preview-server.cjs'),String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('preview timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(chunk.toString().includes(String(port))){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>reject(Error(chunk.toString())));});
  browser=await chromium.launch({channel:'msedge',headless:true});const checks=[];
  for(const mode of ['light','dark'])for(const width of [1024,1360]){
   const page=await browser.newPage({viewport:{width,height:900},colorScheme:mode,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
   const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
   await go('AI 模型');
   const chart=page.getByRole('region',{name:'Intelligence Index vs. Cost per Task',exact:true});
   await chart.locator('.task-scatter[data-measured="true"] .task-plot-point').first().waitFor();
   await selectionCount(page,30);
   const rows=await plotted(page);
   const skipped=new Set(['budget-alt','older','unknown']);
   const selected=snapshot.models.filter(model=>!skipped.has(model.id));
   const expected=new Map(selected.filter(model=>model.costPerTask!==null).map(model=>[model.id,model]));
   assert.deepEqual(new Set(await ids(page)),new Set(selected.map(model=>model.id)));
   assert.equal(rows.length,expected.size);
   assert.equal(new Set(rows.map(row=>row.id)).size,expected.size);
   assert.equal(await page.locator('.scatter-badge').count(),0);
   for(const row of rows){
     assert.equal(row.score,expected.get(row.id).index);
     assert.equal(row.cost,expected.get(row.id).costPerTask);
     assert(Number.isFinite(row.x)&&Number.isFinite(row.y)&&row.x>=60&&row.x<=row.width-15&&row.y>=15&&row.y<=row.height-51);
   }
   const ordered=[...rows].sort((a,b)=>a.cost-b.cost);
   const ratio=(ordered[1].x-ordered[0].x)/Math.log(ordered[1].cost/ordered[0].cost);
   for(const point of ordered.slice(2))assert(Math.abs((point.x-ordered[0].x)/Math.log(point.cost/ordered[0].cost)-ratio)<1e-7);
   assert(Math.hypot(rows.find(p=>p.id==='budget').x-rows.find(p=>p.id==='near').x,rows.find(p=>p.id==='budget').y-rows.find(p=>p.id==='near').y)<2);
   assert.equal(await chart.locator('.task-attractive-area,.task-expensive-area,.task-frontier-line').count(),3);
   assert.equal(await chart.locator('.task-creator-legend button').count(),new Set([...expected.values()].map(value=>value.creator)).size);
   assert.match(await chart.locator('svg[data-plot-width]').textContent(),/Cost per Task \(USD, Log Scale\)/);
   assert.doesNotMatch(await chart.locator('svg[data-plot-width]').textContent(),/[↑→┄]/);
   assert.match(await page.locator('.task-source-status').textContent(),/历史快照/);
   const labels=await chart.locator('.task-point-label').evaluateAll(nodes=>nodes.map(node=>{const box=node.getBoundingClientRect();return [box.left,box.top,box.right,box.bottom];}));
   assert(labels.length>=6 && labels.length<=rows.length);
   for(let i=0;i<labels.length;i++)for(let j=0;j<i;j++) {
     const [left,top,right,bottom]=labels[i], [otherLeft,otherTop,otherRight,otherBottom]=labels[j];
     assert(!(left<otherRight-1&&right>otherLeft+1&&top<otherBottom-1&&bottom>otherTop+1),'visible labels remain readable');
   }
   const peak=chart.getByRole('button',{name:/^Peak，/});
   await peak.focus();
   await chart.getByRole('tooltip').waitFor();
   assert.match(await chart.getByRole('tooltip').innerText(),/5\.0093/);
   await peak.press('ArrowRight');
   assert(!(await peak.evaluate(el=>document.activeElement===el)),'keyboard cycles individually through plotted models');
   await peak.press('Enter');
   const detail=page.getByRole('dialog',{name:'Peak'});
   await detail.waitFor();
   assert.match(await detail.innerText(),/\$5\.0093/);
   assert.match(await detail.innerText(),/58\.1/);
   await page.keyboard.press('Escape');
   await detail.waitFor({state:'hidden'});
   await changeView(page,'放大图表');
   const full=page.getByRole('dialog',{name:'模型图表',exact:true});
   await full.waitFor();
   await full.locator('.task-scatter[data-measured="true"]').waitFor();
   assert.equal(await full.locator('.task-plot-point').count(),rows.length);
   assert(Number(await full.locator('svg[data-plot-width]').getAttribute('data-plot-width'))>rows[0].width);
   await page.keyboard.press('Escape');
   await chart.locator('.task-plot-point').first().waitFor();
   await changeView(page,'列表');
   await page.getByRole('button',{name:'Budget',exact:true}).click();
   const budget=page.getByRole('dialog',{name:/Budget/});
   const variants=budget.getByLabel('评测档位');
   await variants.selectOption('budget-alt');
   await budget.getByRole('button',{name:'关闭',exact:true}).last().click();
   assert((await ids(page)).includes('budget-alt'));
   await changeView(page,'图表');
   assert.equal((await plotted(page)).find(row=>row.id==='budget-alt').cost,0.02002);
   assert(!(await ids(page)).includes('budget'));
   await changeView(page,'列表');
   await page.getByRole('button',{name:'Budget',exact:true}).click();
   await variants.selectOption('budget');
   await page.keyboard.press('Escape');
   await changeView(page,'图表');
   await expectPicker(page,chart,'Older Release','older',31);
   assert((await ids(page)).includes('older'));
   await go('设置');
   await go('AI 模型');
   await selectionCount(page,31);
   assert((await ids(page)).includes('older'));
   const chooser=page.getByRole('dialog',{name:'选择对比模型'});
   await chart.getByRole('button',{name:'选择模型',exact:true}).click();
   await chooser.getByLabel('模型厂商',{exact:true}).selectOption('Lab B');
   assert.equal(await chooser.getByRole('checkbox',{name:'移除 Older Release',exact:true}).count(),0);
   await chooser.getByLabel('仅显示已选').check();
   assert.equal(await chooser.locator('.model-picker-row input:not(:checked)').count(),0);
   await chooser.getByRole('checkbox',{name:'移除 Pending Cost',exact:true}).click();
   await chooser.getByRole('button',{name:'完成',exact:true}).click();
   await selectionCount(page,30);
   assert(!(await ids(page)).includes('unpriced'));
   await chart.getByRole('button',{name:'选择模型',exact:true}).click();
   await chooser.getByRole('button',{name:'恢复最新 30 个',exact:true}).click();
   await chooser.getByRole('button',{name:'完成',exact:true}).click();
   assert.deepEqual(new Set(await ids(page)),new Set(selected.map(model=>model.id)));
   await overflow(page);
   await page.screenshot({path:path.join(out,`${mode}-${width}-task-cost.png`),animations:'disabled'});
   if(mode==='light'&&width===1024){
     const svgDownload=page.waitForEvent('download');
     await chart.getByRole('button',{name:'下载图表',exact:true}).click();
     const download=await svgDownload;
     assert.equal(download.suggestedFilename(),'Quota-AA-Intelligence-vs-Cost.svg');
     const svg=fs.readFileSync(await download.path(),'utf8');
     const svgSummary=await page.evaluate(source=>{
       const doc=new DOMParser().parseFromString(source,'image/svg+xml');
       return {root:doc.documentElement.localName,points:doc.querySelectorAll('.task-point-mark').length};
     },svg);
     assert.deepEqual(svgSummary,{root:'svg',points:rows.length});
     await chart.getByRole('button',{name:'下载数据',exact:true}).click();
     await page.waitForFunction(()=>!!window.demoExport);
     const csv=await page.evaluate(()=>window.demoExport.contents);
     assert(csv.includes('Intelligence Index')&&csv.includes('5.0093'));
     assert.equal(csv.trim().split('\r\n').length,31);
     await expectPicker(page,chart,'Older Release','older',31);
     const connected={...snapshot,origin:'api',indexVersion:'5.0',checkedAt:'2026-11-13T11:02:00Z',models:[...snapshot.models,model('added','Added','Lab A',53,0.45,'2026-11-13')]};
     await page.evaluate(value=>window.demoNextTaskCost=value,connected);
     await page.getByRole('button',{name:'连接 AA',exact:true}).click();
     const connection=page.getByRole('dialog',{name:'Artificial Analysis'});
     const key=connection.getByLabel('API Key',{exact:true});
     assert.equal(await key.getAttribute('type'),'password');
     await key.fill('invalid-fixture');
     await connection.getByRole('button',{name:'连接并更新'}).click();
     await connection.getByRole('alert').waitFor();
     await key.fill('local-fixture');
     await connection.getByRole('button',{name:'连接并更新'}).click();
     await connection.waitFor({state:'hidden'});
     await page.waitForFunction(()=>document.querySelector('.visual-model-page')?.dataset.taskCostOrigin==='api');
     assert((await ids(page)).includes('added'));
     assert(!(await ids(page)).includes('boundary'));
     assert((await ids(page)).includes('older'));
     await page.waitForFunction(()=>window.demoTaskCostChecks>=1);
     const fresh={...connected,indexVersion:'5.1',checkedAt:'2026-11-14T11:05:00Z',models:[...connected.models,model('fresh','Fresh','New Lab',61,1.23,'2026-11-14')]};
     await page.evaluate(value=>{ window.demoDueTaskCost=value; window.dispatchEvent(new Event('focus')); },fresh);
     await page.locator(`[data-checked-at="${fresh.checkedAt}"]`).waitFor();
     assert((await ids(page)).includes('fresh'));
     assert((await ids(page)).includes('older'));
     await page.evaluate(value=>window.demoPublishTaskCosts(value,'演示：Artificial Analysis 暂时无法连接'),fresh);
     await page.getByText(/已保留上次数据/).waitFor();
     assert((await ids(page)).includes('fresh'));
     const manual={...fresh,indexVersion:'5.2',checkedAt:'2026-11-14T11:15:00Z'};
     await page.evaluate(value=>window.demoNextTaskCost=value,manual);
     await page.getByRole('button',{name:'立即更新',exact:true}).click();
     await page.locator(`[data-checked-at="${manual.checkedAt}"]`).waitFor();
     assert.equal(await page.getByText(/已保留上次数据/).count(),0);
     await go('设置');
     const auto=page.getByRole('button',{name:'模型资料自动更新',exact:true});
     await auto.click();
     await page.waitForFunction(()=>document.querySelector('[aria-label="模型资料自动更新"]')?.getAttribute('aria-pressed')==='false');
     const checksBeforeFocus=await page.evaluate(()=>window.demoTaskCostChecks);
     await go('AI 模型');
     await page.getByRole('button',{name:'立即更新',exact:true}).waitFor();
     await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
     assert.equal(await page.evaluate(()=>window.demoTaskCostChecks),checksBeforeFocus);
     await page.getByRole('button',{name:'数据源',exact:true}).click();
     await connection.getByRole('button',{name:'断开连接',exact:true}).click();
     await page.getByRole('button',{name:'连接 AA',exact:true}).waitFor();
     assert((await ids(page)).includes('fresh'));
   }
   await go('输出速度');await page.waitForFunction(()=>Number(document.querySelector('.speed-plot')?.dataset.callCount)>0);assert.equal(await page.locator('.speed-plot path').count(),0);await page.getByLabel('输出速度模型').selectOption('gpt-6.1-sol');await page.waitForFunction(()=>document.querySelectorAll('.speed-legend button').length===1);
   await page.locator('.speed-plot svg').focus();await page.keyboard.press('ArrowLeft');await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').textContent(),/gpt-6.1-sol/);await page.getByRole('tab',{name:'记录',exact:true}).click();assert(await page.locator('.speed-records tr').count()>1);await overflow(page);
   await go('设置');await page.locator('.appearance-settings').waitFor();await overflow(page);assert.deepEqual(errors,[]);checks.push({mode,width,configurations:snapshot.models.length,plotted:rows.length,passed:true});await page.close();
  }
  for(const scenario of ['empty','untimed','paused','waiting']){const page=await browser.newPage({viewport:{width:1024,height:768}});await page.goto(base+'?speedCase='+scenario);await page.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();if(['empty','untimed'].includes(scenario)){await page.getByText('这个范围还没有速度记录',{exact:true}).waitFor();assert.equal(await page.locator('.speed-plot').count(),0);}else await page.locator('.speed-plot').waitFor();await overflow(page);await page.close();}
  const live=await browser.newPage();await live.goto(base);await live.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();await live.locator('.speed-plot').waitFor();
  await live.evaluate(async()=>{window.demoSpeedReport=await window.__TAURI_INTERNALS__.invoke('get_output_speed',{days:7});window.demoFrozenReads=0;const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(name,args)=>{if(name==='get_output_speed')await new Promise(resolve=>setTimeout(resolve,1300));const value=await original(name,args);if(name==='get_output_speed')window.demoFrozenReads++;return value;};});
  await live.getByRole('button',{name:'重新读取输出记录',exact:true}).click();await live.waitForFunction(()=>window.demoFrozenReads>0);await live.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await live.locator('.speed-plot svg').focus();await live.keyboard.press('ArrowLeft');const inspected=await live.getByRole('tooltip').textContent();
  const expected=await live.evaluate(()=>{const d=window.demoSpeedReport,at=Date.now(),call={id:'new-native-fixture-call',model:'gpt-6.1-sol',device:'demo-a',startedAt:at-2000,completedAt:at,outputTokens:600,durationMs:2000,speed:300};d.calls.unshift(call);d.recent.unshift(call);d.summary.samples++;d.summary.outputTokens+=600;d.summary.durationMs+=2000;d.summary.average=d.summary.outputTokens*1000/d.summary.durationMs;return d.calls.length;});
  await live.waitForFunction(expected=>Number(document.querySelector('.speed-plot')?.dataset.callCount)===expected,expected,{timeout:10000});assert.equal(await live.getByRole('tooltip').textContent(),inspected,'stable ID keeps inspected call across slow polling');await live.getByRole('tab',{name:'记录',exact:true}).click();const cells=await live.locator('.speed-records tbody tr').first().locator('td').allTextContents();assert.equal(cells[2],'600');assert.equal(cells[4],'300');await live.close();checks.push({kind:'new-call-slow-read',passed:true,cursorPreserved:true});
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'task-cost-and-synthetic-activity',checks},null,2));console.log('PASS 30 latest model releases, exact independent points, labels, effort switching, manual selection and persistence, refreshed defaults, offline retention and speed at 1024/1360 light/dark');
 }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
