// Retained keyboard focus must stay optically aligned as geometry changes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-anchor');fs.mkdirSync(out,{recursive:true});
 const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),rows=[],checks=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));await page.addInitScript(()=>window.demoNativeGlass=true);await page.goto(process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/');
  const settings=()=>page.getByRole('navigation').getByRole('button',{name:'设置',exact:true}).click();await settings();await page.getByRole('button',{name:'液态玻璃',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');await page.locator('.launch-screen').waitFor({state:'detached'});
  const button=page.locator('.workspace-toolbar button').first(),toolbar=page.locator('.workspace-toolbar');
  const focus=async()=>{await page.getByRole('navigation').getByRole('button').first().focus();await page.keyboard.press('Tab');await button.focus();await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');};
  const state=()=>button.evaluate(e=>{const host=e.closest('.workspace-toolbar'),a=e.getBoundingClientRect(),b=host.getBoundingClientRect(),x=parseFloat(host.style.getPropertyValue('--glass-x')),y=parseFloat(host.style.getPropertyValue('--glass-y')),expectedX=a.left+a.width/2-b.left,expectedY=a.top+a.height/2-b.top;return{focused:document.activeElement===e,keyboard:e.matches(':focus-visible'),x,y,expectedX,expectedY,error:Math.max(Math.abs(x-expectedX),Math.abs(y-expectedY))};});
  for(const mode of ['浅色','深色']){
   await settings();await page.locator('.appearance-settings').getByRole('tab',{name:mode,exact:true}).click();await focus();
   for(const [width,height] of [[1280,900],[1024,768],[1360,1000],[1280,900]]){
    await page.setViewportSize({width,height});await page.waitForTimeout(320);const value=await state();rows.push({mode,width,height,...value});await page.screenshot({path:path.join(out,mode+'-'+width+'.png'),animations:'disabled'});
   }
  }
  fs.writeFileSync(path.join(out,'measurements.json'),JSON.stringify({kind:'viewport-anchors-only',passed:rows.every(row=>row.focused&&row.keyboard&&row.error<1),rows},null,2));
  await focus();await page.evaluate(()=>{
   const target=document.querySelector('.workspace-toolbar').style,original=CSSStyleDeclaration.prototype.setProperty;window.anchorProbe={writes:0,original};CSSStyleDeclaration.prototype.setProperty=function(name,...args){if(this===target&&name==='--glass-x')window.anchorProbe.writes++;return original.call(this,name,...args);};
  });
  const settle=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.evaluate(()=>{window.anchorProbe.writes=0;for(let n=0;n<500;n++)window.dispatchEvent(new Event('resize'));});await settle();const burst=await page.evaluate(()=>window.anchorProbe.writes);assert.equal(burst,1,'resize burst must produce one focus-coordinate update');checks.push('500resize events ->1focus position update');
  await page.evaluate(()=>{window.anchorProbe.writes=0;window.dispatchEvent(new Event('resize'));window.dispatchEvent(new Event('blur'));});await settle();assert.equal(await page.evaluate(()=>window.anchorProbe.writes),0);assert.equal(await toolbar.evaluate(e=>e.style.getPropertyValue('--glass-x')),'');checks.push('blur cancels pending layout work');
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await focus();await page.evaluate(()=>{window.anchorProbe.writes=0;window.dispatchEvent(new Event('resize'));document.querySelector('.sidebar-toggle').focus();});await settle();assert.equal(await page.evaluate(()=>window.anchorProbe.writes),0);await page.keyboard.press('Space');await page.waitForTimeout(320);assert.equal(await toolbar.evaluate(e=>e.style.getPropertyValue('--glass-x')),'');assert.equal(await page.locator('.sidebar-toggle').getAttribute('aria-expanded'),'false');checks.push('focus change cancels stale geometry; keyboard sidebar collapse clears old light');
  await page.evaluate(()=>{CSSStyleDeclaration.prototype.setProperty=window.anchorProbe.original;});assert.deepEqual(errors,[]);
  const passed=rows.every(row=>row.focused&&row.keyboard&&row.error<1);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed,kind:'built-renderer-retained-keyboard-focus-resize',nativeWindowInput:false,rows,burstFocusUpdates:burst,checks,errors},null,2));assert(passed,'retained focus light must remain centered');console.log('PASS '+rows.length+' light/dark viewport anchors; '+checks.join('; '));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
