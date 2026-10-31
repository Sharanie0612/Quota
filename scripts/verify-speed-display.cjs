// Synthetic, frozen calls isolate display changes from the five-second data poll.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/',out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/speed-display');
const settle=async page=>{await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.waitForTimeout(140);};
async function state(page){return page.locator('.speed-call-canvas canvas').evaluate(canvas=>{
  const rect=canvas.getBoundingClientRect(),context=document.createElement('canvas').getContext('2d');context.strokeStyle=getComputedStyle(canvas).color;
  const pixel=color=>{context.fillStyle=color;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];},actualInk=pixel(window.speedDisplayProbe.lastStroke),expectedInk=pixel(context.strokeStyle),inkDifference=Math.max(...actualInk.map((v,i)=>Math.abs(v-expectedInk[i])));
  const marker=document.querySelector('.speed-call-canvas svg circle');
  return {ratio:devicePixelRatio,resolutionMatches:matchMedia(`(resolution: ${devicePixelRatio}dppx)`).matches,mediaEvents:window.speedMediaEvents,width:canvas.width,height:canvas.height,cssWidth:Math.round(rect.width),cssHeight:Math.round(rect.height),expectedStroke:context.strokeStyle,actualInk,expectedInk,inkDifference,...window.speedDisplayProbe,marker:marker?{x:Number(marker.getAttribute('cx')),y:Number(marker.getAttribute('cy'))}:null,calls:Number(document.querySelector('.speed-plot').dataset.callCount),mode:document.documentElement.dataset.colorMode};
});}
async function main(){
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),rows=[],errors=[];
  try{
    for(const glass of [false,true]){
      const page=await browser.newPage({viewport:{width:1360,height:1000},deviceScaleFactor:1,locale:'zh-CN',timezoneId:'Asia/Shanghai',colorScheme:'light',reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
      if(process.env.QUOTA_SPEED_BASELINE_JS)await page.route('**/assets/index-*.js',route=>route.fulfill({path:path.resolve(process.env.QUOTA_SPEED_BASELINE_JS),contentType:'application/javascript'}));
      await page.addInitScript(glass=>{window.demoAppearance={theme:'quota',mode:'system',glass,collapsed:false,revision:Date.now()};localStorage.setItem('quota.appearance.v1',JSON.stringify(window.demoAppearance));window.speedDisplayProbe={strokes:0,lastStroke:''};const stroke=CanvasRenderingContext2D.prototype.stroke;CanvasRenderingContext2D.prototype.stroke=function(...args){if(this.canvas.matches('.speed-call-canvas canvas')){window.speedDisplayProbe.strokes++;window.speedDisplayProbe.lastStroke=this.strokeStyle;window.speedDisplayProbe.paintMode=document.documentElement.dataset.colorMode;window.speedDisplayProbe.paintCss=getComputedStyle(this.canvas).color;window.speedDisplayProbe.paintText=getComputedStyle(this.canvas).getPropertyValue('--text');}return stroke.apply(this,args);};},glass);
      await page.goto(base);await page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:'\u8f93\u51fa\u901f\u5ea6',exact:true}).click();await page.locator('.speed-plot').waitFor();await page.waitForFunction(()=>window.speedDisplayProbe.strokes>0);await page.keyboard.press('Tab');await page.locator('.speed-call-canvas svg').focus();await settle(page);
      await page.evaluate(()=>{const invoke=window.__TAURI_INTERNALS__.invoke;window.__TAURI_INTERNALS__.invoke=function(name,...args){if(name==='get_output_speed')return new Promise(()=>{});return invoke.call(this,name,...args);};window.speedMediaEvents=0;matchMedia('(resolution: 1dppx)').addEventListener('change',()=>window.speedMediaEvents++);});
      const initial=await state(page),cdp=await page.context().newCDPSession(page);
      for(const ratio of [2,1.5,1.25,1]){
        await cdp.send('Emulation.setDeviceMetricsOverride',{width:1360,height:1000,deviceScaleFactor:ratio,mobile:false});await page.waitForFunction(ratio=>devicePixelRatio===ratio,ratio);
        // CDP changes DPR without a native resolution event on this Edge build.
        await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await settle(page);
        const current=await state(page),crisp=Math.abs(current.width-Math.trunc(current.cssWidth*ratio))<=1&&Math.abs(current.height-Math.trunc(current.cssHeight*ratio))<=1;assert.deepEqual(current.marker,initial.marker);assert.equal(current.calls,initial.calls);rows.push({glass,kind:'DPR-resize-event',requested:ratio,passed:crisp,state:current});
      }
      for(const mode of ['dark','light']){
        await page.emulateMedia({colorScheme:mode});await page.waitForFunction(mode=>document.documentElement.dataset.colorMode===mode,mode);await settle(page);let current=await state(page);rows.push({glass,kind:'system-'+mode,passed:current.inkDifference<=1,state:current});
        for(const active of [true,false]){
          await page.emulateMedia({forcedColors:active?'active':'none'});await settle(page);current=await state(page);assert.equal(current.calls,initial.calls);assert.deepEqual(current.marker,initial.marker);rows.push({glass,kind:mode+'-contrast-'+active,passed:current.inkDifference<=1,state:current});
          if(active&&glass)await page.screenshot({path:path.join(out,'contrast-'+mode+'.png'),animations:'disabled'});
        }
      }
      const before=await state(page);await page.waitForTimeout(650);const after=await state(page);assert.equal(after.strokes,before.strokes,'display listeners must stay idle when nothing changes');
      await page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:'\u8bbe\u7f6e',exact:true}).click();await page.locator('.appearance-settings').waitFor();await page.evaluate(()=>window.dispatchEvent(new Event('resize')));await page.emulateMedia({forcedColors:'active'});await settle(page);assert.equal(await page.evaluate(()=>window.speedDisplayProbe.strokes),after.strokes,'unmounted chart must release its media and resize listeners');await cdp.detach();await page.close();
    }
    assert.deepEqual(errors,[]);const failures=rows.filter(row=>!row.passed);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:!failures.length,kind:'built-renderer-frozen-synthetic-calls-emulated-display',rows,failures},null,2));console.log(JSON.stringify({checks:rows.length,failures:failures.map(row=>({glass:row.glass,kind:row.kind,ratio:row.state.ratio,width:row.state.width,expectedWidth:row.state.cssWidth*row.state.ratio,stroke:row.state.lastStroke,expectedStroke:row.state.expectedStroke}))}));if(!process.env.QUOTA_SPEED_DISPLAY_AUDIT_ONLY)assert.equal(failures.length,0);
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
