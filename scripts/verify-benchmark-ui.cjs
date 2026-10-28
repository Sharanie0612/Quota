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
async function capture(page,name){await page.screenshot({path:path.join(out,name+'.png')});if(name.startsWith('light-1360-')){await page.setViewportSize({width:1360,height:1120});await page.screenshot({path:path.join(out,name+'-full.png')});await page.setViewportSize({width:1360,height:900});}}
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
   await nav.getByRole('button',{name:'AI 模型',exact:true}).click();await page.locator('.visual-model-page[data-release-window="30"]').waitFor();
   await page.waitForFunction(()=>document.querySelector('.scatter-point,.ladder-score-row,.visual-model-pending'));
   assert.equal(await page.getByLabel('模型发布时间',{exact:true}).inputValue(),'30');assert.equal(await page.getByLabel('图表币种',{exact:true}).count(),0);assert.equal(await page.locator('.tier-board').count(),0);
   await overflow(page);await capture(page,`${mode}-${width}-ladder`);
   const recent=await page.locator('.scatter-point,.ladder-score-row').count();await page.getByLabel('模型发布时间',{exact:true}).selectOption('0');await page.locator('.visual-model-page[data-release-window="0"]').waitFor();
   await page.waitForFunction(()=>document.querySelectorAll('.scatter-point,.ladder-score-row').length>0);const all=await page.locator('.scatter-point,.ladder-score-row').count();assert(all>=recent);
   const profiles=new Map(board.profiles.filter(p=>p.sourceId==='artificial-analysis').map(p=>[p.id,p]));
   const rows=await page.locator('.scatter-point').evaluateAll(points=>points.flatMap(e=>e.dataset.profileIds.split('|').map(id=>({id,score:Number(e.dataset.score),x:Number(e.dataset.plotX),y:Number(e.dataset.plotY)}))));
   const unpriced=await page.locator('.ladder-score-row').evaluateAll(points=>points.map(e=>({id:e.dataset.profileId,score:Number(e.dataset.score)})));
   assert.equal(new Set([...rows,...unpriced].map(r=>r.id)).size,profiles.size,'all public configurations retained, priced or unpriced');
   for(const row of [...rows,...unpriced])assert(Math.abs(row.score-profiles.get(row.id).index)<1e-9,'source-native configuration score');
   for(const row of rows)assert(row.x>=61&&row.x<=843&&row.y>=43&&row.y<=501,'finite, in-bounds scatter coordinates');
   await page.locator('.visual-model-toolbar button').filter({hasText:/^六维对比$/}).click();await page.locator('.visual-ability .ability-radar').waitFor();assert(await page.locator('.ability-radar circle').count()>0);assert(!await page.locator('.ability-radar').evaluate(e=>e.innerHTML.includes('NaN')));await overflow(page);await capture(page,`${mode}-${width}-radar`);
   await page.locator('.visual-compare-selected button').first().click();assert(!await page.getByLabel('添加六维对比模型').isDisabled());
   await nav.getByRole('button',{name:'输出速度',exact:true}).click();await page.locator('.speed-chart > svg').waitFor();assert.equal(await page.locator('.speed-summary strong').count(),4);await overflow(page);await capture(page,`${mode}-${width}-speed`);
   await page.getByLabel('输出速度模型').selectOption('gpt-6.1-sol');await page.waitForFunction(()=>document.querySelectorAll('.speed-legend button').length===1);await page.locator('.speed-chart circle[role=button]').first().focus();assert((await page.locator('.speed-inspector').textContent()).includes('gpt-6.1-sol'));
   await nav.getByRole('button',{name:'Token 活动',exact:true}).click();await page.locator('.activity-shares').waitFor();assert.equal(await page.locator('.activity-share').count(),3);assert.equal(await page.locator('.activity-share-legend,.activity-cache-details,#activity-details').count(),0);await overflow(page);await page.screenshot({path:path.join(out,`${mode}-${width}-shares.png`)});await page.locator('.activity-shares').screenshot({path:path.join(out,`${mode}-${width}-donuts.png`)});
   await nav.getByRole('button',{name:'设置',exact:true}).click();await page.locator('.appearance-settings').waitFor();await overflow(page);await page.screenshot({path:path.join(out,`${mode}-${width}-appearance.png`)});
   await nav.getByRole('button',{name:'账户总览',exact:true}).click();await page.getByRole('button',{name:'添加账户',exact:true}).click();const form=page.getByRole('dialog');await form.waitFor();assert(await form.evaluate(e=>e.scrollWidth<=e.clientWidth+1),'account form horizontal overflow');await form.getByRole('button',{name:'取消',exact:true}).click();
   assert.deepEqual(errors,[]);evidence.push({mode,width,plotted:rows.length,unpriced:unpriced.length,sourceConfigurations:profiles.size,passed:true});await page.close();
  }
  const empty=await browser.newPage({viewport:{width:1024,height:768}});await empty.goto(base+'?speedCase=empty');await empty.getByRole('navigation').getByRole('button',{name:'输出速度',exact:true}).click();await empty.getByText('暂无输出速度记录',{exact:true}).waitFor();assert.equal(await empty.locator('.speed-chart > svg').count(),0);await empty.close();
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,fixture:'public source board; synthetic personal data and speed series',checks:evidence},null,2));console.log('PASS actual production components: complete-configuration prices/scores, 30-day filter, radar, speed filter/empty state, simplified donuts and account form; 1024/1360 light/dark');
 }finally{await browser?.close();server.kill();}
}
main().catch(e=>{console.error(e);process.exitCode=1});
