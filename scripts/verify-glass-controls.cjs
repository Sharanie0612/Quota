// Focus-ring and hover-text contrast on controlled native-tint backdrops.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/',out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-controls');
const native=fs.readFileSync(path.join(__dirname,'../src-tauri/src/appearance.rs'),'utf8').match(/let tint = if dark\s*\{\(([^)]+)\)\}\s*else\s*\{\(([^)]+)\)\}/);
const fixtures=fs.readFileSync(path.join(__dirname,'verify-usage-workbench.cjs'),'utf8').match(/function fixtures\(\)\{[\s\S]*?\n\}/)[0];
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const ratio=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const views=[['\u8bbe\u7f6e','.appearance-settings',[
 ['sync','.workspace-sync','hover'],['sync','.workspace-sync','focus'],['theme','.theme-option[aria-pressed="true"]','focus'],['sidebar','.sidebar-toggle','focus'],['close','.window-close','focus']]],
 ['\u6211\u7684\u4f7f\u7528','.usage-kpis',[
 ['vendor','.usage-vendor-link','hover'],['usage-tab','.usage-view-tabs [role="tab"][aria-selected="true"]','focus'],['usage-plot','.usage-analysis-plot svg','focus']]],
 ['AI \u6a21\u578b','.scatter-point',[
 ['model-legend','.scatter-legend button','focus']]],
 ['\u8f93\u51fa\u901f\u5ea6','.speed-plot',[
 ['speed-legend','.speed-legend button','hover'],['speed-legend','.speed-legend button','focus'],['speed-plot','.speed-plot svg','focus']]],
 ['Token \u6d3b\u52a8','#activity-charts',[
 ['activity-format','.activity-number-format','focus']]]];
const backgrounds={black:'#000',white:'#fff',blue:'#163b69',mixed:'linear-gradient(135deg,#204f72,#eac5ad 40%,#456858 75%,#ededed)'};
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),rows=[],errors=[];
 try{
  for(const theme of ['quota','codex','claude','vscode','github'])for(const mode of ['light','dark']){
   const page=await browser.newPage({viewport:{width:1360,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:mode,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript('('+fixtures+')();window.demoNativeGlass=true;window.demoAppearance='+JSON.stringify({theme,mode,glass:true,collapsed:false,revision:Date.now()})+';localStorage.setItem("quota.appearance.v1",JSON.stringify(window.demoAppearance));');await page.goto(base);await page.addStyleTag({content:'*,*::before,*::after{transition:none!important;animation:none!important}'});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');await page.locator('.workspace-usage strong').filter({hasNotText:'\u2014'}).waitFor();
   await page.evaluate(()=>{const el=document.createElement('div');el.id='controls-backdrop';el.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none';document.body.prepend(el);});
   for(const [label,ready,cases] of views){
    await page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:label,exact:true}).click();await page.locator(ready).first().waitFor();
    for(const [background,css] of Object.entries(backgrounds)){
     const [r,g,b,a]=native[mode==='dark'?1:2].split(',').map(Number);await page.locator('#controls-backdrop').evaluate((el,background)=>el.style.background=background,`linear-gradient(rgba(${r},${g},${b},${a/255}),rgba(${r},${g},${b},${a/255})),${css}`);
     for(const [name,selector,state] of cases){
      const el=page.locator(selector).first();await page.evaluate(()=>document.activeElement?.blur());await page.mouse.move(-10,-10);await el.scrollIntoViewIfNeeded();
      if(state==='focus'){await page.keyboard.press('Tab');await el.focus();assert(await el.evaluate(e=>e.matches(':focus-visible')));}else await el.hover();
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      const sample=await el.evaluate((e,state)=>{const style=getComputedStyle(e),rect=e.getBoundingClientRect(),c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d');ctx.fillStyle=state==='focus'?style.outlineColor:style.color;ctx.fillRect(0,0,1,1);const fg=[...ctx.getImageData(0,0,1,1).data],width=parseFloat(style.outlineWidth),offset=parseFloat(style.outlineOffset);if(state==='hover')e.classList.add('controls-hide-text');return {fg,width,outline:style.outlineStyle,x:Math.floor(state==='focus'?(offset<0?rect.left-offset+width+1:rect.left-offset-width-1):rect.left+rect.width/2),y:Math.floor(rect.top+rect.height/2)};},state);
      const hide=await page.addStyleTag({content:'.controls-hide-text,.controls-hide-text *{color:transparent!important;-webkit-text-fill-color:transparent!important;fill:transparent!important;stroke:transparent!important}'});const png=await page.screenshot({animations:'disabled'});
      const bg=await page.evaluate(async({png,sample})=>{const im=await createImageBitmap(new Blob([Uint8Array.from(atob(png),v=>v.charCodeAt(0))],{type:'image/png'})),c=document.createElement('canvas');c.width=im.width;c.height=im.height;const ctx=c.getContext('2d');ctx.drawImage(im,0,0);return [...ctx.getImageData(sample.x,sample.y,1,1).data];},{png:png.toString('base64'),sample});await hide.evaluate(e=>e.remove());await el.evaluate(e=>e.classList.remove('controls-hide-text'));
      const alpha=sample.fg[3]/255,fg=sample.fg.slice(0,3).map((v,i)=>v*alpha+bg[i]*(1-alpha));rows.push({theme,mode,view:label,name,state,background,...sample,bg,ratio:ratio(fg,bg),minimum:state==='focus'?3:4.5});
     }
    }
   }
   await page.close();
  }
  assert.deepEqual(errors,[]);const failures=rows.filter(r=>r.ratio<r.minimum||(r.state==='focus'&&(r.width<2||r.outline==='none')));fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:!failures.length,kind:'built-renderer-control-states-native-tint-simulation',samples:rows.length,failures,rows},null,2));console.log(JSON.stringify({samples:rows.length,failures:failures.length,first:failures.slice(0,12)}));if(!process.env.QUOTA_CONTROLS_AUDIT_ONLY)assert.equal(failures.length,0);
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
