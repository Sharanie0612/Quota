// Pixel regression: a transparent native surface must composite its tint once.
// CDP screenshots are renderer evidence, never desktop-compositor screenshots.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const native=!!process.env.QUOTA_NATIVE_DATA;
const root=native?path.resolve(process.env.QUOTA_NATIVE_DATA):null;
const out=path.resolve(process.env.QUOTA_UI_OUTPUT||(root?path.join(root,'composition'):'target/glass-composition'));
fs.mkdirSync(out,{recursive:true});
const evidence={passed:false,kind:native?'packaged-native-webview-synthetic-data':'built-renderer-synthetic-native-capability',desktopCapture:false,cases:[]};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function pixels(page,point){
  const png=await page.screenshot({omitBackground:true,animations:'disabled'});
  const rgba=await page.evaluate(async([data,point])=>{
    const image=await createImageBitmap(new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'}));
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
    const values=ctx.getImageData(Math.round(point.x*devicePixelRatio),Math.round(point.y*devicePixelRatio),1,1).data;
    return [...values];
  },[png.toString('base64'),point]);
  return {png,rgba};
}
async function main(){
  if(native){assert(path.isAbsolute(process.env.QUOTA_NATIVE_DATA));assert.equal(JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8')).accounts.length,0);}
  const browser=native?await chromium.connectOverCDP(process.env.QUOTA_CDP_URL||'http://127.0.0.1:9237'):await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  try{
    let page;
    if(native){for(let attempt=0;attempt<150;attempt++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^http:\/\/tauri.localhost\/$/.test(p.url()));if(page)break;await pause(100);}}
    else page=await browser.newPage({viewport:{width:1280,height:800},locale:'zh-CN'});
    assert(page,'isolated main window must be available');
    const invoke=(name,args)=>page.evaluate(([name,args])=>window.__TAURI_INTERNALS__.invoke(name,args),[name,args]);
    if(native){const info=await invoke('app_info');assert.equal(path.resolve(info.configDir).toLowerCase(),root.toLowerCase());evidence.profileConfirmed=true;await invoke('plugin:window|show',{label:'main'});await page.reload();}
    else{
      await page.addInitScript(()=>{window.demoNativeGlass=true;window.demoAppearance={theme:'quota',mode:'light',glass:true,collapsed:false,revision:1};localStorage.setItem('quota.appearance.v1',JSON.stringify(window.demoAppearance));});
      await page.goto(process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/');
    }
    const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.locator('.launch-screen').waitFor({state:'detached'});
    await page.getByRole('navigation',{name:'主导航'}).getByRole('button',{name:'设置',exact:true}).click();
    const toggle=page.getByRole('button',{name:'液态玻璃',exact:true});if(await toggle.getAttribute('aria-pressed')!=='true')await toggle.click();
    await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
    const original=native?await invoke('get_appearance'):null;
    for(const theme of ['quota','codex','claude','vscode','github'])for(const mode of ['light','dark']){
      if(native)await invoke('save_appearance',{preferences:{...original,theme,mode,glass:true,collapsed:false,revision:Date.now()}});
      else{
        await page.locator('.theme-option').filter({has:page.locator('b',{hasText:new RegExp('^'+({quota:'Quota',codex:'Codex',claude:'Claude',vscode:'VS Code',github:'GitHub'}[theme])+'(?: · 默认)?$')})}).click();
        await page.locator('.appearance-settings').getByRole('tab',{name:mode==='light'?'浅色':'深色',exact:true}).click();
      }
      await page.waitForFunction(([theme,mode])=>document.documentElement.dataset.colorTheme===theme&&document.documentElement.dataset.colorMode===mode&&document.documentElement.dataset.nativeGlass==='on',[theme,mode]);await pause(250);
      const toolbar=page.locator('.workspace-toolbar');
      const sample=await toolbar.evaluate(e=>{const r=e.getBoundingClientRect(),c=document.createElement('canvas'),ctx=c.getContext('2d');ctx.fillStyle=getComputedStyle(e).backgroundColor;ctx.fillRect(0,0,1,1);return {point:{x:r.left+r.width*.45,y:r.top+r.height*.5},fill:[...ctx.getImageData(0,0,1,1).data]};});
      const visible=await pixels(page,sample.point);
      let background;
      await toolbar.evaluate(e=>e.style.visibility='hidden');
      try{background=await pixels(page,sample.point);}finally{await toolbar.evaluate(e=>e.style.removeProperty('visibility'));}
      const expectedAlpha=Math.round(background.rgba[3]+sample.fill[3]*(1-background.rgba[3]/255));
      const result={theme,mode,actualAlpha:visible.rgba[3],backgroundAlpha:background.rgba[3],fillAlpha:sample.fill[3],expectedAlpha,error:Math.abs(visible.rgba[3]-expectedAlpha)};
      evidence.cases.push(result);fs.writeFileSync(path.join(out,theme+'-'+mode+'.png'),visible.png);
      assert(result.error<=2,'unexpected rectangular backdrop opacity: '+JSON.stringify(result));
      assert.equal(await toolbar.evaluate(e=>getComputedStyle(e).backdropFilter),'none');
      assert(await page.locator('.sidebar,.app .seg').evaluateAll(nodes=>nodes.every(e=>getComputedStyle(e).backdropFilter==='none')));
      assert.equal(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
    }
    // Hover/click must light only the rounded rim, without painting a box in
    // the clear centre or the area outside the top-left corner's curve.
    await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});
    if(native)await invoke('show_main_window',{});
    await page.waitForFunction(()=>document.hasFocus()&&!document.hidden);
    evidence.pointerContext=await page.evaluate(()=>({focused:document.hasFocus(),hidden:document.hidden,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,theme:document.documentElement.dataset.colorTheme,mode:document.documentElement.dataset.colorMode}));
    const toolbar=page.locator('.workspace-toolbar');
    const points=await toolbar.evaluate(e=>{const r=e.getBoundingClientRect();return {centre:{x:r.left+r.width*.45,y:r.top+r.height*.5},corners:[{x:r.left+1,y:r.top+1},{x:r.right-2,y:r.top+1},{x:r.left+1,y:r.bottom-2},{x:r.right-2,y:r.bottom-2}],away:{x:r.left+r.width*.45,y:r.bottom+70}};});
    await page.mouse.move(points.away.x,points.away.y);await pause(300);
    const idleCentre=await pixels(page,points.centre),idleCorners=[];
    for(const point of points.corners)idleCorners.push((await pixels(page,point)).rgba);
    evidence.pointer=[];
    for(const state of ['hover','click','leave']){
      if(state==='hover')await page.mouse.move(points.centre.x,points.centre.y);
      if(state==='click')await page.mouse.click(points.centre.x,points.centre.y);
      if(state==='leave')await page.mouse.move(points.away.x,points.away.y);
      await pause(300);
      await page.waitForFunction(state=>{const opacity=Number(getComputedStyle(document.querySelector('.workspace-toolbar'),'::after').opacity);return state==='leave'?opacity===0:opacity>.99;},state);
      const centre=await pixels(page,points.centre),corners=[];
      for(const point of points.corners)corners.push((await pixels(page,point)).rgba);
      const delta=(a,b)=>Math.max(...a.map((value,i)=>Math.abs(value-b[i])));
      const result={state,centreDelta:delta(centre.rgba,idleCentre.rgba),cornerDeltas:corners.map((rgba,i)=>delta(rgba,idleCorners[i])),glow:await toolbar.evaluate(e=>getComputedStyle(e,'::after').opacity),radius:await toolbar.evaluate(e=>getComputedStyle(e,'::after').borderRadius)};
      evidence.pointer.push(result);fs.writeFileSync(path.join(out,'pointer-'+state+'.png'),centre.png);
      assert(result.centreDelta<=2&&result.cornerDeltas.every(value=>value<=2),'pointer must not paint a rectangular overlay: '+JSON.stringify(result));
      assert(result.radius!=='0px','rim must follow the surface corner radius');
      assert(state==='leave'?Number(result.glow)===0:Number(result.glow)>0,'pointer rim state must be exercised');
    }
    const frame=native?await invoke('get_main_window_state'):null;
    const outer=await page.locator('.app').evaluate(e=>({radius:getComputedStyle(e).borderRadius,shape:e.getAttribute('data-window-shape'),points:[{x:3,y:3},{x:innerWidth-4,y:3},{x:3,y:innerHeight-4},{x:innerWidth-4,y:innerHeight-4}]}));
    const outerAlphas=[];
    for(const point of outer.points)outerAlphas.push((await pixels(page,point)).rgba[3]);
    evidence.outerFrame={nativeState:frame,radius:outer.radius,shape:outer.shape,rendererCornerAlphas:outerAlphas};
    if(!frame?.square){assert.notEqual(outer.radius,'0px');assert(outerAlphas.every(alpha=>alpha===0),'floating main must not paint square outer corners');}
    await page.emulateMedia({forcedColors:'active'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='off');assert.notEqual(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
    await page.emulateMedia({forcedColors:'none'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');
    await toggle.click();await page.waitForFunction(()=>document.documentElement.dataset.glass==='off'&&document.documentElement.dataset.nativeGlass==='off');assert.notEqual(await page.locator('body').evaluate(e=>getComputedStyle(e).backgroundColor),'rgba(0, 0, 0, 0)');
    assert.deepEqual(errors,[]);evidence.passed=true;evidence.runtime=browser.version();console.log('PASS single tint composition in ten theme/mode cases, native transparency, off and high-contrast recovery');
  }finally{fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify(evidence,null,2));await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1});
