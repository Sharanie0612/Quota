// Built-renderer stress checks. Timings describe this browser run, not DWM FPS.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-transitions');
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const checks=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN',colorScheme:'light',reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{
   window.demoNativeGlass=true;window.demoAppearance=JSON.parse(localStorage.getItem('quota.appearance.v1')||'null');window.rafProbe={scheduled:0,fired:0,pending:new Set()};
   const request=window.requestAnimationFrame.bind(window),cancel=window.cancelAnimationFrame.bind(window);
   window.requestAnimationFrame=callback=>{window.rafProbe.scheduled++;const id=request(time=>{window.rafProbe.pending.delete(id);window.rafProbe.fired++;callback(time);});window.rafProbe.pending.add(id);return id;};
   window.cancelAnimationFrame=id=>{window.rafProbe.pending.delete(id);cancel(id);};
  });
  await page.goto(process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/');await page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:'\u8bbe\u7f6e',exact:true}).click();await page.locator('.launch-screen').waitFor({state:'detached'});
  await page.evaluate(()=>{
   window.materialProbe={calls:0,returned:0};const invoke=window.__TAURI_INTERNALS__.invoke.bind(window.__TAURI_INTERNALS__);
   window.__TAURI_INTERNALS__.invoke=(command,args)=>{
    const result=invoke(command,args);if(command!=='sync_main_material')return result;
    const call=++window.materialProbe.calls;
    // Resolve old requests after newer ones, preserving their original result.
    return Promise.resolve(result).then(value=>new Promise(resolve=>setTimeout(()=>{window.materialProbe.returned++;resolve(value);},call%3===0?180:call%3===1?80:0)));
   };
  });
  const toggle=page.getByRole('button',{name:'\u6db2\u6001\u73bb\u7483',exact:true});await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  const switches=await page.evaluate(async()=>{
   const settings=document.querySelector('.appearance-settings'),themes=[...settings.querySelectorAll('.theme-option')],modes=[...settings.querySelectorAll('[role="tab"]')],glass=settings.querySelector('[aria-label="\u6db2\u6001\u73bb\u7483"]');
   const start=performance.now();for(let i=0;i<30;i++){themes[i%themes.length].click();modes[i%modes.length].click();if(i%2===0)glass.click();await new Promise(resolve=>setTimeout(resolve,0));}
   themes.find(button=>button.querySelector('b')?.textContent.startsWith('Quota')).click();modes[0].click();if(glass.getAttribute('aria-pressed')!=='true')glass.click();
   return {rounds:30,dispatchMs:performance.now()-start};
  });
  await page.waitForFunction(()=>window.materialProbe.returned===window.materialProbe.calls);await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  assert.deepEqual(await page.evaluate(()=>({theme:document.documentElement.dataset.colorTheme,mode:document.documentElement.dataset.colorMode,glass:document.documentElement.dataset.glass,stored:window.demoAppearance.theme})),{theme:'quota',mode:'light',glass:'on',stored:'quota'});
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.colorMode==='dark'&&document.documentElement.dataset.nativeGlass==='on');await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.colorMode==='light');
  await toggle.click();await page.waitForFunction(()=>window.materialProbe.returned===window.materialProbe.calls);assert.equal(await page.locator('html').getAttribute('data-native-glass'),'off');assert.notEqual(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='off');await page.waitForFunction(()=>window.materialProbe.returned===window.materialProbe.calls);assert.equal(await page.locator('html').getAttribute('data-native-glass'),'off');await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  checks.push('30 interrupted theme/mode/glass rounds retain the final choice despite out-of-order material replies; system mode and forced colors recover');
  const toolbar=page.locator('.workspace-toolbar'),rect=await toolbar.boundingBox();await page.mouse.move(rect.x+50,rect.y+rect.height+70);await page.waitForTimeout(400);
  const cdp=await page.context().newCDPSession(page);await cdp.send('Performance.enable');const beforeMetrics=await cdp.send('Performance.getMetrics');
  const burst=await page.evaluate(async()=>{
   const toolbar=document.querySelector('.workspace-toolbar'),r=toolbar.getBoundingClientRect(),before=window.rafProbe.scheduled;
   for(let i=0;i<500;i++)toolbar.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerType:'mouse',clientX:r.left+20+i%(r.width-40),clientY:r.top+20}));
   await new Promise(resolve=>setTimeout(resolve,100));return {events:500,frames:window.rafProbe.scheduled-before,pending:window.rafProbe.pending.size};
  });const afterMetrics=await cdp.send('Performance.getMetrics');assert(burst.frames<=4&&burst.pending===0,'pointer bursts coalesce into bounded work');
  await page.mouse.move(rect.x+50,rect.y+20);await page.mouse.move(rect.x+50,rect.y+rect.height+70);await page.waitForTimeout(350);
  const startIdle=await page.evaluate(()=>({scheduled:window.rafProbe.scheduled,pending:window.rafProbe.pending.size}));await page.waitForTimeout(1100);const endIdle=await page.evaluate(()=>({scheduled:window.rafProbe.scheduled,pending:window.rafProbe.pending.size}));assert.equal(endIdle.pending,0);assert.equal(endIdle.scheduled,startIdle.scheduled,'no application RAF loop while idle');
  checks.push('500 pointer events coalesce into bounded frame work; the settled glass schedules no idle animation frames');
  await page.evaluate(async()=>{for(let i=0;i<20;i++){document.querySelector('.sidebar-toggle').click();await new Promise(resolve=>setTimeout(resolve,0));}});await page.waitForTimeout(450);assert(await page.locator('.main').evaluate(e=>e.scrollWidth<=e.clientWidth+1));await page.reload();await page.locator('.launch-screen').waitFor({state:'detached'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');assert.equal(await page.locator('html').getAttribute('data-color-theme'),'quota');checks.push('repeated sidebar interruption keeps the layout bounded and the final appearance survives reload');
  const delta={};for(const name of ['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration'])delta[name]=(afterMetrics.metrics.find(m=>m.name===name)?.value||0)-(beforeMetrics.metrics.find(m=>m.name===name)?.value||0);
  assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'built-renderer-synthetic-native-delayed-replies',checks,switches,burst,idle:{start:startIdle,end:endIdle},pointerBurstSeconds:delta},null,2));console.log(checks.map(c=>'PASS '+c).join('\n'));console.log(JSON.stringify({switches,burst,idleFrames:endIdle.scheduled-startIdle.scheduled,pointerBurstSeconds:delta}));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
