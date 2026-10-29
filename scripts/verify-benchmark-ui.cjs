// Built React/CSS against the public source board; synthetic accounts and calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.env.QUOTA_UI_OUTPUT||path.join(root,'target/model-speed-ui')),preview=path.join(root,'dist-mock');fs.mkdirSync(out,{recursive:true});
const board=JSON.parse(fs.readFileSync(process.env.QUOTA_BENCHMARK_BOARD||path.join(root,'target/benchmark-sources/board.json'),'utf8'));
if(!board.releases?.length)board.releases=JSON.parse(fs.readFileSync(path.join(root,'src-tauri/data/model-releases.json'),'utf8')).releases;
fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});for(const name of ['ai-models.json','model_catalog.json','ladder.json'])fs.copyFileSync(path.join(root,'src-tauri/data',name),path.join(preview,name));fs.writeFileSync(path.join(preview,'benchmark-board.json'),JSON.stringify(board));
fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8')+'</script>'));
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
   await go('AI 模型');await page.locator('.scatter-point').first().waitFor();assert.deepEqual(new Set(await ids(page)),new Set(board.sources.find(s=>s.id==='artificial-analysis').edition.primaryProfiles));
   await page.getByLabel('测评范围',{exact:true}).selectOption('all');await page.locator('.visual-model-page[data-evaluation-scope="all"]').waitFor();
   const rows=await plotted(page),unpriced=await page.locator('.ladder-score-row').evaluateAll(rows=>rows.map(e=>({id:e.dataset.profileId,score:Number(e.dataset.score)}))),profiles=new Map(board.profiles.filter(p=>p.sourceId==='artificial-analysis').map(p=>[p.id,p]));
   assert.equal(rows.length+unpriced.length,profiles.size);assert.equal(new Set([...rows,...unpriced].map(r=>r.id)).size,profiles.size);
   for(const row of [...rows,...unpriced])assert(Math.abs(row.score-profiles.get(row.id).index)<1e-9,'exact source configuration');
   for(const row of rows)assert(Number.isFinite(row.x)&&Number.isFinite(row.y)&&row.x>=53&&row.x<=row.width-29&&row.y>=37&&row.y<=row.height-63);
   const nodes=await page.locator('.scatter-point').evaluateAll(rows=>rows.map(e=>({x:Number(e.dataset.plotX),y:Number(e.dataset.plotY)})));for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)>=27.9);
   assert.match(await page.locator('.scatter-panel svg').textContent(),/对数刻度/);await page.locator('.scatter-point').first().focus();await page.getByRole('tooltip').waitFor();await page.locator('.scatter-point').first().blur();
   await page.getByRole('button',{name:'展开图表',exact:true}).click();await page.getByRole('dialog',{name:'放大的模型天梯'}).waitFor();assert.equal((await ids(page)).length,profiles.size);await page.keyboard.press('Escape');await overflow(page);await page.screenshot({path:path.join(out,`${mode}-${width}-ladder.png`),animations:'disabled'});
   await page.locator('.visual-model-toolbar button').filter({hasText:/^六维对比$/}).click();await page.locator('.ability-radar').waitFor();assert(!await page.locator('.ability-radar').evaluate(e=>e.innerHTML.includes('NaN')));await overflow(page);
   await go('输出速度');await page.waitForFunction(()=>Number(document.querySelector('.speed-plot')?.dataset.callCount)>0);assert.equal(await page.locator('.speed-plot path').count(),0);await page.getByLabel('输出速度模型').selectOption('gpt-6.1-sol');await page.waitForFunction(()=>document.querySelectorAll('.speed-legend button').length===1);
   await page.locator('.speed-plot svg').focus();await page.getByRole('tooltip').waitFor();assert.match(await page.getByRole('tooltip').textContent(),/gpt-6.1-sol/);await page.getByRole('tab',{name:'记录',exact:true}).click();assert(await page.locator('.speed-records tr').count()>1);await overflow(page);
   await go('设置');await page.locator('.appearance-settings').waitFor();await overflow(page);assert.deepEqual(errors,[]);checks.push({mode,width,configurations:profiles.size,plotted:rows.length,passed:true});await page.close();
  }
  for(const scenario of ['empty','untimed','paused','waiting']){const page=await browser.newPage({viewport:{width:1024,height:768}});await page.goto(base+'?speedCase='+scenario);await page.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();if(['empty','untimed'].includes(scenario)){await page.getByText('这个范围还没有速度记录',{exact:true}).waitFor();assert.equal(await page.locator('.speed-plot').count(),0);}else await page.locator('.speed-plot').waitFor();await overflow(page);await page.close();}
  const live=await browser.newPage();await live.goto(base);await live.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();await live.locator('.speed-plot').waitFor();
  await live.evaluate(async()=>{window.demoSpeedReport=await window.__TAURI_INTERNALS__.invoke('get_output_speed',{days:7});const original=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=async(name,args)=>{if(name==='get_output_speed')await new Promise(resolve=>setTimeout(resolve,1300));return original(name,args);};});
  await live.locator('.speed-plot svg').focus();const inspected=await live.getByRole('tooltip').textContent();
  const expected=await live.evaluate(()=>{const d=window.demoSpeedReport,at=Date.now(),call={id:'new-native-fixture-call',model:'gpt-6.1-sol',device:'demo-a',startedAt:at-2000,completedAt:at,outputTokens:600,durationMs:2000,speed:300};d.calls.unshift(call);d.recent.unshift(call);d.summary.samples++;d.summary.outputTokens+=600;d.summary.durationMs+=2000;d.summary.average=d.summary.outputTokens*1000/d.summary.durationMs;return d.calls.length;});
  await live.waitForFunction(expected=>Number(document.querySelector('.speed-plot')?.dataset.callCount)===expected,expected,{timeout:10000});assert.equal(await live.getByRole('tooltip').textContent(),inspected,'stable ID keeps inspected call across slow polling');await live.getByRole('tab',{name:'记录',exact:true}).click();const cells=await live.locator('.speed-records tbody tr').first().locator('td').allTextContents();assert.equal(cells[2],'600');assert.equal(cells[4],'300');await live.close();checks.push({kind:'new-call-slow-read',passed:true,cursorPreserved:true});
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'public-source-board-and-synthetic-personal-data',checks},null,2));console.log('PASS all source configurations and scores, nonoverlapping groups, logarithmic axes, radar, individual calls, empty/history states and slow automatic updates at 1024/1360 light/dark');
 }finally{await browser?.close();server.kill();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
