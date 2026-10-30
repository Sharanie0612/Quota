// Interaction QA on the real built renderer with synthetic native capability.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/',out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-motion');
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const checks=[],errors=[];
 try{
  const page=await browser.newPage({viewport:{width:1280,height:900},locale:'zh-CN',reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));
  await page.addInitScript(()=>{window.demoNativeGlass=true;});await page.goto(base);
  const go=async label=>page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:label,exact:true}).click();await go('\u8bbe\u7f6e');
  const toggle=page.getByRole('button',{name:'\u6db2\u6001\u73bb\u7483',exact:true});await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  const toolbar=page.locator('.workspace-toolbar'),rect=await toolbar.boundingBox();
  const inside=()=>page.mouse.move(rect.x+50,rect.y+20),outside=()=>page.mouse.move(rect.x+80,rect.y+rect.height+70);
  const state=()=>toolbar.evaluate(e=>({x:e.style.getPropertyValue('--glass-x'),y:e.style.getPropertyValue('--glass-y'),glow:e.style.getPropertyValue('--glass-glow'),opacity:Number(getComputedStyle(e,'::after').opacity)}));
  await inside();await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.workspace-toolbar'),'::after').opacity)>.98);const lit=await state();assert(lit.x&&lit.y);
  await outside();const fading=await state();assert.equal(fading.x,lit.x);assert.equal(fading.y,lit.y);assert.equal(fading.glow,'0');
  const fadeFrames=await toolbar.evaluate(e=>new Promise(resolve=>{const values=[];const sample=()=>{values.push(Number(getComputedStyle(e,'::after').opacity));if(values.length<12)requestAnimationFrame(sample);else resolve(values);};requestAnimationFrame(sample);}));
  assert(fadeFrames.some(value=>value>0&&value<1),'rim fades through intermediate opacity');await page.waitForFunction(()=>!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'));
  checks.push('pointer leave fades from the last light position without a coordinate jump');
  await inside();await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');await outside();await page.waitForTimeout(35);await inside();await page.waitForTimeout(260);assert.equal((await state()).glow,'1');assert((await state()).x);assert.deepEqual(await toolbar.boundingBox(),rect);
  checks.push('rapid reentry cancels the previous fade; content geometry stays fixed');
  await outside();await page.keyboard.press('Tab');await toolbar.locator('button').first().focus();await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');
  const focused=await page.evaluate(()=>{const el=document.activeElement,host=el.closest('.workspace-toolbar'),a=el.getBoundingClientRect(),b=host.getBoundingClientRect();return {visible:el.matches(':focus-visible'),expected:a.left+a.width/2-b.left,actual:parseFloat(host.style.getPropertyValue('--glass-x'))};});assert(focused.visible);assert(Math.abs(focused.expected-focused.actual)<1);
  await toolbar.locator('button').first().click();await go('\u8bbe\u7f6e');await page.waitForFunction(()=>!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'),null,{timeout:1000});await page.keyboard.press('Tab');
  const tabs=page.locator('.appearance-settings [role="tablist"]').first();await tabs.locator('[aria-selected="true"]').focus();await page.keyboard.press('ArrowRight');assert.equal(await tabs.locator(':focus').getAttribute('aria-selected'),'true');assert.equal(await tabs.evaluate(e=>e.style.getPropertyValue('--glass-glow')),'1');
  await page.keyboard.press('End');assert.equal(await tabs.locator('button').last().getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await tabs.locator('button').first().getAttribute('aria-selected'),'true');
  checks.push('keyboard focus lights the focused control; segmented arrows, Home and End retain focus and selection');
  await inside();await page.evaluate(()=>window.dispatchEvent(new Event('blur')));assert.equal((await state()).x,'');
  await inside();await page.waitForFunction(()=>!!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'));await page.emulateMedia({reducedMotion:'reduce'});assert.equal((await state()).x,'');assert(await toolbar.evaluate(e=>parseFloat(getComputedStyle(e,'::after').transitionDuration)<=.00001));await inside();assert.equal((await state()).x,'');
  await page.emulateMedia({reducedMotion:'no-preference'});await outside();await inside();await page.waitForFunction(()=>!!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'));await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='off');assert.equal((await state()).x,'');assert.equal(await toolbar.evaluate(e=>getComputedStyle(e,'::after').display),'none');await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  await inside();await page.waitForFunction(()=>!!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'));await toggle.click();assert.equal((await state()).x,'');await toggle.click();
  checks.push('blur, glass off, reduced motion and high contrast clear pending motion and recover');
  // Scrolling changes only content; navigation remains in a stable clipped layer.
  for(const width of [1024,1360]){
   await page.setViewportSize({width,height:900});await go('\u8bbe\u7f6e');const before=await toolbar.boundingBox();await page.locator('.content').evaluate(e=>{e.scrollTop=e.scrollHeight;});assert.deepEqual(await toolbar.boundingBox(),before);assert(await page.locator('.main').evaluate(e=>e.scrollWidth<=e.clientWidth+1));
   const content=await page.locator('.content').boundingBox();assert(content.y>=before.y+before.height-1,'content clips below toolbar');await page.screenshot({path:path.join(out,`scroll-${width}.png`),animations:'disabled'});
  }
  checks.push('1024px and 1360px scrolling keeps toolbar geometry and content clipping stable');assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'built-renderer-synthetic-native-capability',checks,fadeFrames},null,2));console.log(checks.map(c=>'PASS '+c).join('\n'));
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
