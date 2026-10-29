// Production React/CSS with public benchmark fixtures and synthetic private data.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'target/model-speed-ui'),preview=path.join(root,'dist-mock');
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(preview,{recursive:true});
fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});
for(const name of ['ai-models.json','model_catalog.json','ladder.json'])fs.copyFileSync(path.join(root,'src-tauri/data',name),path.join(preview,name));
const board=JSON.parse(fs.readFileSync(path.join(root,'target/benchmark-sources/board.json'),'utf8'));
if(!board.releases?.length)board.releases=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/model-releases.json'),'utf8')).releases;
fs.writeFileSync(path.join(preview,'benchmark-board.json'),JSON.stringify(board));
fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8')+'</script>'));
const port=Number(process.env.QUOTA_PREVIEW_PORT||4198),base=`http://127.0.0.1:${port}/`;
async function overflow(page){assert(await page.locator('.main').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'main horizontal overflow');assert(await page.locator('.content').evaluate(e=>e.scrollWidth<=e.clientWidth+1),'content horizontal overflow');}
async function capture(page,name){await page.screenshot({path:path.join(out,name+'.png')});if(name.startsWith('light-1360-')){await page.setViewportSize({width:1360,height:1120});await page.waitForTimeout(120);await page.screenshot({path:path.join(out,name+'-full.png')});await page.setViewportSize({width:1360,height:900});await page.waitForTimeout(120);}}
async function main(){
 const server=spawn(process.execPath,[path.join(root,'scripts/preview-server.cjs'),String(port)],{cwd:root,windowsHide:true,stdio:['ignore','pipe','pipe']});
 let browser;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('preview startup timeout')),5000);server.once('error',reject);server.stdout.on('data',chunk=>{if(chunk.toString().includes(String(port))){clearTimeout(timer);resolve();}});server.stderr.on('data',chunk=>reject(Error(chunk.toString())));});
  browser=await chromium.launch({channel:'msedge',headless:true});const evidence=[];
  for(const mode of ['light','dark'])for(const width of [1024,1360]){
   const page=await browser.newPage({viewport:{width,height:900},colorScheme:mode,reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base);await page.locator('.launch-screen').waitFor({state:'hidden'});const nav=page.getByRole('navigation',{name:'主导航'});
   assert.equal(await nav.getByRole('button',{name:'模型库',exact:true}).count(),0);
   await nav.getByRole('button',{name:'AI 模型',exact:true}).click();await page.locator('.visual-model-page[data-evaluation-scope="main30"]').waitFor();
   await page.waitForFunction(()=>document.querySelector('.scatter-point,.ladder-score-row,.visual-model-pending'));
   assert.equal(await page.getByLabel('测评范围',{exact:true}).inputValue(),'main30');assert.equal(await page.getByLabel('图表币种',{exact:true}).count(),0);assert.equal(await page.locator('.tier-board').count(),0);
   await overflow(page);await capture(page,`${mode}-${width}-ladder`);
   assert.equal(await page.locator('.scatter-model-label').count(),0);
   const marker=page.locator('.scatter-point').first();await marker.focus();await page.getByRole('tooltip').waitFor();assert((await page.getByRole('tooltip').textContent()).length>10);await marker.blur();
   await page.getByRole('button',{name:'展开图表',exact:true}).click();const expanded=page.getByRole('dialog',{name:'放大的模型天梯'});await expanded.waitFor();assert(await expanded.locator('svg[role=group]').evaluate(e=>e.clientWidth>700&&e.clientHeight>400));await page.keyboard.press('Escape');await expanded.waitFor({state:'hidden'});
   const primaryIds=await page.locator('.scatter-point,.ladder-score-row').evaluateAll(points=>points.flatMap(e=>e.classList.contains('scatter-point')?e.dataset.profileIds.split('|'):[e.dataset.profileId]));
   assert.deepEqual(new Set(primaryIds),new Set(board.sources.find(s=>s.id==='artificial-analysis').edition.primaryProfiles),'current source cohort and vendor representatives');
   assert(primaryIds.some(id=>board.profiles.find(p=>p.id===id)?.name.startsWith('Claude Opus 5.5')),'current Opus must remain regardless of model release month');
   const recent=await page.locator('.scatter-point,.ladder-score-row').count();await page.getByLabel('测评范围',{exact:true}).selectOption('all');await page.locator('.visual-model-page[data-evaluation-scope="all"]').waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('.scatter-point,.ladder-score-row').length>0);const all=await page.locator('.scatter-point,.ladder-score-row').count();assert(all>=recent);
   const profiles=new Map(board.profiles.filter(p=>p.sourceId==='artificial-analysis').map(p=>[p.id,p]));
   const rows=await page.locator('.scatter-point').evaluateAll(points=>points.flatMap(e=>e.dataset.profileIds.split('|').map(id=>({id,score:Number(e.dataset.score),x:Number(e.dataset.plotX),y:Number(e.dataset.plotY),width:Number(e.ownerSVGElement.dataset.plotWidth),height:Number(e.ownerSVGElement.dataset.plotHeight)}))));
   const unpriced=await page.locator('.ladder-score-row').evaluateAll(points=>points.map(e=>({id:e.dataset.profileId,score:Number(e.dataset.score)})));
   assert.equal(new Set([...rows,...unpriced].map(r=>r.id)).size,profiles.size,'all public configurations retained, priced or unpriced');
   for(const row of [...rows,...unpriced])assert(Math.abs(row.score-profiles.get(row.id).index)<1e-9,'source-native configuration score');
   for(const row of rows)assert(row.x>=61&&row.x<=row.width-37&&row.y>=43&&row.y<=row.height-79,'finite, in-bounds scatter coordinates');
   await page.locator('.visual-model-toolbar button').filter({hasText:/^六维对比$/}).click();await page.locator('.visual-ability .ability-radar').waitFor();assert(await page.locator('.ability-radar circle').count()>0);assert(!await page.locator('.ability-radar').evaluate(e=>e.innerHTML.includes('NaN')));await overflow(page);await capture(page,`${mode}-${width}-radar`);
   await page.locator('.visual-compare-selected button').first().click();assert(!await page.getByLabel('添加六维对比模型').isDisabled());await page.getByLabel('六维对比厂商').selectOption('OpenAI');assert.equal(await page.locator('select[aria-label="添加六维对比模型"] optgroup').count(),1);assert.equal(await page.locator('select[aria-label="添加六维对比模型"] optgroup').getAttribute('label'),'OpenAI');
   await nav.getByRole('button',{name:'输出速度',exact:true}).click();await page.locator('.speed-plot > svg').waitFor();assert.equal(await page.locator('.speed-summary strong').count(),3);await overflow(page);await capture(page,`${mode}-${width}-speed`);
   await page.getByRole('tab',{name:'近30分钟',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.speed-plot > svg')?.dataset.bucketSeconds==='10');
   const countBefore=await page.locator('.speed-sample-value').textContent();await page.getByRole('group',{name:'均值时间粒度'}).getByRole('tab',{name:'1 分钟',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.speed-plot > svg')?.dataset.bucketSeconds==='60');assert.equal(await page.locator('.speed-sample-value').textContent(),countBefore,'changing mean grain preserves the sample set');
   await page.getByLabel('输出速度模型').selectOption('gpt-6.1-sol');await page.waitForFunction(()=>document.querySelectorAll('.speed-legend button').length===1);await page.locator('.speed-plot svg').focus();assert((await page.getByRole('tooltip').textContent()).includes('gpt-6.1-sol'));
   await page.getByRole('tab',{name:'记录',exact:true}).click();await page.locator('.speed-records tbody tr').first().waitFor();await overflow(page);await capture(page,`${mode}-${width}-speed-records`);
   await page.getByRole('tab',{name:'趋势',exact:true}).click();await page.getByRole('tab',{name:'7天',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.speed-plot > svg')?.dataset.bucketSeconds==='86400');
   await nav.getByRole('button',{name:'Token 活动',exact:true}).click();await page.locator('.activity-shares').waitFor();assert.equal(await page.locator('.activity-share').count(),3);assert.equal(await page.locator('.activity-share-legend,.activity-cache-details,#activity-details').count(),0);await overflow(page);await page.screenshot({path:path.join(out,`${mode}-${width}-shares.png`)});await page.locator('.activity-shares').screenshot({path:path.join(out,`${mode}-${width}-donuts.png`)});
   await nav.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.appearance-settings').waitFor();await overflow(page);await page.screenshot({path:path.join(out,`${mode}-${width}-appearance.png`)});
   await nav.getByRole('button',{name:'账户总览',exact:true}).click();await page.getByRole('button',{name:'添加账户',exact:true}).click();const form=page.getByRole('dialog');await form.waitFor();assert(await form.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'account form horizontal overflow');await form.getByRole('button',{name:'取消',exact:true}).click();
   assert.deepEqual(errors,[]);evidence.push({mode,width,plotted:rows.length,unpriced:unpriced.length,sourceConfigurations:profiles.size,passed:true});await page.close();
  }
  for(const [test,text] of [['empty','这个时段还没有输出记录'],['untimed','本时段的输出暂无可用计时'],['paused','采集已暂停'],['waiting','任务进行中，等待本次输出结束后计入速度']]){
   const page=await browser.newPage({viewport:{width:1024,height:768}});await page.goto(base+'?speedCase='+test);await page.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();if(test==='waiting')await page.locator('.speed-pending').waitFor();else await page.getByText(text,{exact:true}).waitFor();if(['empty','untimed'].includes(test))assert.equal(await page.locator('.speed-plot > svg').count(),0);await overflow(page);await page.screenshot({path:path.join(out,'speed-'+test+'.png')});await page.close();
  }
  // No event or manual refresh: the visible UI must accept new records through
  // its normal poll, including requests slower than the polling interval.
  const live=await browser.newPage({viewport:{width:1360,height:900}});await live.goto(base);await live.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();await live.locator('.speed-plot svg').waitFor();
  await live.evaluate(async()=>{window.demoSpeedReport=await window.__TAURI_INTERNALS__.invoke('get_output_speed',{days:1,bucketSeconds:3600,lookbackMinutes:0});const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(cmd,args)=>{if(cmd==='get_output_speed')await new Promise(resolve=>setTimeout(resolve,1300));return invoke(cmd,args);};});
  await live.locator('.speed-plot svg').focus();const tooltip=await live.getByRole('tooltip').textContent();await live.waitForTimeout(1700);assert.equal(await live.getByRole('tooltip').textContent(),tooltip,'refresh must preserve the inspected bin');
  const expected=await live.evaluate(()=>{const d=window.demoSpeedReport;d.live.activeRequests=1;return {average:d.summary.average,samples:d.summary.samples};});
  await live.locator('.speed-pending').waitFor();assert.equal(Number((await live.locator('.speed-sample-value').textContent()).replaceAll(',','')),expected.samples,'pending task cannot invent a speed sample');
  const start=Date.now();const next=await live.evaluate(()=>{const d=window.demoSpeedReport,at=Date.now();const row={id:'new-measured-output',model:'gpt-6.1-sol',device:'demo-a',startedAt:at-2000,completedAt:at,outputTokens:600,durationMs:2000,speed:300};d.recent.unshift(row);d.summary.outputTokens+=600;d.summary.durationMs+=2000;d.summary.average=d.summary.outputTokens*1000/d.summary.durationMs;d.summary.samples++;d.coverage.timedRecords++;d.coverage.outputRecords++;d.live.activeRequests=0;return d.summary.samples;});
  await live.waitForFunction(n=>Number(document.querySelector('.speed-sample-value')?.textContent.replaceAll(',',''))===n,next,{timeout:5000});assert(Date.now()-start<4100,'slow in-flight reads cannot starve updates');
  await live.getByRole('tab',{name:'记录',exact:true}).click();const cells=await live.locator('.speed-records tbody tr').first().locator('td').allTextContents();assert.equal(cells[2],'600');assert.equal(cells[3],'2 秒');assert.equal(cells[4],'300');evidence.push({kind:'auto-update-with-slow-read',renderLatencyMs:Date.now()-start,pendingDoesNotInventSpeed:true,cursorPreserved:true,recordReconciles:true,passed:true});await live.close();
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,fixture:'public source board; synthetic personal data and speed series',checks:evidence},null,2));console.log('PASS actual production components: complete-configuration prices/scores, current primary models and 30-day evaluation filter, radar, speed filter/empty state, simplified donuts and account form; 1024/1360 light/dark');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
