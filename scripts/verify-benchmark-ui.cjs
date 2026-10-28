// Browser QA uses the actual production components, synthetic personal data,
// and the board calculated by Rust's benchmark_checks example.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),out=path.join(root,'target/model-benchmarks-ui'),preview=path.join(root,'dist-mock');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4178/';
fs.mkdirSync(out,{recursive:true});fs.mkdirSync(preview,{recursive:true});
fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});
for(const name of ['ai-models.json','model_catalog.json','ladder.json'])fs.copyFileSync(path.join(root,'src-tauri/data',name),path.join(preview,name));
fs.copyFileSync(path.join(root,'target/benchmark-sources/board.json'),path.join(preview,'benchmark-board.json'));
fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8')+'</script>'));
async function overflow(page,selector){const box=await page.locator(selector).evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(box.scroll<=box.client+1,selector+' overflow '+JSON.stringify(box));}
async function main(){const browser=await chromium.launch({channel:'msedge',headless:true});const evidence=[];
try{
 for(const mode of ['light','dark']){
  const page=await browser.newPage({viewport:{width:1024,height:768},colorScheme:mode,reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.demoAppearance={theme:'codex',mode:'system',collapsed:false,revision:0};});await page.goto(base);await page.locator('.launch-screen').waitFor({state:'hidden'});
  assert.equal(await page.locator('html').getAttribute('data-color-theme'),'quota');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'AI 模型',exact:true}).click();
  await page.locator('.tier-model').first().waitFor();assert.ok(await page.locator('.tier-s .tier-model').count()>0);
  await overflow(page,'.content');await page.screenshot({path:path.join(out,mode+'-ladder.png')});
  await page.getByRole('textbox',{name:'搜索天梯模型'}).fill('GPT-6.1 Terra');assert.equal(await page.locator('.tier-model').count(),1);await page.getByRole('textbox',{name:'搜索天梯模型'}).fill('');
  await page.locator('.tier-model-main').first().click();let dialog=page.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/原始成绩/);await dialog.locator('.benchmark-evidence summary').first().click();assert.match(await dialog.innerText(),/公开配置/);await page.screenshot({path:path.join(out,mode+'-model-detail.png')});await dialog.getByRole('button',{name:'关闭',exact:true}).first().click();
  await page.getByRole('button',{name:'算法与来源',exact:true}).click();dialog=page.getByRole('dialog');await dialog.waitFor();assert.match(await dialog.innerText(),/各占 20%/);assert.match(await dialog.innerText(),/Anthropic 官方报告/);await dialog.getByRole('button',{name:'关闭',exact:true}).first().click();
  await page.locator('.benchmark-toolbar').getByRole('tab',{name:'能力对比',exact:true}).click();assert.equal(await page.locator('.capability-group').count(),6);await page.screenshot({path:path.join(out,mode+'-capabilities.png')});
  await page.locator('.benchmark-toolbar').getByRole('tab',{name:'效率曲线',exact:true}).click();await page.locator('.benchmark-point').first().waitFor();assert.ok(await page.locator('.benchmark-point').count()>3);await page.locator('.benchmark-point').first().focus();assert.match(await page.locator('.efficiency-readout').innerText(),/任务/);await overflow(page,'.content');await page.screenshot({path:path.join(out,mode+'-efficiency.png')});
  await page.locator('.benchmark-toolbar').getByRole('tab',{name:'官方价格',exact:true}).click();await page.locator('.registry-model').first().waitFor();await overflow(page,'.content');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'Token 活动',exact:true}).click();await page.locator('.activity-shares').waitFor();assert.equal(await page.locator('.activity-share svg').count(),3);for(const card of await page.locator('.activity-share').all()){const box=await card.evaluate(e=>({client:e.clientWidth,scroll:e.scrollWidth}));assert.ok(box.scroll<=box.client+1,'donut legend overflow');}await page.locator('.activity-shares').scrollIntoViewIfNeeded();await page.screenshot({path:path.join(out,mode+'-activity-shares.png')});
  await page.locator('.activity-share').nth(1).locator('.activity-share-legend button').first().click();await page.waitForFunction(()=>document.querySelector('.activity-model-picker')||document.querySelector('.activity-overview'));await overflow(page,'.content');
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();await page.locator('.theme-option').first().waitFor();assert.match(await page.locator('.theme-option[aria-pressed="true"]').innerText(),/Quota/);await page.screenshot({path:path.join(out,mode+'-settings.png')});
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await page.locator('.sidebar-collapsed').waitFor();await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
  await page.getByRole('group',{name:'配色方案'}).getByRole('button',{name:'GitHub',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-color-theme'),'github');await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.colorTheme==='github');assert.deepEqual(errors,[]);evidence.push({mode,viewport:[1024,768],passed:true});await page.close();
 }
 for(const test of ['upgrade','retry']){
  const page=await browser.newPage({viewport:{width:720,height:540},reducedMotion:'reduce'});await page.goto(base+'?window=setup&setupCase='+test);await page.locator('.setup-version').waitFor();await overflow(page,'.setup-app');await page.screenshot({path:path.join(out,'setup-'+test+'-welcome.png')});
  await page.getByRole('combobox',{name:'安装语言'}).selectOption('en');assert.match(await page.getByRole('heading',{level:1}).innerText(),/Setup Wizard/);await page.getByRole('combobox',{name:'安装语言'}).selectOption('zh');
  await page.getByRole('button',{name:'下一步 >',exact:true}).click();assert.equal(await page.getByRole('textbox',{name:'目标文件夹'}).getAttribute('readonly')!==null,test==='upgrade');await page.screenshot({path:path.join(out,'setup-'+test+'-location.png')});await page.getByRole('button',{name:'下一步 >',exact:true}).click();await page.screenshot({path:path.join(out,'setup-'+test+'-review.png')});await page.getByRole('button',{name:'安装',exact:true}).click();
  if(test==='retry'){await page.getByRole('button',{name:'重试',exact:true}).waitFor();assert.match(await page.locator('.notice').innerText(),/正在运行/);await page.getByRole('button',{name:'重试',exact:true}).click();}
  await page.getByRole('progressbar').waitFor();assert.equal(await page.getByRole('button',{name:'取消',exact:true}).isDisabled(),true);await page.screenshot({path:path.join(out,'setup-'+test+'-progress.png')});await page.getByRole('heading',{name:'安装完成',exact:true}).waitFor();await page.screenshot({path:path.join(out,'setup-'+test+'-finish.png')});await page.getByRole('button',{name:'完成',exact:true}).click();await page.waitForFunction(()=>window.demoSetupFinished===true);await page.close();evidence.push({setup:test,viewport:[720,540],passed:true});
 }
 for(const test of ['offline','empty']){const page=await browser.newPage({viewport:{width:1024,height:768}});await page.goto(base+'?benchmarkCase='+test);await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'AI 模型',exact:true}).click();await page.getByText(test==='offline'?'部分来源未能更新，已保留上次评测。':'没有匹配的模型',{exact:true}).waitFor();await page.close();}
 fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,evidence},null,2));console.log('PASS ladder, exact-model search, evidence, capabilities, cost/quality profiles, official directory, donuts, default Quota and sidebar; wizard options/progress/retry/finish; offline and empty states');
}finally{await browser.close();}}
main().catch(e=>{console.error(e);process.exitCode=1;});
