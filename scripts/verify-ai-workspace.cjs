// Product interactions against the real built UI with isolated mock data.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4178/';
const out=path.resolve(__dirname,'../target/ai-workspace-ui');fs.mkdirSync(out,{recursive:true});
async function noOverflow(page){
  const sizes=await page.locator('.main').evaluate(el=>({width:el.clientWidth,scroll:el.scrollWidth,content:el.querySelector('.content').clientWidth,contentScroll:el.querySelector('.content').scrollWidth}));
  assert.ok(sizes.scroll<=sizes.width+1&&sizes.contentScroll<=sizes.content+1,JSON.stringify(sizes));
}
async function main(){
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const evidence=[];const errors=[];
  try{
    const page=await browser.newPage({viewport:{width:1024,height:768},colorScheme:'dark',reducedMotion:'reduce'});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base);await page.locator('.launch-screen').waitFor({state:'hidden'});
    const nav=page.getByRole('navigation',{name:'主导航'});
    await nav.getByRole('button',{name:'设置',exact:true}).click();
    const appearance=page.locator('.appearance-settings');
    for(const theme of ['Codex','Claude','VS Code','GitHub','Quota']){
      await appearance.getByRole('button',{name:new RegExp('^'+theme)}).click();
      for(const mode of ['浅色','深色']){
        await appearance.getByRole('tab',{name:mode,exact:true}).click();
        const state=await page.locator('html').evaluate(el=>({theme:el.dataset.colorTheme,mode:el.dataset.colorMode,bg:getComputedStyle(el).getPropertyValue('--bg').trim()}));
        assert.equal(state.mode,mode==='浅色'?'light':'dark');
        await noOverflow(page);await page.screenshot({path:path.join(out,`theme-${theme.replace(' ','-')}-${state.mode}.png`)});evidence.push(state);
      }
    }
    await appearance.getByRole('button',{name:/^Codex/}).click();await appearance.getByRole('tab',{name:'浅色',exact:true}).click();
    await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();
    await page.locator('.app.sidebar-collapsed').waitFor();assert.equal(await page.locator('.sidebar').evaluate(el=>el.clientWidth),68);
    await page.screenshot({path:path.join(out,'collapsed-sidebar.png')});
    for(const name of ['AI 模型','我的使用','设置']){await nav.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();await noOverflow(page);}
    await page.reload();await page.locator('.launch-screen').waitFor({state:'hidden'});await page.locator('.app.sidebar-collapsed').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-color-theme'),'codex');assert.equal(await page.locator('html').getAttribute('data-color-mode'),'light');
    await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await nav.getByRole('button',{name:'AI 模型',exact:true}).click();
    await page.locator('.visual-model-page[data-release-window="30"]').waitFor();
    assert.equal(await page.getByRole('tab',{name:'模型目录',exact:true}).count(),0);
    await page.locator('.visual-model-toolbar button').filter({hasText:/^六维对比$/}).click();
    await page.locator('.visual-ability .ability-radar').waitFor();await noOverflow(page);
    await page.close();
    for(const test of ['fresh','upgrade','retry']){
      const setup=await browser.newPage({viewport:{width:900,height:650},reducedMotion:'reduce'});setup.on('pageerror',error=>errors.push(error.message));
      await setup.goto(base+`?window=setup&setupCase=${test}`);await setup.getByRole('heading',{name:'欢迎使用 Quota 安装向导'}).waitFor();
      await setup.getByLabel('安装语言',{exact:true}).selectOption('en');await setup.getByRole('heading',{name:'Welcome to the Quota Setup Wizard'}).waitFor();
      await setup.getByLabel('安装语言',{exact:true}).selectOption('zh');await setup.screenshot({path:path.join(out,`setup-${test}-welcome.png`)});
      await setup.getByRole('button',{name:'下一步 >',exact:true}).click();const target=setup.getByRole('textbox',{name:'目标文件夹',exact:true});
      if(test==='upgrade'){await expectReadonly(target);}else{await target.fill('D:\\Quota Product Test');await setup.getByLabel('创建桌面快捷方式',{exact:true}).uncheck();}
      await setup.screenshot({path:path.join(out,`setup-${test}-options.png`)});await setup.getByRole('button',{name:'下一步 >',exact:true}).click();
      await setup.screenshot({path:path.join(out,`setup-${test}-review.png`)});await setup.getByRole('button',{name:'安装',exact:true}).click();
      if(test==='retry'){await setup.getByRole('button',{name:'重试',exact:true}).waitFor();assert.match(await setup.locator('.setup-content').innerText(),/托盘退出/);await setup.getByRole('button',{name:'重试',exact:true}).click();}
      await setup.getByRole('progressbar').waitFor();assert.equal(await setup.getByRole('button',{name:'关闭安装器',exact:true}).isDisabled(),true);
      await setup.screenshot({path:path.join(out,`setup-${test}-installing.png`)});await setup.getByRole('heading',{name:'安装完成',exact:true}).waitFor();
      const request=await setup.evaluate(()=>window.demoSetupRequest);assert.equal(request.startMenu,true);assert.equal(request.desktopShortcut,test==='upgrade');
      await setup.getByLabel('运行 Quota',{exact:true}).uncheck();await setup.screenshot({path:path.join(out,`setup-${test}-finish.png`)});await setup.getByRole('button',{name:'完成',exact:true}).click();
      await setup.waitForFunction(()=>window.demoSetupFinished===false);
      const geometry=await setup.locator('.setup-app').evaluate(el=>({w:el.clientWidth,sw:el.scrollWidth,h:el.clientHeight,sh:el.scrollHeight}));assert.ok(geometry.w>=geometry.sw&&geometry.h>=geometry.sh);evidence.push({setup:test,...geometry});await setup.close();
    }
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,evidence},null,2));console.log('PASS five themes x two modes, persisted sidebar, model ladder/radar without the library and three complete setup flows (mock engine)');
  }finally{await browser.close();}
}
async function expectReadonly(locator){assert.equal(await locator.getAttribute('readonly'),'');assert.equal(await locator.inputValue(),'D:\\Quota');}
main().catch(error=>{console.error(error);process.exitCode=1;});
