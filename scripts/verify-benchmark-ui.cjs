// Built React/CSS with isolated AA API-shaped model, account and activity fixtures.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.QUOTA_UI_OUTPUT||path.join(root,'target/model-speed-ui'));fs.mkdirSync(out,{recursive:true});
const model=(id,name,creator,index,costPerTask)=>({id,name,creator,index,costPerTask,releaseDate:'2026-11-12'});
const snapshot={origin:'historical',indexVersion:'Intelligence Index v5',checkedAt:'2026-11-12T02:00:00Z',models:[
  model('tiny','Tiny','Lab A',5,0.00032),
  model('budget','Budget','Lab A',32,0.02),
  model('budget-alt','Budget Alt','Lab A',31.8,0.02002),
  model('mid','Mid','Lab B',49,0.2),
  model('peak','Peak','Lab B',58.125,5.0093),
  model('expensive','Expensive','Lab B',42,9.5),
  model('unpriced','Pending Cost','Lab B',51,null),
]};
require('./lib/preview.cjs').preparePreview(root,snapshot);
const port=Number(process.env.QUOTA_PREVIEW_PORT||4198),base=`http://127.0.0.1:${port}/`;
async function overflow(page){for(const selector of ['.main','.content'])assert(await page.locator(selector).evaluate(e=>e.scrollWidth<=e.clientWidth+1),selector+' overflow');}
async function plotted(page){return page.locator('.scatter-point').evaluateAll(elements=>elements.flatMap(e=>JSON.parse(e.dataset.members).map(p=>({...p,width:Number(e.ownerSVGElement.dataset.plotWidth),height:Number(e.ownerSVGElement.dataset.plotHeight)}))));}
async function ids(page){return [...(await plotted(page)).map(p=>p.id),...await page.locator('.ladder-score-row').evaluateAll(rows=>rows.map(e=>e.dataset.profileId))];}
async function main(){
 const server=spawn(process.execPath,[path.join(root,'scripts/preview-server.cjs'),String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});let browser;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('preview timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(chunk.toString().includes(String(port))){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>reject(Error(chunk.toString())));});
  browser=await chromium.launch({channel:'msedge',headless:true});const checks=[];
  for(const mode of ['light','dark'])for(const width of [1024,1360]){
   const page=await browser.newPage({viewport:{width,height:900},colorScheme:mode,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(base);
   const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
   await go('AI 模型');
   const chart=page.getByRole('region',{name:'Intelligence Index vs. Cost per Task'});
   const search=page.getByLabel('搜索模型或厂商');
   await chart.locator('.scatter-point').first().waitFor();
   const rows=await plotted(page);
   const expected=new Map(snapshot.models.filter(model=>model.costPerTask!==null).map(model=>[model.id,model]));
   assert.equal(rows.length,expected.size);
   assert.equal(new Set(rows.map(row=>row.id)).size,expected.size);
   for(const row of rows){
     assert.equal(row.score,expected.get(row.id).index);
     assert.equal(row.cost,expected.get(row.id).costPerTask);
     assert(Number.isFinite(row.x)&&Number.isFinite(row.y)&&row.x>=53&&row.x<=row.width-29&&row.y>=37&&row.y<=row.height-63);
   }
   const ordered=[...rows].sort((a,b)=>a.cost-b.cost);
   const ratio=(ordered[1].x-ordered[0].x)/Math.log(ordered[1].cost/ordered[0].cost);
   for(const point of ordered.slice(2))assert(Math.abs((point.x-ordered[0].x)/Math.log(point.cost/ordered[0].cost)-ratio)<1e-8);
   assert.deepEqual(JSON.parse(await chart.locator('.scatter-frontier').getAttribute('data-frontier-ids')),['tiny','budget','mid','peak']);
   const nodes=await chart.locator('.scatter-point').evaluateAll(elements=>elements.map(element=>[Number(element.dataset.plotX),Number(element.dataset.plotY)]));
   for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(nodes[i][0]-nodes[j][0],nodes[i][1]-nodes[j][1])>=27.9);
   assert.match(await chart.locator('svg[data-plot-width]').textContent(),/USD · 对数刻度/);
   assert.match(await chart.getByRole('status').textContent(),/历史快照 v5/);
   await chart.locator('.scatter-point').first().focus();
   await chart.getByRole('tooltip').waitFor();
   await chart.locator('.scatter-point').first().blur();
   await chart.getByRole('button',{name:'展开图表',exact:true}).click();
   await page.getByRole('dialog',{name:'放大的模型天梯'}).waitFor();
   assert.equal((await ids(page)).length,snapshot.models.length);
   await page.keyboard.press('Escape');
   await chart.locator('.scatter-point').first().waitFor();
   await page.getByLabel('模型厂商').selectOption('Lab B');
   await page.waitForFunction(()=>document.querySelector('.task-cost-footer [role="status"]')?.textContent.includes('3 个配置'));
   assert.deepEqual(new Set((await plotted(page)).map(point=>point.id)),new Set(['mid','peak','expensive']));
   await search.fill('Peak');
   await chart.getByRole('button',{name:/^Peak，/}).press('Enter');
   const detail=page.getByRole('dialog',{name:'Peak'});
   await detail.waitFor();
   assert.match(await detail.innerText(),/\$5\.0093/);
   assert.match(await detail.innerText(),/58\.1/);
   await page.keyboard.press('Escape');
   await search.fill('Pending Cost');
   await chart.getByText('当前筛选暂无可绘制的成本',{exact:true}).waitFor();
   assert.equal(await chart.locator('.scatter-point').count(),0);
   await chart.getByText('1 个有指数但暂无可比成本的配置',{exact:true}).click();
   await chart.getByRole('button',{name:/Pending Cost/}).click();
   assert.match(await page.getByRole('dialog',{name:'Pending Cost'}).innerText(),/暂无可比成本/);
   await page.keyboard.press('Escape');
   await search.fill('');
   await page.getByLabel('模型厂商').selectOption('');
   await overflow(page);
   await page.screenshot({path:path.join(out,`${mode}-${width}-task-cost.png`),animations:'disabled'});
   if(mode==='light'&&width===1024){
     const connected={...snapshot,origin:'api',indexVersion:'5.0',models:[...snapshot.models,model('added','Added','Lab A',53,0.45)]};
     await page.evaluate(value=>window.demoNextTaskCost=value,connected);
     await page.getByRole('button',{name:'连接数据源',exact:true}).click();
     const connection=page.getByRole('dialog',{name:'Artificial Analysis 数据源'});
     const key=connection.getByLabel('Artificial Analysis API Key');
     assert.equal(await key.getAttribute('type'),'password');
     await key.fill('invalid-fixture');
     await connection.getByRole('button',{name:'连接并更新'}).click();
     await connection.getByRole('alert').waitFor();
     await key.fill('local-fixture');
     await connection.getByRole('button',{name:'连接并更新'}).click();
     await connection.waitFor({state:'hidden'});
     await page.waitForFunction(()=>document.querySelector('.visual-model-page')?.dataset.taskCostOrigin==='api');
     assert((await ids(page)).includes('added'));
     const fresh={...connected,indexVersion:'5.1',models:[...connected.models,model('fresh','Fresh','New Lab',61,1.23)]};
     await page.evaluate(value=>window.demoPublishTaskCosts(value),fresh);
     await page.waitForFunction(()=>document.querySelector('.task-cost-footer [role="status"]')?.textContent.includes('API 指数 v5.1'));
     assert((await ids(page)).includes('fresh'));
     await page.evaluate(value=>window.demoPublishTaskCosts(value,'演示：Artificial Analysis 暂时无法连接'),fresh);
     await page.getByText(/正在显示上次有效数据/).waitFor();
     assert((await ids(page)).includes('fresh'));
     await page.evaluate(value=>window.demoNextTaskCost=value,{...fresh,indexVersion:'5.2'});
     await page.getByRole('button',{name:'立即更新',exact:true}).click();
     await page.waitForFunction(()=>document.querySelector('.task-cost-footer [role="status"]')?.textContent.includes('API 指数 v5.2'));
     assert.equal(await page.getByText(/正在显示上次有效数据/).count(),0);
     await page.getByRole('button',{name:'管理数据源',exact:true}).click();
     await connection.getByRole('button',{name:'断开连接',exact:true}).click();
     await page.getByRole('button',{name:'连接数据源',exact:true}).waitFor();
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
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'task-cost-and-synthetic-activity',checks},null,2));console.log('PASS exact USD/task and index, Pareto frontier, filters, data source connection, event-driven updates and offline retention at 1024/1360 light/dark; output-speed regression');
 }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
