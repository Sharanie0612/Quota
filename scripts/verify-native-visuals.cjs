// Development-only CDP access to an explicitly isolated packaged Quota.
// Uses the real Rust commands and bundled frontend; no mocked Tauri responses.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const callModule={exports:require('./lib/source-loader.cjs').createSourceLoader()(path.join(__dirname,'../src/lib/outputCalls'))};
const {assertSurfaces,assertInkContrast}=require('./lib/appearance-checks.cjs');
async function main(){
  const root=path.resolve(process.env.QUOTA_NATIVE_DATA||'');
  assert(process.env.QUOTA_NATIVE_DATA&&path.isAbsolute(process.env.QUOTA_NATIVE_DATA));
  const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(config.accounts.length,0);assert.equal(config.settings.ladderAutoUpdate,false);
  const out=path.join(root,'visual');fs.mkdirSync(out,{recursive:true});fs.rmSync(path.join(out,'evidence.json'),{force:true});
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
  const nativeInfo=await invoke('app_info');assert.equal(path.resolve(nativeInfo.configDir).toLowerCase(),root.toLowerCase(),'CDP must target the explicitly isolated profile before any UI action or capture');
  const widgetInfo=await widget.evaluate(()=>window.__TAURI_INTERNALS__.invoke('app_info'));assert.equal(path.resolve(widgetInfo.configDir).toLowerCase(),root.toLowerCase(),'task context must belong to the same isolated profile');
  const go=async name=>{await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name,exact:true}).click();await page.getByRole('heading',{name,level:1,exact:true}).waitFor();};
  const capture=async name=>{await page.screenshot({path:path.join(out,name+'.png'),animations:'disabled'});};
  await go('我的使用');await page.waitForFunction(()=>document.querySelector('.usage-kpis strong')?.textContent.startsWith('¥'));
  const month=new Date().toLocaleDateString('sv-SE').slice(0,7),fx=await invoke('get_monthly_usage_fx',{months:[month],average:true});assert.equal(fx.error,null);assert.equal(fx.rates.length,1);assert.notEqual(fx.rates[0].cnyPerUsd,9.9);
  const expected='¥'+(100+20*fx.rates[0].cnyPerUsd).toLocaleString('zh-CN',{minimumFractionDigits:0,maximumFractionDigits:2});assert.equal(await page.locator('.usage-kpis strong').first().innerText(),expected);await capture('usage-native');
  await page.getByRole('tab',{name:'消费记录',exact:true}).click();assert.equal(await page.locator('.usage-history tbody tr').count(),2);await capture('history-native');
  await page.getByRole('tab',{name:'实际单价',exact:true}).click();assert(await page.locator('.vendor-cost-card').count()>0);checks.push('real monthly-average FX, unified RMB, expense history and actual-price view');
  await go('设置');const glass=page.getByRole('button',{name:'毛玻璃',exact:true});
  if(await glass.getAttribute('aria-pressed')==='true')await glass.click();await assertSurfaces(page,false);await glass.click();
  await page.waitForFunction(()=>document.documentElement.dataset.material==='frosted');await widget.waitForFunction(()=>document.documentElement.dataset.material==='frosted');await assertSurfaces(page,true);
  const preferences=await invoke('get_appearance');await invoke('save_appearance',{preferences:{...preferences,glass:false,revision:preferences.revision-1}});assert.equal((await invoke('get_appearance')).glass,true);
  assert(await widget.evaluate(p=>window.__TAURI_INTERNALS__.invoke('save_appearance',{preferences:p}).then(()=>false,()=>true),preferences),'task window cannot save appearance');
  await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.material==='solid');await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.documentElement.dataset.material==='frosted');
  const rendered=await page.screenshot({omitBackground:true});const alpha=await page.evaluate(async data=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);return ctx.getImageData(3,3,1,1).data[3];},rendered.toString('base64'));assert.equal(alpha,255,'opaque WebView backing, rounded Win32 region verified separately');
  await page.getByRole('button',{name:'最大化窗口',exact:true}).click();await page.getByRole('button',{name:'还原窗口',exact:true}).waitFor();assert((await invoke('get_main_window_state')).square);await page.getByRole('button',{name:'还原窗口',exact:true}).click();await page.getByRole('button',{name:'最大化窗口',exact:true}).waitFor();assert(!(await invoke('get_main_window_state')).square);
  await page.reload();await page.waitForFunction(()=>document.documentElement.dataset.material==='frosted');checks.push('opaque frosted main, shared radii/solid controls, stale revision guard, task isolation, high-contrast restore, max/restore and saved setting');
  await go('设置');
  for(const [name,id] of [['Codex','codex'],['Claude','claude'],['VS Code','vscode'],['GitHub','github'],['Quota','quota']]){
    await page.locator('.appearance-settings').getByRole('button',{name:new RegExp('^'+name)}).click();
    for(const [label,mode] of [['深色','dark'],['浅色','light']]){
      await page.locator('.appearance-settings').getByRole('tab',{name:label,exact:true}).click();
      for(const context of [page,widget])await context.waitForFunction(([id,mode])=>document.documentElement.dataset.colorTheme===id&&document.documentElement.dataset.colorMode===mode&&document.documentElement.dataset.material==='frosted',[id,mode]);
      await assertSurfaces(page,true);const saved=await invoke('get_appearance');assert.equal(saved.theme,id);assert.equal(saved.mode,mode);
    }
  }
  await page.locator('.launch-screen').waitFor({state:'detached'});await capture('appearance-native');
  const choice=page.locator('.theme-option[aria-pressed="true"]');await choice.hover();await choice.click();assert.equal(await choice.evaluate(e=>getComputedStyle(e,'::after').content),'none');await page.keyboard.press('Tab');assert(await page.locator(':focus-visible').count()>0);
  checks.push('ten native palettes, task-window synchronization, normal pointer/keyboard behavior without dynamic glow layers');
  await go('输出速度');await page.getByRole('tab',{name:'全部',exact:true}).click();await page.waitForFunction(()=>Number(document.querySelector('.speed-plot')?.dataset.callCount)>0);
  const speed=await invoke('get_output_speed',{device:'',source:'codex',days:0,model:'',bucketSeconds:0,lookbackHours:0,lookbackMinutes:0});assert.equal(Number(await page.locator('.speed-plot').getAttribute('data-call-count')),speed.calls.length);assert.equal(speed.calls.length,speed.summary.samples);assert.equal(await page.locator('.speed-plot path').count(),0);const speedInk=await assertInkContrast(page,'.speed-average-value');
  const speedAxis=await page.locator('[data-time-tick]').evaluateAll(rows=>rows.map(e=>{const r=e.getBoundingClientRect();return {at:Number(e.dataset.timeTick),label:e.textContent,left:r.left,right:r.right};}));assert(speedAxis.length>=2);assert.equal(new Set(speedAxis.map(r=>r.label)).size,speedAxis.length);assert(speedAxis.every((r,i)=>!i||r.left>=speedAxis[i-1].right+6));
  const speedSvg=page.locator('.speed-call-canvas svg'),focusState=()=>speedSvg.evaluate(e=>({focused:document.activeElement===e,visible:e.matches(':focus-visible'),outline:getComputedStyle(e).outlineStyle,width:parseFloat(getComputedStyle(e).outlineWidth)}));
  const speedSize=await speedSvg.evaluate(e=>({width:e.viewBox.baseVal.width,height:e.viewBox.baseVal.height})),firstCall=callModule.exports.callLayout(speed.calls,speedSize.width,speedSize.height).points[0],expectedPointerTime=await page.evaluate(at=>new Date(at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'}),firstCall.call.completedAt);await speedSvg.hover({position:{x:firstCall.x,y:firstCall.y}});await page.getByRole('tooltip').waitFor();const speedHovered=await page.getByRole('tooltip').locator('b').innerText();assert.equal(speedHovered,expectedPointerTime);await speedSvg.click({position:{x:firstCall.x,y:firstCall.y}});const speedClicked=await page.getByRole('tooltip').locator('b').innerText();assert.equal(speedClicked,expectedPointerTime);
  await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'输出速度',exact:true}).click();await speedSvg.click({position:{x:20,y:20}});const speedEmptyTooltips=await page.getByRole('tooltip').count();assert.equal(speedEmptyTooltips,0);const speedMouseFocus=await focusState();assert(speedMouseFocus.focused&&!speedMouseFocus.visible&&speedMouseFocus.outline==='none');await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');const speedKeyboardFocus=await focusState();assert(speedKeyboardFocus.focused&&speedKeyboardFocus.visible&&speedKeyboardFocus.outline==='solid'&&speedKeyboardFocus.width>=2);
  await page.locator('.speed-plot svg').focus();await page.keyboard.press('ArrowLeft');await page.getByRole('tooltip').waitFor();const sortedCalls=[...speed.calls].sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id)),selectedCall=sortedCalls[Math.max(0,sortedCalls.length-2)],speedPrecision=await page.getByRole('tooltip').locator('b').innerText();assert.equal(speedPrecision,await page.evaluate(at=>new Date(at).toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',fractionalSecondDigits:3,hourCycle:'h23'}),selectedCall.completedAt));await page.keyboard.press('Escape');await capture('speed-native');checks.push('all real completed calls rendered individually, distinct nonoverlapping time labels, exact millisecond tooltip, readable speed ink, no connected curve, keyboard access');
  const speedDisplay=[],speedAppearance=await invoke('get_appearance'),displaySession=await page.context().newCDPSession(page),viewport=await page.evaluate(()=>({width:innerWidth,height:innerHeight,ratio:devicePixelRatio}));
  const canvasState=()=>page.locator('.speed-call-canvas canvas').evaluate(canvas=>{
    const rect=canvas.getBoundingClientRect(),source=canvas.getContext('2d'),pixelContext=document.createElement('canvas').getContext('2d');
    const pixel=color=>{pixelContext.fillStyle=color;pixelContext.fillRect(0,0,1,1);return [...pixelContext.getImageData(0,0,1,1).data];},actual=pixel(source.strokeStyle),expected=pixel(getComputedStyle(canvas).color);
    return {ratio:devicePixelRatio,width:canvas.width,height:canvas.height,cssWidth:Math.round(rect.width),cssHeight:Math.round(rect.height),inkDifference:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i]))),actual,expected,calls:Number(document.querySelector('.speed-plot').dataset.callCount)};
  });
  const readyCanvas=async()=>{let state;for(let attempt=0;attempt<40;attempt++){state=await canvasState();if(state.inkDifference<=1&&Math.abs(state.width-Math.trunc(state.cssWidth*state.ratio))<=1&&Math.abs(state.height-Math.trunc(state.cssHeight*state.ratio))<=1){assert.equal(state.calls,speed.calls.length);return state;}await page.waitForTimeout(25);}assert.fail('Native speed canvas did not follow display change: '+JSON.stringify(state));};
  // Packaged Tauri makes invoke read-only. Delay the command's actual fetch
  // transport and prove that the probe stays pending until explicit release.
  let speedFreeze;
  await page.evaluate(()=>{
    const fetch=window.fetch,url=window.__TAURI_INTERNALS__.convertFileSrc('get_output_speed','ipc');
    window.nativeSpeedFreeze={fetch,held:[],requests:0,completed:0};
    window.fetch=function(...args){if(String(args[0])===url){window.nativeSpeedFreeze.requests++;return new Promise(resolve=>window.nativeSpeedFreeze.held.push(()=>resolve(fetch.apply(this,args))));}return fetch.apply(this,args);};
    void window.__TAURI_INTERNALS__.invoke('get_output_speed',{device:'',source:'codex',days:0,model:'',bucketSeconds:0,lookbackHours:0,lookbackMinutes:0}).then(()=>window.nativeSpeedFreeze.completed++);
  });
  try{
    await page.waitForFunction(()=>window.nativeSpeedFreeze.requests>0&&window.nativeSpeedFreeze.completed===0);
    await invoke('save_appearance',{preferences:{...speedAppearance,mode:'system',revision:Math.max(Date.now(),speedAppearance.revision+1)}});
    for(const mode of ['dark','light']){
      await page.emulateMedia({colorScheme:mode});await page.waitForFunction(mode=>document.documentElement.dataset.colorMode===mode,mode);speedDisplay.push({kind:'system-'+mode,state:await readyCanvas()});
      for(const active of [true,false]){await page.emulateMedia({forcedColors:active?'active':'none'});await page.waitForFunction(active=>document.documentElement.dataset.material===(active?'solid':'frosted'),active);speedDisplay.push({kind:mode+'-contrast-'+active,state:await readyCanvas()});}
    }
    for(const ratio of [2,1.5,1.25,viewport.ratio]){
      await displaySession.send('Emulation.setDeviceMetricsOverride',{width:viewport.width,height:viewport.height,deviceScaleFactor:ratio,mobile:false});await page.waitForFunction(ratio=>devicePixelRatio===ratio,ratio);await page.evaluate(()=>window.dispatchEvent(new Event('resize')));speedDisplay.push({kind:'emulated-DPR-resize',state:await readyCanvas()});
    }
    speedFreeze=await page.evaluate(()=>({blockedRequests:window.nativeSpeedFreeze.requests,probeCompletedBeforeRelease:window.nativeSpeedFreeze.completed}));assert.equal(speedFreeze.probeCompletedBeforeRelease,0);
  }finally{
    await displaySession.send('Emulation.clearDeviceMetricsOverride');await page.evaluate(()=>{window.dispatchEvent(new Event('resize'));const probe=window.nativeSpeedFreeze;window.fetch=probe.fetch;probe.held.splice(0).forEach(release=>release());});await page.emulateMedia({forcedColors:'none',colorScheme:null});await invoke('save_appearance',{preferences:{...speedAppearance,revision:Date.now()+1}});await displaySession.detach();
  }
  await page.waitForFunction(()=>window.nativeSpeedFreeze.completed===1);speedFreeze.probeCompletedAfterRelease=1;
  await page.waitForFunction(()=>document.documentElement.dataset.colorMode==='light'&&document.documentElement.dataset.material==='frosted');await readyCanvas();checks.push('native frozen-call canvas follows system/contrast colors and emulated DPI resize without waiting for data');
  await go('AI 模型');await page.locator('.scatter-point').first().waitFor();
  const nodes=await page.locator('.scatter-point').evaluateAll(elements=>elements.map(e=>({x:Number(e.dataset.plotX),y:Number(e.dataset.plotY),members:JSON.parse(e.dataset.members)})));
  for(let i=0;i<nodes.length;i++)for(let j=0;j<i;j++)assert(Math.hypot(nodes[i].x-nodes[j].x,nodes[i].y-nodes[j].y)>=27.9);
  const ids=nodes.flatMap(n=>n.members.map(m=>m.id));assert.equal(ids.length,new Set(ids).size);await capture('ladder-native');
  const cluster=page.locator('.scatter-point').filter({has:page.locator('.scatter-badge')}).first();if(await cluster.count()){await cluster.click();await page.getByRole('region',{name:'相近模型'}).waitFor();await capture('ladder-group-native');await page.getByRole('button',{name:'收起相近模型'}).click();}
  await page.getByRole('button',{name:'展开图表',exact:true}).click();await page.getByRole('dialog',{name:'放大的模型天梯'}).waitFor();await page.keyboard.press('Escape');checks.push('native model points do not overlap; group and expanded view work');
  await widget.mouse.move(-10,-10);await widget.locator('.widget-handle').hover();await widget.locator('.usage-widget.is-expanded').waitFor();await widget.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  assert(!/tokens\/s|片段/.test(await widget.locator('.widget-panel').innerText()));assert(await widget.locator('.widget-panel').evaluate(e=>e.scrollHeight<=e.clientHeight&&e.scrollWidth<=e.clientWidth));await widget.screenshot({path:path.join(out,'widget-native.png'),omitBackground:true,animations:'disabled'});
  const taskInk=await assertInkContrast(widget,'.live-model-phase');
  await widget.locator('.widget-value').focus();await widget.keyboard.press('Escape');await widget.locator('.usage-widget:not(.native-expanded)').waitFor();await widget.screenshot({path:path.join(out,'widget-collapsed-native.png'),omitBackground:true,animations:'disabled'});checks.push('two live fixture tasks from real collector, task widget expansion/collapse and no content overflow');
  await widget.evaluate(()=>{window.nativeClockChanges=0;window.nativeClockObserver=new MutationObserver(rows=>window.nativeClockChanges+=rows.length);document.querySelectorAll('.task-row time').forEach(el=>window.nativeClockObserver.observe(el,{subtree:true,characterData:true,childList:true}));});
  await widget.waitForTimeout(2200);const clockChanges=await widget.evaluate(()=>{window.nativeClockObserver.disconnect();return window.nativeClockChanges;});assert.equal(clockChanges,0);
  await widget.mouse.move(-10,-10);await widget.locator('.widget-handle').hover();await widget.locator('.is-expanded').waitFor();await widget.waitForFunction(()=>document.querySelectorAll('.task-row').length===2);
  const elapsed=await widget.evaluate(async()=>{const data=await window.__TAURI_INTERNALS__.invoke('get_widget_speed'),text=document.querySelector('.task-row time').textContent,part=unit=>Number(text.match(new RegExp('(\\d+)'+unit))?.[1]||0);return {shown:part('\u65f6')*3600+part('\u5206')*60+part('\u79d2'),expected:Math.floor((Date.now()-data.tasks[0].startedAt)/1000),precision:text.includes('\u65f6')?60:1};});assert(Math.abs(elapsed.shown-elapsed.expected)<=elapsed.precision);
  await widget.locator('.widget-value').focus();await widget.keyboard.press('Escape');await widget.locator('.usage-widget:not(.native-expanded)').waitFor();checks.push('native collapsed task text stays idle and opening refreshes the real elapsed time');
  for(const [file,contents] of oldFiles)assert.equal(fs.readFileSync(path.join(root,file),'utf8'),contents);assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:true,kind:'installed-native-webview-cdp-synthetic-data',profileConfirmed:true,expectedRmb:expected,fx:fx.rates[0],calls:speed.calls.length,speedAxis,speedPrecision,speedFocus:{mouse:speedMouseFocus,keyboard:speedKeyboardFocus},speedInk,taskInk,speedPointer:{expected:expectedPointerTime,hovered:speedHovered,clicked:speedClicked,emptyTooltips:speedEmptyTooltips},speedDisplay,speedFreeze,taskClock:{collapsedTextMutations:clockChanges,resumedElapsed:elapsed},checks,desktopCapture:false},null,2));
  console.log(checks.map(check=>'PASS '+check).join('\n'));await browser.close();
}
main().catch(error=>{console.error(error);process.exit(1);});
