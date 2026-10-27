// Run against preview-server with mock-tauri data; never connects to personal accounts.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.QUOTA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QUOTA_PREVIEW_URL || 'http://127.0.0.1:4178/';
const out = path.resolve(__dirname,'../target/desktop-polish-ui');
fs.mkdirSync(out,{recursive:true});
const root=path.resolve(__dirname,'..');
const preview=path.join(root,'dist-mock');
fs.mkdirSync(preview,{recursive:true});
fs.cpSync(path.join(root,'dist/assets'),path.join(preview,'assets'),{recursive:true});
for(const file of ['ladder.json','model_catalog.json']) fs.copyFileSync(path.join(root,'src-tauri/data',file),path.join(preview,file));
fs.writeFileSync(path.join(preview,'index.html'),fs.readFileSync(path.join(root,'dist/index.html'),'utf8').replace('<head>','<head><script>'+fs.readFileSync(path.join(root,'scripts/mock-tauri.js'),'utf8')+'</script>'));
async function main(){
  const browser = await chromium.launch({headless:true,channel:process.env.QUOTA_BROWSER_CHANNEL || 'msedge'});
  const pages = ['账户总览','我的使用','模型库','AI 模型天梯','Token 活动','设置'];
  const evidence = [];
  try {
    for(const theme of ['light','dark']){
      const page = await browser.newPage({viewport:{width:1024,height:768},colorScheme:theme,reducedMotion:'reduce'});
      const errors=[];page.on('pageerror',error=>errors.push(error.message));
      await page.goto(base+'?sshCase=multi&storageCase=modern');
      await page.locator('.launch-screen').waitFor({state:'hidden'});
      await page.locator('.workspace-usage strong').filter({hasText:'123.5万'}).waitFor();
      for(const name of pages){
        await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:new RegExp('^'+name)}).click();
        await page.getByRole('heading',{name,exact:true,level:1}).waitFor();
        if(name==='设置') await page.locator('.cross-device-sync .badge').filter({hasText:'已开启'}).waitFor();
        if(name==='AI 模型天梯') await page.locator('.scatter-panel').first().waitFor();
        if(name==='我的使用') await page.locator('.usage-cost-placeholder').waitFor({state:'hidden'});
        if(name==='Token 活动') await page.locator('.activity-overview[aria-busy="false"]').waitFor();
        await page.waitForFunction(()=>!document.querySelector('.content .skeleton'));
        const geometry=await page.locator('.main').evaluate(main=>({width:main.clientWidth,scroll:main.scrollWidth,contentWidth:main.querySelector('.content').clientWidth,contentScroll:main.querySelector('.content').scrollWidth}));
        assert.ok(geometry.scroll<=geometry.width+1,`${theme} ${name} main overflow: ${JSON.stringify(geometry)}`);
        assert.ok(geometry.contentScroll<=geometry.contentWidth+1,`${theme} ${name} content overflow: ${JSON.stringify(geometry)}`);
        await page.screenshot({path:path.join(out,`${theme}-${pages.indexOf(name)}.png`)});
        evidence.push({theme,page:name,viewportWidth:1024,...geometry});
      }
      const sync=page.locator('.cross-device-sync');
      assert.match(await sync.innerText(),/1 台已发现/);
      await sync.getByText('SSH 用量来源 · 2 台',{exact:true}).click();
      assert.equal(await sync.getByText('无需安装 Quota',{exact:true}).count(),2);
      assert.match(await sync.innerText(),/远端无需安装 Quota/);
      await page.screenshot({path:path.join(out,`${theme}-ssh-sources.png`)});
      await page.locator('.workspace-usage').click();
      await page.getByRole('heading',{name:'我的使用',exact:true,level:1}).waitFor();
      await page.locator('.workspace-sync').click();
      await page.getByRole('heading',{name:'设置',exact:true,level:1}).waitFor();
      await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:/^账户总览/}).click();
      await page.locator('.page-actions').getByRole('button',{name:'添加账户',exact:true}).click();
      const dialog=page.getByRole('dialog');await dialog.waitFor();
      assert.match(await dialog.innerText(),/API Key 在哪拿/);
      await page.screenshot({path:path.join(out,`${theme}-account-form.png`)});
      await dialog.getByRole('button',{name:'关闭',exact:true}).click();
      await page.getByRole('button',{name:'最大化窗口',exact:true}).click();
      await page.locator('.app[data-window-shape="square"]').waitFor();
      assert.equal(await page.locator('.app').evaluate(el=>getComputedStyle(el).borderRadius),'0px');
      await page.getByRole('button',{name:'还原窗口',exact:true}).click();
      await page.locator('.app[data-window-shape="rounded"]').waitFor();
      assert.equal(await page.locator('.app').evaluate(el=>getComputedStyle(el).borderRadius),'14px');
      await page.setViewportSize({width:1440,height:900});
      await page.screenshot({path:path.join(out,`${theme}-wide.png`)});
      assert.deepEqual(errors,[]);
      await page.close();
    }
    const page=await browser.newPage({viewport:{width:1024,height:768}});
    await page.goto(base+'?widgetCase=error');
    await page.locator('.workspace-retry').waitFor();
    assert.equal(await page.locator('.workspace-usage strong').innerText(),'—');
    await page.locator('.workspace-retry').click();
    await page.screenshot({path:path.join(out,'read-error.png')});
    fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,pages:evidence},null,2));
    console.log('PASS six pages in light/dark at 1024px, account form, toolbar navigation, SSH/client distinction, square/rounded state and failed-read recovery');
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
