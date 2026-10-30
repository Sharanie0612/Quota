// Development-only CDP access to an explicitly isolated installed Quota.
// Uses the real Rust commands and bundled frontend; no mocked Tauri responses.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
  const root=path.resolve(process.env.QUOTA_NATIVE_DATA||'');
  assert(process.env.QUOTA_NATIVE_DATA&&path.isAbsolute(process.env.QUOTA_NATIVE_DATA));
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(config.accounts.length,0);assert.equal(config.settings.ladderAutoUpdate,false);
  const out=path.join(root,'visual');fs.mkdirSync(out,{recursive:true});
  const oldFiles=['vendor-costs.json','monthly-usage-fx.json'].map(file=>[file,fs.readFileSync(path.join(root,file),'utf8')]);
  const browser=await chromium.connectOverCDP(process.env.QUOTA_CDP_URL||'http://127.0.0.1:9237');
  let page,widget;
  for(let attempt=0;attempt<150;attempt++){
    const pages=browser.contexts().flatMap(c=>c.pages());page=pages.find(p=>/^http:\/\/tauri.localhost\/$/.test(p.url()));widget=pages.find(p=>p.url().includes('window=usage-widget'));
    if(page&&widget)break;await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert(page&&widget,'native main and widget must finish opening');
  const errors=[],checks=[];page.on('pageerror',error=>errors.push(error.message));widget.on('pageerror',error=>errors.push(error.message));
  const invoke=(name,args)=>page.evaluate(([name,args])=>window.__TAURI_INTERNALS__.invoke(name,args),[name,args]);
  const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
  const capture=async name=>{await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});};
  await go('我的使用');await page.waitForFunction(()=>document.querySelector('.usage-kpis strong')?.textContent.startsWith('¥'));
  const month=new Date().toLocaleDateString('sv-SE').slice(0,7),fx=await invoke('get_monthly_usage_fx',{months:[month],average:true});assert.equal(fx.error,null);assert.equal(fx.rates.length,1);assert.notEqual(fx.rates[0].cnyPerUsd,9.9);
  const expected='¥'+(100+20*fx.rates[0].cnyPerUsd).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});assert.equal(await page.locator('.usage-kpis strong').first().innerText(),expected);await capture('usage-native');
  await page.getByRole('tab',{name:'消费记录',exact:true}).click();assert.equal(await page.locator('.usage-history tbody tr').count(),2);await capture('history-native');
  await page.getByRole('tab',{name:'实际单价',exact:true}).click();assert(await page.locator('.vendor-cost-card').count()>0);checks.push('real monthly-average FX, unified RMB, expense history and actual-price view');
  await go('设置');const glass=page.getByRole('button',{name:'液态玻璃',exact:true});if(await glass.getAttribute('aria-pressed')==='true')await glass.click();await glass.click();
  await widget.waitForFunction(()=>document.documentElement.dataset.glass==='on');await page.waitForFunction(()=>document.documentElement.dataset.glass==='on');
  await go('我的使用');await page.waitForFunction(()=>document.querySelector('.usage-kpis strong')?.textContent.startsWith('¥'));await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on'&&getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)');assert.equal(await page.locator('.usage-kpis').evaluate(e=>getComputedStyle(e).backdropFilter),'none');const preferences=await invoke('get_appearance');const material=await invoke('sync_main_material',{revision:preferences.revision,dark:false,allowed:true});assert.equal(material.active,true);const stale=await invoke('sync_main_material',{revision:preferences.revision-1,dark:false,allowed:true});assert.equal(stale.active,false);assert.equal(await widget.evaluate(args=>window.__TAURI_INTERNALS__.invoke('sync_main_material',args).then(()=>false,()=>true),{revision:preferences.revision,dark:false,allowed:true}),true);await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='off');await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');const glassLayer=await page.screenshot({omitBackground:true});const clearCorner=await page.evaluate(async data=>{const img=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=img.width;canvas.height=img.height;const ctx=canvas.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(3,3,1,1).data[3];},glassLayer.toString('base64'));assert.equal(clearCorner,0);await page.getByRole('button',{name:'最大化窗口',exact:true}).click();await page.getByRole('button',{name:'还原窗口',exact:true}).waitFor();assert((await invoke('get_main_window_state')).square);await page.getByRole('button',{name:'还原窗口',exact:true}).click();await page.getByRole('button',{name:'最大化窗口',exact:true}).waitFor();assert(!(await invoke('get_main_window_state')).square);await capture('glass-native');
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.glass==='on');checks.push('real clear native material, transparent root, revision guard, widget isolation, high-contrast restore and persisted setting');
  await page.emulateMedia({reducedMotion:'no-preference'});
  await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
  await page.locator('.launch-screen').waitFor({state:'detached'});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  const toolbar=page.locator('.workspace-toolbar'),toolbarRect=await toolbar.boundingBox();
  await page.mouse.move(toolbarRect.x+60,toolbarRect.y+toolbarRect.height+60);
  await page.mouse.move(toolbarRect.x+60,toolbarRect.y+20);
  await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.workspace-toolbar'),'::after').opacity)>.98);
  const lightPosition=await toolbar.evaluate(e=>e.style.getPropertyValue('--glass-x'));
  await page.mouse.move(toolbarRect.x+60,toolbarRect.y+toolbarRect.height+60);
  assert.equal(await toolbar.evaluate(e=>e.style.getPropertyValue('--glass-x')),lightPosition);
  await page.waitForFunction(()=>!document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-x'));
  await page.keyboard.press('Tab');await toolbar.locator('button').first().focus();
  await page.waitForFunction(()=>document.querySelector('.workspace-toolbar').style.getPropertyValue('--glass-glow')==='1');
  assert(await toolbar.locator('button').first().evaluate(e=>e.matches(':focus-visible')));
  checks.push('installed WebView rim fade retains its last position and keyboard focus activates the light');
  await go('输出速度');await page.getByRole('tab',{name:'全部',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.speed-plot')?.dataset.callCount)>0);
  const speed=await invoke('get_output_speed',{device:'',source:'codex',days:0,model:'',bucketSeconds:0,lookbackHours:0,lookbackMinutes:0});assert.equal(Number(await page.locator('.speed-plot').getAttribute('data-call-count')),speed.calls.length);assert.equal(speed.calls.length,speed.summary.samples);assert.equal(await page.locator('.speed-plot path').count(),0);await page.locator('.speed-plot svg').focus();await page.keyboard.press('ArrowLeft');await page.getByRole('tooltip').waitFor();await page.keyboard.press('Escape');await capture('speed-native');checks.push('all real completed calls rendered individually, no connected curve, keyboard access');
  await go('AI 模型');await page.locator('.scatter-point').first().waitFor();
  const nodes=await page.locator('.scatter-point').evaluateAll(elements=>elements.map(e=>({x:Number(e.dataset.plotX),y:Number(e.dataset.plotY),members:JSON.parse(e.dataset.members)})));
  for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)>=27.9);
  const ids=nodes.flatMap(n=>n.members.map(m=>m.id));assert.equal(ids.length,new Set(ids).size);await capture('ladder-native');
  const cluster=page.locator('.scatter-point').filter({has:page.locator('.scatter-badge')}).first();if(await cluster.count()){await cluster.click();await page.getByRole('region',{name:'相近模型'}).waitFor();await capture('ladder-group-native');await page.getByRole('button',{name:'收起相近模型'}).click();}
  await page.getByRole('button',{name:'展开图表',exact:true}).click();await page.getByRole('dialog',{name:'放大的模型天梯'}).waitFor();await page.keyboard.press('Escape');checks.push('native model points do not overlap; group and expanded view work');
  await widget.locator('.widget-handle').hover();await widget.locator('.usage-widget.is-expanded').waitFor();await widget.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  assert(!/tokens\/s|片段/.test(await widget.locator('.widget-panel').innerText()));assert(await widget.locator('.widget-panel').evaluate(e=>e.scrollHeight<=e.clientHeight&&e.scrollWidth<=e.clientWidth));await widget.screenshot({path:path.join(out,'widget-native.png'),omitBackground:true,animations:'disabled'});
  await widget.locator('.widget-value').focus();await widget.keyboard.press('Escape');await widget.locator('.usage-widget:not(.native-expanded)').waitFor();await widget.screenshot({path:path.join(out,'widget-collapsed-native.png'),omitBackground:true,animations:'disabled'});checks.push('two live fixture tasks from real collector, glass widget expansion/collapse and no content overflow');
  for(const [file,contents] of oldFiles)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),contents);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'installed-native-webview-cdp-synthetic-data',expectedRmb:expected,fx:fx.rates[0],calls:speed.calls.length,checks,desktopCapture:false},null,2));
  console.log(checks.map(check=>'PASS '+check).join('\n'));await browser.close();
}
main().catch(error=>{console.error(error);process.exit(1);});
