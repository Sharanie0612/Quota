// Built interface, synthetic data, real pointer/keyboard and accessibility media.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const {assertSurfaces,chooseMaterial,assertSidebar}=require('./lib/appearance-checks.cjs');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/';
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/material-ui');
async function main(){
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const cases=[],errors=[];let pixelModes;
  try{
    for(const theme of ['quota','codex','claude','vscode','github'])for(const mode of ['light','dark']){
      const page=await browser.newPage({viewport:{width:1024,height:900},locale:'zh-CN',colorScheme:mode,reducedMotion:'no-preference'});page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({theme,mode})=>{if(!localStorage.getItem('quota.appearance.v1'))localStorage.setItem('quota.appearance.v1',JSON.stringify({theme,mode,glass:false,reduceEffects:false,collapsed:false,revision:Date.now()}));},{theme,mode});
      await page.goto(base);const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
      await go('设置');await page.locator('.launch-screen').waitFor({state:'detached'});
      await chooseMaterial(page,'solid');await assertSurfaces(page,'solid');assert.equal(await page.getByRole('button',{name:'减少视觉效果',exact:true}).count(),0);
      const pixels=[];
      for(const frosted of [false,true]){
        await chooseMaterial(page,frosted);const state=await assertSurfaces(page,frosted);await assertSidebar(page,false);
        await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await assertSidebar(page,true);
        if(frosted)assert(await page.locator('.main').evaluate(e=>e.getAnimations().every(a=>Number(a.effect.getTiming().duration)<=160)),'reduced effects use a short sidebar transition');
        await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await assertSidebar(page,false);
        await page.locator('.theme-option[aria-pressed="true"]').click();
        assert.equal(await page.locator('.theme-option[aria-pressed="true"]').evaluate(e=>getComputedStyle(e,'::after').content),'none');
        cases.push({theme,mode,material:state.material,sidebar:state.sidebar,toolbar:state.toolbar});
        if(theme==='quota'){
          const png=await page.screenshot({path:path.join(out,mode+'-'+state.material+'.png'),animations:'disabled'});
          const sample=await page.evaluate(async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);const r=document.querySelector('.sidebar').getBoundingClientRect();return [.12,.4,.72].map(y=>[...ctx.getImageData(Math.round(r.right-8),Math.round(r.top+r.height*y),1,1).data]);},png.toString('base64'));pixels.push(sample);for(const pixel of sample)assert.equal(pixel[3],255);
        }
      }
      if(theme==='quota'&&mode==='light'){const difference=Math.max(...pixels[0].map((sample,j)=>sample.slice(0,3).reduce((sum,v,i)=>sum+Math.abs(v-pixels[1][j][i]),0)));assert(difference>3,JSON.stringify(pixels));pixelModes={pixels,difference};}
      await chooseMaterial(page,'solid');assert.equal(await page.getByRole('button',{name:'减少视觉效果',exact:true}).count(),0);await page.getByRole('button',{name:'液态玻璃',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.material==='frosted');await page.reload();await go('设置');await assertSurfaces(page,true);
      await chooseMaterial(page,false);await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.material==='solid');assert.equal(await page.locator('.sidebar').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
      await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.material==='liquid'&&document.documentElement.dataset.motion==='reduced');assert(parseFloat(await page.locator('.motion-highlight').first().evaluate(e=>getComputedStyle(e).transitionDuration))<.01);
      await page.emulateMedia({reducedMotion:'no-preference'});await page.waitForFunction(()=>document.documentElement.dataset.motion==='full');
      const cdp=await page.context().newCDPSession(page);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'},{name:'prefers-color-scheme',value:mode}]});
      assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-transparency:reduce)').matches),true);await assertSurfaces(page,false);await cdp.send('Emulation.setEmulatedMedia',{features:[]});await cdp.detach();
      await page.getByRole('tab',{name:'跟随系统',exact:true}).click();for(const system of ['dark','light']){await page.emulateMedia({colorScheme:system});await page.waitForFunction(system=>document.documentElement.dataset.colorMode===system,system);await assertSurfaces(page,false);}
      if(theme==='quota'&&mode==='light'){
        await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await assertSidebar(page,true);await page.screenshot({path:path.join(out,'sidebar-collapsed.png'),animations:'disabled'});await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();
        await go('账户总览');await page.getByRole('button',{name:'添加账户',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await assertSurfaces(page,false);assert(!await dialog.locator('details').first().evaluate(e=>e.hasAttribute('open')));await page.screenshot({path:path.join(out,'account-form.png'),animations:'disabled'});await dialog.getByRole('button',{name:'取消',exact:true}).click();
      }
      await page.close();
    }
    // A fresh install keeps the master off; explicit app choices survive system transparency preferences.
    const fresh=await browser.newPage();const cdp=await fresh.context().newCDPSession(fresh);await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-transparency',value:'reduce'}]});await fresh.goto(base);await fresh.waitForFunction(()=>document.documentElement.dataset.material==='solid');await fresh.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();await chooseMaterial(fresh,false);await fresh.reload();await fresh.waitForFunction(()=>document.documentElement.dataset.material==='liquid');await fresh.close();
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,cases,pixelModes,checks:['master off and two enabled material strengths','opaque content and controls','24px icons / 48px targets','header toggle not blocked by drag region','saved selection','conditional secondary switch and saved strength','high contrast','reduced motion','minimal form']},null,2));console.log('PASS 20 material/palette cases, distinct pixels, stable controls, sidebar targets, persistence and accessibility priorities');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
