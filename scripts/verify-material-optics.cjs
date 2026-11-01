// Live backdrop pixels and actual animation keyframes, with synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const {chooseMaterial,assertSurfaces}=require('./lib/appearance-checks.cjs');
async function main(){
 const native=process.env.QUOTA_NATIVE_DATA,out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/material-optics');fs.mkdirSync(out,{recursive:true});
 if(native){assert(path.isAbsolute(native));const c=JSON.parse(fs.readFileSync(path.join(native,'config.json')));assert.equal(c.accounts.length,0);assert.equal(c.settings.ladderAutoUpdate,false);}
 const browser=native?await chromium.connectOverCDP(process.env.QUOTA_CDP_URL):await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 let page;const checks=[],errors=[];
 try{
  page=native?browser.contexts().flatMap(c=>c.pages()).find(p=>p.url()==='http://tauri.localhost/'):await browser.newPage({viewport:{width:1024,height:900},locale:'zh-CN',reducedMotion:'no-preference'});assert(page);
  if(native){const i=await page.evaluate(()=>window.__TAURI_INTERNALS__.invoke('app_info'));assert.equal(path.resolve(i.configDir).toLowerCase(),path.resolve(native).toLowerCase());}
  else{await page.addInitScript(()=>localStorage.setItem('quota.appearance.v1',JSON.stringify({theme:'quota',mode:'light',collapsed:false,glass:true,reduceEffects:false,revision:Date.now()})));await page.goto(process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/');}
  page.on('pageerror',e=>errors.push(e.message));await page.emulateMedia({reducedMotion:'no-preference'});
  const nav=name=>page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true});await nav('设置').click();await chooseMaterial(page,false);await page.locator('.launch-screen').waitFor({state:'detached'});
  await page.waitForFunction(()=>document.querySelectorAll('.material-plane[data-lens="ready"]').length===2);await assertSurfaces(page,false);await page.waitForTimeout(380);
  const geometry=await page.evaluate(()=>[...document.querySelectorAll('.material-plane')].map(e=>({width:e.offsetWidth,height:e.offsetHeight,filter:getComputedStyle(e).backdropFilter,map:[...e.querySelectorAll('filter')].map(f=>({width:Number(f.getAttribute('width')),height:Number(f.getAttribute('height'))}))})));
  for(const e of geometry){assert.match(e.filter,/url/);assert.equal(e.map.length,1);assert.equal(e.width,e.map[0].width);assert.equal(e.height,e.map[0].height);}checks.push('each rounded navigation surface has a live backdrop lens matching its actual size');
  // Calibration pattern is test-only, removed before product screenshots.
  const original=await page.locator('.app').getAttribute('style');await page.locator('.app').evaluate(e=>e.style.background='repeating-linear-gradient(90deg,#086bdc 0 8px,#eef5ff 8px 16px)');
  await page.waitForTimeout(80);const box=await page.locator('.sidebar').boundingBox(),refracted=await page.screenshot({path:path.join(out,'calibration-refracted.png'),animations:'disabled'});
  const originalLens=await page.locator('.sidebar').evaluate(e=>{const old=e.style.getPropertyValue('--material-lens');e.style.setProperty('--material-lens','brightness(1)');return old;});
  const flat=await page.screenshot({path:path.join(out,'calibration-flat.png'),animations:'disabled'});
  const pixels=await page.evaluate(async([a,b,r])=>{
   const decode=async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(0,0,c.width,c.height);};
   const aa=await decode(a),bb=await decode(b),ratio=aa.width/window.innerWidth,diff=(x,y)=>{const i=(Math.round(y*ratio)*aa.width+Math.round(x*ratio))*4;return [0,1,2].reduce((sum,k)=>sum+Math.abs(aa.data[i+k]-bb.data[i+k]),0);};
   let edgeChanged=0,total=0,outsideChanged=0;
   for(let y=Math.round(r.y+80);y<r.y+r.height-80;y+=3)for(let x=Math.round(r.x+2);x<r.x+14;x++){total++;if(diff(x,y)>12)edgeChanged++;}
   // Stay beyond the antialias fringe of the 16px rounded corner.
   for(let y=Math.round(r.y+1);y<r.y+4;y++)for(let x=Math.round(r.x+1);x<r.x+4;x++)if(diff(x,y)>0)outsideChanged++;
   return {edgeChanged,total,outsideChanged};
  },[refracted.toString('base64'),flat.toString('base64'),box]);
  assert(pixels.edgeChanged>pixels.total*.2,JSON.stringify(pixels));assert.equal(pixels.outsideChanged,0,'filter cannot paint beyond its rounded corner');
  await page.locator('.sidebar').evaluate((e,value)=>e.style.setProperty('--material-lens',value),originalLens);await page.locator('.app').evaluate((e,value)=>value===null?e.removeAttribute('style'):e.setAttribute('style',value),original);checks.push('real calibration pixels refract at the bevel; pixels outside the rounded corner remain identical');
  const selection=async name=>page.evaluate(async name=>{const host=document.querySelector('.sidebar-nav'),button=[...host.querySelectorAll('button')].find(e=>e.getAttribute('aria-label')===name);button.click();await new Promise(requestAnimationFrame);return host.querySelector('.motion-highlight').getAnimations().flatMap(a=>a.effect.getKeyframes());},name);
  const full=await selection('我的使用');assert(full.length>=4&&full.some(f=>String(f.transform).includes('scale(')),JSON.stringify(full));
  const reversal=await page.evaluate(async()=>{const h=document.querySelector('.sidebar-nav > .motion-highlight'),host=h.parentElement,before=h.getBoundingClientRect(),bounds=host.getBoundingClientRect();host.querySelector('[aria-label="设置"]').click();await new Promise(requestAnimationFrame);return {x:before.left-bounds.left,y:before.top-bounds.top,start:h.getAnimations()[0]?.effect.getKeyframes()[0]};});
  const match=reversal.start?.transform?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);assert(match,JSON.stringify(reversal));assert(Math.abs(Number(match[1])-reversal.x)<10&&Math.abs(Number(match[2])-reversal.y)<10,JSON.stringify(reversal));checks.push('full selection stretches only the optical overlay; fast reversal starts from its visible position');
  await chooseMaterial(page,true);await page.waitForTimeout(180);const reduced=await selection('我的使用');assert(reduced.length&&reduced.every(f=>f.transform===undefined&&f.width===undefined&&f.height===undefined),JSON.stringify(reduced));await nav('设置').click();
  await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();const sidebar=await page.locator('.main').evaluate(e=>e.getAnimations().flatMap(a=>a.effect.getKeyframes()));assert(sidebar.length&&sidebar.every(f=>f.transform===undefined),JSON.stringify(sidebar));await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();checks.push('reduced effects use opacity dissolves for navigation and sidebar; no moving or elastic keyframes');
  await chooseMaterial(page,false);await page.emulateMedia({reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.motion==='reduced');assert.equal(await page.locator('html').getAttribute('data-material'),'liquid');const system=await selection('我的使用');assert(system.every(f=>f.transform===undefined),JSON.stringify(system));assert(await page.locator('feDisplacementMap').evaluateAll(es=>es.every(e=>Number(e.getAttribute('scale'))<10)));await nav('设置').click();checks.push('system Reduce Motion preserves the material, lowers lens intensity and removes spatial motion');
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.material==='solid');assert.equal(await page.locator('.material-plane[data-lens]').count(),0);assert.equal(await page.locator('feDisplacementMap').count(),0);await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.querySelectorAll('.material-plane[data-lens]').length===2);checks.push('high contrast fully removes lens filters and restores them without stale maps');
  await page.screenshot({path:path.join(out,'liquid-final.png'),animations:'disabled'});await chooseMaterial(page,true);await page.screenshot({path:path.join(out,'reduced-final.png'),animations:'disabled'});
  if(native)await page.emulateMedia({reducedMotion:null,forcedColors:null});assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:native?'isolated-native-webview':'built-synthetic-preview',profileConfirmed:!!native,geometry,pixels,full,reduced,sidebar,system,checks},null,2));console.log(checks.map(x=>'PASS '+x).join('\n'));
 }finally{await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
