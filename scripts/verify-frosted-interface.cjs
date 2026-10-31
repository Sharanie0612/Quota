// Production CSS and pointer/keyboard behavior with synthetic data, not a desktop-compositor test.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const {assertSurfaces}=require('./lib/appearance-checks.cjs');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/';
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/frosted-ui');
async function main(){
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const cases=[],errors=[];
  try{
    for(const theme of ['quota','codex','claude','vscode','github'])for(const mode of ['light','dark']){
      const page=await browser.newPage({viewport:{width:1024,height:900},locale:'zh-CN',colorScheme:mode,reducedMotion:'reduce'});
      page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({theme,mode})=>{if(!localStorage.getItem('quota.appearance.v1'))localStorage.setItem('quota.appearance.v1',JSON.stringify({theme,mode,glass:false,collapsed:false,revision:Date.now()}));},{theme,mode});
      await page.goto(base);const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
      await go('设置');await page.waitForFunction(([theme,mode])=>document.documentElement.dataset.colorTheme===theme&&document.documentElement.dataset.colorMode===mode,[theme,mode]);
      for(const frosted of [false,true]){
        const toggle=page.getByRole('button',{name:'毛玻璃',exact:true});if((await toggle.getAttribute('aria-pressed')==='true')!==frosted)await toggle.click();
        await page.waitForFunction(frosted=>document.documentElement.dataset.material===(frosted?'frosted':'solid'),frosted);
        const state=await assertSurfaces(page,frosted);const choice=page.locator('.theme-option[aria-pressed="true"]');
        await choice.hover();assert.equal(await choice.evaluate(e=>getComputedStyle(e).borderRadius),'10px');await choice.click();
        // Real pointer clicks do not install any dynamic highlight/filter layer.
        assert.equal(await choice.evaluate(e=>getComputedStyle(e,'::after').content),'none');
        cases.push({theme,mode,frosted,main:state.main,button:state.buttons[0]});
      }
      await page.reload();await go('设置');await assertSurfaces(page,true);
      await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.material==='solid');assert.equal(await page.locator('.main').evaluate(e=>getComputedStyle(e).backdropFilter),'none');
      await page.emulateMedia({forcedColors:'none',reducedMotion:'reduce'});await page.waitForFunction(()=>document.documentElement.dataset.material==='frosted');
      assert(parseFloat(await page.locator('.motion-highlight').first().evaluate(e=>getComputedStyle(e).transitionDuration))<.01);
      // System mode resolves in either direction without losing the saved material.
      await page.getByRole('tab',{name:'跟随系统',exact:true}).click();for(const system of ['dark','light']){await page.emulateMedia({colorScheme:system});await page.waitForFunction(system=>document.documentElement.dataset.colorMode===system,system);await assertSurfaces(page,true);}
      if(theme==='quota'){await page.screenshot({path:path.join(out,'settings-frosted.png'),animations:'disabled'});await go('账户总览');await page.getByRole('button',{name:'添加账户',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();await assertSurfaces(page,true);assert(!await dialog.locator('details').first().evaluate(e=>e.hasAttribute('open')));await page.screenshot({path:path.join(out,'account-form.png'),animations:'disabled'});await dialog.getByRole('button',{name:'取消',exact:true}).click();}
      await page.close();
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,cases,checks:['opaque root','shared radii','solid controls and cards','pointer states','persistence','high contrast restore','reduced motion','system theme','minimal account form']},null,2));console.log('PASS 20 theme/material cases, stable control corners and opacity, pointer states, persistence, system/high-contrast/reduced-motion recovery');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
