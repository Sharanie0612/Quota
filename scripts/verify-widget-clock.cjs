// Isolate the task clock from metadata polling with a stable synthetic response.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/widget-clock');
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const checks=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:324,height:276},locale:'zh-CN',reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.demoAppearance={theme:'quota',mode:'light',collapsed:false,glass:true,revision:Date.now()};localStorage.setItem('quota.appearance.v1',JSON.stringify(window.demoAppearance));});await page.goto((process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/')+'?window=usage-widget&widgetLiveCase=multiple');
  await page.locator('.widget-value strong').filter({hasNotText:'\u2014'}).waitFor();await page.mouse.move(-10,-10);await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  await page.evaluate(async()=>{
   const invoke=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);window.clockProbe={invoke,frozen:await invoke('get_widget_speed'),calls:[],mutations:0};
   window.__TAURI_INTERNALS__.invoke=(name,args)=>{if(name==='set_widget_expanded')window.clockProbe.calls.push(args.expanded);return name==='get_widget_speed'&&window.clockProbe.frozen?Promise.resolve(window.clockProbe.frozen):invoke(name,args);};
  });
  await page.waitForTimeout(1100);
  const observe=async()=>{
   await page.evaluate(()=>{window.clockProbe.mutations=0;window.clockProbe.observer=new MutationObserver(rows=>{window.clockProbe.mutations+=rows.filter(row=>row.type==='characterData'||row.type==='childList').length;});document.querySelectorAll('.task-row time').forEach(el=>window.clockProbe.observer.observe(el,{subtree:true,characterData:true,childList:true}));});
   await page.waitForTimeout(2200);return page.evaluate(()=>{window.clockProbe.observer.disconnect();return window.clockProbe.mutations;});
  };
  const rect=await page.locator('.usage-widget').boundingBox(),collapsedMutations=await observe();
  await page.locator('.widget-handle').hover();await page.locator('.is-expanded').waitFor();await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  const firstElapsed=await page.evaluate(()=>{const text=document.querySelector('.task-row time').textContent,numbers=text.match(/\d+/g).map(Number);return {actual:numbers.length===2?numbers[0]*60+numbers[1]:numbers[0],expected:Math.floor((Date.now()-window.clockProbe.frozen.tasks[0].startedAt)/1000)};});assert(Math.abs(firstElapsed.actual-firstElapsed.expected)<=1,'elapsed time refreshes on expansion');
  // Synthetic UI time only; this does not alter Token records or Windows time.
  await page.evaluate(()=>{const now=Date.now.bind(Date);Date.now=()=>now()+8500;});await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===0);checks.push('visible clock detects stale metadata; reopening shows current elapsed time');
  await page.evaluate(()=>{window.clockProbe.frozen=null;});await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  await page.evaluate(async()=>{window.clockProbe.frozen=await window.clockProbe.invoke('get_widget_speed');});await page.waitForTimeout(1100);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});const hiddenMutations=await observe();
  await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});await page.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);await page.locator('.widget-value').focus();await page.keyboard.press('Escape');await page.locator('.usage-widget:not(.native-expanded)').waitFor();
  assert.deepEqual(await page.locator('.usage-widget').boundingBox(),rect);assert.deepEqual(await page.evaluate(()=>window.clockProbe.calls),[true,false]);
  if(!process.env.QUOTA_WIDGET_CLOCK_AUDIT_ONLY){assert.equal(collapsedMutations,0,'collapsed task clock does no text work');assert.equal(hiddenMutations,0,'hidden task clock does no text work');}
  checks.push(collapsedMutations||hiddenMutations?'background clock work measured; visibility, Escape and fixed geometry recover':'collapsed and hidden task clocks stay quiet; visibility, Escape and fixed geometry recover');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:!collapsedMutations&&!hiddenMutations,kind:'built-renderer-stable-synthetic-metadata',checks,collapsedMutations,hiddenMutations,firstElapsed,rendererGeometry:rect},null,2));console.log(JSON.stringify({collapsedMutations,hiddenMutations,firstElapsed}));console.log(checks.map(c=>'CHECK '+c).join('\n'));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
