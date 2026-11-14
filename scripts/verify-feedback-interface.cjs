// Exercise the built UI, including actual timer deadlines and theme/font inheritance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.QUOTA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QUOTA_PREVIEW_URL || 'http://127.0.0.1:4187/';
const out = path.resolve(process.env.QUOTA_UI_OUTPUT || 'target/feedback-ui');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const go = async (page, name) => {
  await page.getByRole('navigation', {name:'主导航'}).getByRole('button', {name, exact:true}).click();
  await page.getByRole('heading', {name, level:1, exact:true}).waitFor();
};
const textStyle = node => {
  const s = getComputedStyle(node);
  return {font:s.fontFamily, size:s.fontSize, weight:s.fontWeight, line:s.lineHeight, tracking:s.letterSpacing, color:s.color};
};

async function main() {
  fs.mkdirSync(out, {recursive:true});
  const browser = await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless:true});
  const errors = [], evidence = {themes:[], feedback:[], motion:[]};
  try {
    for (const theme of ['quota','codex','claude','vscode','github']) for (const mode of ['light','dark']) {
      const page = await browser.newPage({viewport:{width:1024,height:900}, locale:'zh-CN'});
      page.on('pageerror', error => errors.push(error.message));
      await page.addInitScript(({theme,mode}) => localStorage.setItem('quota.appearance.v1', JSON.stringify({theme,mode,glass:true,reduceEffects:false,collapsed:false,revision:Date.now()})), {theme,mode});
      await page.goto(base);
      await page.locator('.launch-screen').waitFor({state:'detached'});
      const body = await page.locator('body').evaluate(textStyle);
      assert.equal(body.size, '14px'); assert.equal(body.tracking, 'normal');
      const headings = [];
      for (const view of ['账户总览','我的使用','AI 模型','Token 活动','输出速度','设置']) {
        await go(page,view);
        const heading = await page.getByRole('heading',{name:view,level:1,exact:true}).evaluate(textStyle);
        assert.equal(heading.size,'26px', theme+' / '+view);
        assert.equal(heading.weight,theme==='claude'?'500':'600',theme+' / '+view);
        if (theme==='claude') assert.match(heading.font,/Georgia/); else assert.equal(heading.font,body.font);
        assert(await page.locator('.content').evaluate(e => e.scrollWidth<=e.clientWidth+1),view+' overflow at 1024px');
        headings.push({view,...heading});
      }
      const section = await page.locator('.appearance-settings h2').evaluate(textStyle);
      assert.equal(section.font,headings[0].font); assert.equal(section.size,'16px');
      await page.screenshot({path:path.join(out,`${theme}-${mode}.png`),animations:'disabled'});
      await go(page,'账户总览');
      await page.getByRole('button',{name:'添加账户',exact:true}).click();
      const dialog = page.getByRole('dialog');
      const modal = await dialog.locator('h2').evaluate(textStyle);
      assert.equal(modal.font,headings[0].font);assert.equal(modal.size,'20px');
      assert.equal((await dialog.locator('input').first().evaluate(textStyle)).font,body.font);
      await dialog.getByRole('button',{name:'取消',exact:true}).click();
      assert.equal(await dialog.getAttribute('data-closing'),'true');
      await dialog.waitFor({state:'detached'});
      assert.equal(await page.getByRole('button',{name:'添加账户',exact:true}).evaluate(e => e===document.activeElement),true);
      evidence.themes.push({theme,mode,body,headings,section,modal});
      await page.close();
    }

    const page = await browser.newPage({viewport:{width:1280,height:900}, locale:'zh-CN'});
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base+'?storageCase=normal');
    await page.locator('.launch-screen').waitFor({state:'detached'});
    await page.evaluate(() => {
      const original=window.__TAURI_INTERNALS__.invoke;
      window.feedbackError='测试：同步目录暂不可用';
      window.__TAURI_INTERNALS__.invoke=async function(command,args) {
        if (command==='refresh_all') throw Error('测试：连接暂不可用');
        const result=await original.call(this,command,args);
        if (command==='get_sync_overview') return {...result,syncErrors:[window.feedbackError]};
        return result;
      };
      window.noticeTimes=[];
      let visible=false;
      new MutationObserver(() => {
        const next=!!document.querySelector('.cross-device-sync .notice');
        if(next!==visible){visible=next;window.noticeTimes.push({visible,at:performance.now()});}
      }).observe(document.body,{childList:true,subtree:true});
    });
    await go(page,'设置');
    const notice = page.locator('.cross-device-sync .notice');
    await notice.waitFor();
    await page.locator('.cross-device-sync').scrollIntoViewIfNeeded();
    await page.screenshot({path:path.join(out,'sync-visible.png')});
    await pause(3000);
    // An unrelated background update must not postpone the same message's deadline.
    await page.evaluate(() => window.demoCompleteAccountSync());
    await notice.waitFor({state:'detached',timeout:3500});
    const times=await page.evaluate(() => window.noticeTimes);
    const lifetime=times[1].at-times[0].at;
    assert(lifetime>=4950&&lifetime<5700,JSON.stringify(times));
    assert.equal(await page.locator('.sync-heading .badge').innerText(),'需要重试');
    await page.getByText('查看未完成的同步',{exact:true}).click();
    await page.getByText('测试：同步目录暂不可用',{exact:true}).waitFor();
    await page.screenshot({path:path.join(out,'sync-dismissed.png'),animations:'disabled'});
    await page.getByRole('button',{name:'立即同步',exact:true}).click();
    await notice.waitFor();
    await notice.getByRole('button',{name:'关闭提示',exact:true}).click();
    await notice.waitFor({state:'detached',timeout:600});
    // A genuinely new error gets its own full deadline.
    await page.evaluate(() => {window.feedbackError='测试：另一个同步结果';window.demoCompleteAccountSync();});
    await notice.waitFor();
    await pause(4400);assert.equal(await notice.count(),1);
    await notice.waitFor({state:'detached',timeout:1500});
    evidence.feedback.push({partialSyncMs:lifetime,pollDidNotReset:true,retryReshown:true,newResultTimed:true,detailsRetained:true});

    await go(page,'账户总览');
    await page.getByRole('button',{name:'刷新全部',exact:true}).click();
    const toast=page.locator('.app > .toasts .toast');
    await toast.waitFor();
    await pause(2600);
    await page.getByRole('button',{name:'刷新全部',exact:true}).click();
    assert.equal(await toast.count(),1);
    await pause(2700);assert.equal(await toast.count(),1);
    await toast.waitFor({state:'detached',timeout:3000});
    await page.getByRole('button',{name:'刷新全部',exact:true}).click();
    await toast.getByRole('button',{name:'关闭提示',exact:true}).click();
    await toast.waitFor({state:'detached',timeout:600});
    evidence.feedback.push({toastResetsOnNewAction:true,duplicatesCollapsed:true,manualDismissal:true});

    await page.getByRole('button',{name:'添加账户',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    await pause(300);
    await page.keyboard.press('Escape');
    assert.equal(await page.getByRole('dialog').getAttribute('data-closing'),'true');
    const running=await page.locator('.modal').evaluate(e => e.getAnimations().map(a=>({name:a.animationName,duration:a.effect.getTiming().duration})));
    assert(running.some(a=>a.name==='modal-depart'&&a.duration===180),JSON.stringify(running));
    await page.getByRole('dialog').waitFor({state:'detached'});
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.getByRole('button',{name:'添加账户',exact:true}).click();
    await page.getByRole('dialog').waitFor();
    assert.equal(await page.locator('.modal').evaluate(e=>getComputedStyle(e).transform),'none');
    await page.keyboard.press('Escape');
    await page.getByRole('dialog').waitFor({state:'detached',timeout:250});
    evidence.motion.push({modalExit:running,reducedMotion:true,focusRestored:true});
    await page.close();
    assert.deepEqual(errors,[]);
    fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'built-frontend-synthetic-data',...evidence},null,2));
    console.log('PASS 10 theme/font combinations × 6 pages, 1024px, modal dismissal/focus/reduced motion and real 5s feedback lifecycles');
  } finally { await browser.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
