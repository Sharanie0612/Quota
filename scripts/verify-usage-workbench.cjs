// Real production UI; all account, billing and stream values below are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4186/';
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/usage-workbench-ui');fs.mkdirSync(out,{recursive:true});
function fixtures(){
  const day=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const now=new Date(),bills=[];
  for(let n=0;n<6;n++){
    const from=day(new Date(now.getFullYear(),now.getMonth()-n,1)),to=day(new Date(now.getFullYear(),now.getMonth()-n+1,0));
    for(const [vendor,currency,subscription,usage] of [['custom','USD',20,null],['zhipu','CNY',118,null],['mimo','CNY',39,null],['deepseek','CNY',null,29.5+n*6]])bills.push({vendor,from,to,currency,subscription,usage,planId:null});
  }
  window.demoVendorExpenses=bills;
  window.demoCostHistory=Array.from({length:28},(_,index)=>{
    const at=Math.floor(new Date(now.getFullYear(),now.getMonth(),Math.min(index+1,now.getDate()),12).getTime()/1000);
    return {accountId:'demo-ledger',vendor:'deepseek',label:'开发账户',at,from:index?at-86400:null,currency:'CNY',cumulativeSpend:80+index*2.35,cumulativeRecharge:150+(index>15?50:0),spendDelta:index?2.35:null,rechargeDelta:index===16?50:index?0:null,counterReset:false};
  }).filter((row,index,rows)=>index===0||row.at!==rows[index-1].at);
}
async function noOverflow(page){
  const result=await page.locator('.main').evaluate(main=>{const content=main.querySelector('.content');return {width:main.clientWidth,scroll:main.scrollWidth,contentWidth:content.clientWidth,contentScroll:content.scrollWidth};});
  assert(result.scroll<=result.width+1&&result.contentScroll<=result.contentWidth+1,JSON.stringify(result));
}
async function main(){
  const edge=process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=await chromium.launch({executablePath:edge,headless:true});const errors=[],checks=[];
  try {
    const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light'});
    page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(fixtures);await page.goto(base);
    const nav=page.getByRole('navigation',{name:'主导航'});
    const go=async name=>{await nav.getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,exact:true,level:1}).waitFor();assert.equal(await page.getByRole('heading',{name,exact:true,level:1}).count(),1);};
    await go('我的使用');await page.locator('.usage-kpis').waitFor();await noOverflow(page);
    assert.match(await page.locator('.usage-kpis section').first().innerText(),/186.5/);
    await page.screenshot({animations:'disabled',path:path.join(out,'usage-overview-3100.png')});
    await page.getByRole('tab',{name:'美元',exact:true}).click();assert.match(await page.locator('.usage-kpis section').first().innerText(),/\$20/);
    await page.getByRole('tab',{name:'人民币',exact:true}).click();await page.getByLabel('统计厂商',{exact:true}).selectOption('deepseek');await page.locator('.usage-kpis').waitFor();
    await page.waitForFunction(()=>document.querySelector('.usage-kpis section strong')?.textContent==='¥29.5');
    assert(!/gpt-/i.test(await page.locator('.usage-breakdown').innerText()));
    await page.getByLabel('统计厂商',{exact:true}).selectOption('');await page.locator('.usage-kpis').waitFor();
    await page.getByRole('tab',{name:'自定义',exact:true}).click();
    const month=await page.evaluate(()=>new Date().toLocaleDateString('sv-SE').slice(0,7));
    await page.getByLabel('统计开始日期',{exact:true}).fill(month+'-10');await page.getByLabel('统计结束日期',{exact:true}).fill(month+'-14');await page.getByRole('button',{name:'应用日期',exact:true}).click();await page.locator('.usage-kpis').waitFor();
    await page.locator('.usage-analysis').getByRole('button',{name:'导出 CSV',exact:true}).click();await page.waitForFunction(()=>!!window.demoExport);
    const csv=await page.evaluate(()=>window.demoExport.contents);assert(csv.includes(month+'-10')&&csv.includes(month+'-14'));assert.equal(csv.trim().split('\r\n').length,6);
    await page.getByLabel('统计粒度',{exact:true}).selectOption('week');await page.locator('.usage-analysis-plot svg').focus();await page.keyboard.press('ArrowLeft');await page.getByRole('tooltip').waitFor();
    await page.getByRole('tab',{name:'全部',exact:true}).click();await page.locator('.usage-kpis').waitFor();
    await page.getByRole('tab',{name:'消费历史',exact:true}).click();await page.locator('.analytics-table tbody tr').first().waitFor();assert.equal(await page.locator('.analytics-table tbody tr').count(),18);
    await page.locator('.toast').waitFor({state:'hidden'});await page.screenshot({animations:'disabled',path:path.join(out,'spending-history-3100.png')});
    await page.getByRole('tab',{name:'账户消费记录',exact:true}).click();await page.locator('.consumption-plot svg').waitFor();
    assert.match(await page.locator('.usage-history').innerText(),/开发账户/);await page.screenshot({animations:'disabled',path:path.join(out,'consumption-records-3100.png')});
    await page.getByRole('tab',{name:'实际 Token 单价',exact:true}).click();await page.locator('.vendor-cost-card').first().waitFor();await page.locator('.vendor-cost-head').first().click();await page.locator('.vendor-cost-card[open] .vendor-model-table').waitFor();await noOverflow(page);
    checks.push('month/custom/all/vendor/currency, CSV, keyboard charts, full expense history and preserved real unit-price details');
    await go('设置');const appearance=page.locator('.appearance-settings');
    const glass=appearance.getByRole('button',{name:'液态玻璃',exact:true});assert.equal(await glass.getAttribute('aria-pressed'),'false');await glass.click();
    assert.equal(await page.locator('html').getAttribute('data-glass'),'on');await page.reload();await page.locator('.launch-screen').waitFor({state:'hidden'});await go('设置');assert.equal(await page.locator('html').getAttribute('data-glass'),'on');
    await page.screenshot({animations:'disabled',path:path.join(out,'appearance-3100.png')});
    for(const name of ['Quota','Codex','Claude','VS Code','GitHub'])for(const mode of ['浅色','深色']){
      await page.locator('.appearance-settings').getByRole('button',{name:new RegExp('^'+name)}).click();await page.locator('.appearance-settings').getByRole('tab',{name:mode,exact:true}).click();await noOverflow(page);
      if(mode==='深色'&&name==='Quota')await page.screenshot({animations:'disabled',path:path.join(out,'appearance-dark-3100.png')});
    }
    await page.emulateMedia({forcedColors:'active'});assert.equal(await page.locator('.sidebar').evaluate(el=>getComputedStyle(el).backdropFilter),'none');await page.emulateMedia({forcedColors:'none'});
    await page.locator('.appearance-settings').getByRole('button',{name:/^Quota/}).click();await page.locator('.appearance-settings').getByRole('tab',{name:'浅色',exact:true}).click();await page.locator('.appearance-settings').getByRole('button',{name:'液态玻璃',exact:true}).click();
    checks.push('five palettes x two modes, glass toggle persistence, forced-colors fallback');
    for(const width of [1024,1440]){
      await page.setViewportSize({width,height:width===1024?768:1000});
      for(const [name,ready] of [['我的使用','.usage-kpis'],['输出速度','.speed-summary'],['设置','.appearance-settings'],['AI 模型','.visual-model-toolbar']]){await go(name);await page.locator(ready).waitFor();await noOverflow(page);if(width===1024&&name==='我的使用')await page.screenshot({animations:'disabled',path:path.join(out,'usage-1024-3100.png')});}
      await page.getByRole('button',{name:'收起侧边栏',exact:true}).click();await page.locator('.app.sidebar-collapsed').waitFor();await noOverflow(page);
      await page.getByRole('button',{name:'展开侧边栏',exact:true}).click();await page.locator('.app:not(.sidebar-collapsed)').waitFor();
    }
    await go('AI 模型');await page.locator('.visual-model-toolbar button').filter({hasText:/^六维对比$/}).click();await page.locator('.visual-ability .ability-radar').waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'model-comparison-3100.png')});
    await go('账户总览');await page.getByRole('button',{name:'添加账户',exact:true}).click();await page.getByRole('dialog').waitFor();assert.match(await page.getByRole('dialog').innerText(),/API Key 在哪拿/);await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();
    await go('输出速度');await page.locator('.speed-average-value').filter({hasText:/\d/}).waitFor();await page.screenshot({animations:'disabled',path:path.join(out,'output-speed-3100.png')});
    await page.locator('.speed-plot svg').focus();await page.keyboard.press('ArrowLeft');await page.getByRole('tooltip').waitFor();await page.keyboard.press('Escape');
    await page.getByRole('tab',{name:'记录',exact:true}).click();await page.locator('.speed-records tbody tr').first().waitFor();assert.equal(await page.locator('.speed-records tbody tr').count(),24);
    checks.push('1024/1440 layout, collapsed navigation, simple account form, six-axis comparison, speed chart and response records');
    await page.close();
    for(const scenario of ['', 'pending','multiple','stale','paused','idle','error','no-stream']){
      const widget=await browser.newPage({viewport:{width:324,height:276},colorScheme:'light',locale:'zh-CN',reducedMotion:'reduce'});widget.on('pageerror',error=>errors.push(error.message));
      await widget.goto(base+'?window=usage-widget&widgetLiveCase='+scenario);await widget.locator('.widget-value strong').filter({hasNotText:'—'}).waitFor();await widget.mouse.move(-10,-10);await widget.locator('.widget-handle').hover();await widget.locator('.is-expanded').waitFor();await widget.locator('.live-model-phase').filter({hasNotText:'正在连接'}).waitFor();
      const text=await widget.locator('.widget-panel').innerText();
      if(scenario==='') {assert.match(text,/80/);await widget.screenshot({animations:'disabled',path:path.join(out,'live-widget-3100.png')});}
      if(['pending','stale','paused','error'].includes(scenario))assert.equal(await widget.locator('.live-model-rate strong').innerText(),'—');
      if(scenario==='multiple'){await widget.getByLabel('悬浮窗当前模型').selectOption('demo-live-b');assert.match(await widget.getByLabel('悬浮窗当前模型').inputValue(),/demo-live-b/);}
      assert(await widget.locator('.widget-panel').evaluate(el=>el.scrollHeight<=el.clientHeight&&el.scrollWidth<=el.clientWidth),'widget text must fit');
      await widget.locator('.widget-value').focus();await widget.keyboard.press('Escape');await widget.locator('.usage-widget:not(.native-expanded)').waitFor();await widget.close();
    }
    checks.push('widget live/pending/multiple/idle/stale/paused/error/unsupported-stream states, keyboard collapse and fixed viewport');
    assert.deepEqual(errors,[]);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'built-frontend-with-synthetic-data',checks},null,2));console.log('PASS '+checks.join('\nPASS '));
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
