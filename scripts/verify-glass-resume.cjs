// Built-renderer lifecycle events and media changes with synthetic capability.
// These are browser events, not desktop focus/minimize or DWM verification.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-resume');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),cases=[],negative=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.demoNativeGlass=true;});await page.goto(process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/');
  const settings=()=>page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();
  await settings();await page.getByRole('button',{name:'液态玻璃',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');await page.locator('.launch-screen').waitFor({state:'detached'});
  const toolbar=page.locator('.workspace-toolbar'),button=toolbar.locator('button').first();
  const state=()=>button.evaluate(e=>{const host=e.closest('.workspace-toolbar'),a=e.getBoundingClientRect(),b=host.getBoundingClientRect();return{focused:document.activeElement===e,keyboard:e.matches(':focus-visible'),x:host.style.getPropertyValue('--glass-x'),glow:host.style.getPropertyValue('--glass-glow'),opacity:Number(getComputedStyle(host,'::after').opacity),expectedX:a.left+a.width/2-b.left};});
  const keyboardFocus=async()=>{await page.getByRole('navigation').getByRole('button').first().focus();await page.keyboard.press('Tab');await button.focus();await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');await page.waitForTimeout(230);};
  for(const mode of ['浅色','深色']){
   await settings();await page.locator('.appearance-settings').getByRole('tab',{name:mode,exact:true}).click();
   for(const kind of ['window-focus','visibility','reduced-motion','forced-colors']){
    await keyboardFocus();const before=await state();assert(before.focused&&before.keyboard&&before.opacity>.98);
    if(kind==='window-focus')await page.evaluate(()=>window.dispatchEvent(new Event('blur')));
    if(kind==='visibility')await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));});
    if(kind==='reduced-motion')await page.emulateMedia({reducedMotion:'reduce'});
    if(kind==='forced-colors')await page.emulateMedia({forcedColors:'active'});
    const paused=await state();assert.equal(paused.x,'');
    if(kind==='window-focus')await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    if(kind==='visibility')await page.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'));});
    if(kind==='reduced-motion')await page.emulateMedia({reducedMotion:'no-preference'});
    if(kind==='forced-colors')await page.emulateMedia({forcedColors:'none'});
    await page.waitForTimeout(260);const resumed=await state();
    await page.screenshot({path:path.join(out,mode+'-'+kind+'.png'),animations:'disabled'});
    cases.push({mode,kind,before,paused,resumed,restored:resumed.focused&&resumed.keyboard&&resumed.glow==='1'&&resumed.opacity>.98&&Math.abs(parseFloat(resumed.x)-resumed.expectedX)<1});
   }
  }
  // Recovering preferences in a background document must not invent focus.
  await keyboardFocus();await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));Object.defineProperty(document,'hasFocus',{configurable:true,value:()=>false});window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(260);
  const inactive=await state();assert.equal(inactive.x,'');negative.push('background document stays quiet');
  await page.evaluate(()=>{delete document.hasFocus;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');
  await page.getByRole('navigation').getByRole('button',{name:'账户总览',exact:true}).click();await button.click();assert.equal((await state()).keyboard,false);
  await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});await page.waitForTimeout(260);assert.equal((await state()).x,'');negative.push('mouse focus does not turn into keyboard light');
  await settings();await page.getByRole('button',{name:'液态玻璃',exact:true}).click();await page.keyboard.press('Tab');await button.focus();
  await page.evaluate(()=>{window.dispatchEvent(new Event('blur'));window.dispatchEvent(new Event('focus'));});await page.emulateMedia({reducedMotion:'reduce'});await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForTimeout(260);assert.equal((await state()).x,'');negative.push('glass off remains quiet on recovery');
  const passed=cases.every(row=>row.restored)&&errors.length===0;fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed,kind:'built-renderer-preserved-keyboard-focus-restoration',nativeWindowInput:false,cases,negative,errors},null,2));assert(passed,'preserved keyboard focus must regain light at its current center');
  console.log('PASS '+cases.length+' light/dark focus/visibility/media restoration cases; '+negative.length+' inactive/mouse/off guards');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
