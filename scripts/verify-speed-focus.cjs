// Real pointer and Tab focus; synthetic preview data only.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/',out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/speed-focus');
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
async function main(){
  fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true}),rows=[],errors=[];
  try{
    for(const theme of ['quota','codex','claude','vscode','github'])for(const mode of ['light','dark'])for(const glass of [false,true]){
      const width=mode==='light'?1024:1360,page=await browser.newPage({viewport:{width,height:1000},colorScheme:mode,reducedMotion:'reduce',locale:'zh-CN',timezoneId:'Asia/Shanghai'});page.on('pageerror',e=>errors.push(e.message));
      await page.addInitScript(({theme,mode,glass})=>{window.demoAppearance={theme,mode,glass,reduceEffects:false,collapsed:false,revision:Date.now()};localStorage.setItem('quota.appearance.v1',JSON.stringify(window.demoAppearance));},{theme,mode,glass});
      await page.goto(base);const nav=page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:'\u8f93\u51fa\u901f\u5ea6',exact:true});await nav.click();const svg=page.locator('.speed-call-canvas svg');await svg.waitFor();
      for(const forced of [false,true]){
        await page.emulateMedia({forcedColors:forced?'active':'none'});
        for(const input of ['mouse','keyboard']){
          await nav.click();await svg.click({position:{x:20,y:20}});if(input==='keyboard'){await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');}await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
          const state=await svg.evaluate(e=>{const s=getComputedStyle(e),r=e.getBoundingClientRect(),width=parseFloat(s.outlineWidth),offset=parseFloat(s.outlineOffset);return {focused:document.activeElement===e,visible:e.matches(':focus-visible'),style:s.outlineStyle,width,offset,left:r.left,y:Math.floor(r.top+r.height/2),backgroundX:Math.floor(r.left-Math.max(10,offset+width+3))};});
          const png=await page.screenshot({animations:'disabled'}),pixels=await page.evaluate(async({png,state})=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const context=canvas.getContext('2d');context.drawImage(image,0,0);const at=x=>[...context.getImageData(x,state.y,1,1).data];return {background:at(state.backgroundX),ring:Array.from({length:5},(_,i)=>at(Math.floor(state.left-state.offset-Math.max(1,state.width/2))+i-2)),edge:[-2,-1,0,1].map(dx=>at(Math.floor(state.left)+dx))};},{png:png.toString('base64'),state});
          const peakContrast=Math.max(...pixels.ring.map(pixel=>contrast(pixel,pixels.background))),edgeDifference=Math.max(...pixels.edge.flatMap(pixel=>pixel.slice(0,3).map((v,i)=>Math.abs(v-pixels.background[i]))));
          const passed=state.focused&&(input==='keyboard'?state.visible&&state.style==='solid'&&state.width>=2&&peakContrast>=3:!state.visible&&state.style==='none'&&edgeDifference<=4);rows.push({theme,mode,glass,width,forced,input,passed,...state,peakContrast,edgeDifference,...pixels});
          if(theme==='quota'&&glass&&forced)fs.writeFileSync(path.join(out,mode+'-'+input+'.png'),png);
        }
      }
      await page.close();
    }
    assert.deepEqual(errors,[]);const failures=rows.filter(row=>!row.passed);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:!failures.length,kind:'synthetic-renderer-real-mouse-and-Tab-focus',rows,failures},null,2));console.log(JSON.stringify({checks:rows.length,failures:failures.length,first:failures.slice(0,6).map(r=>({theme:r.theme,mode:r.mode,glass:r.glass,forced:r.forced,input:r.input,style:r.style,visible:r.visible,peakContrast:r.peakContrast,edgeDifference:r.edgeDifference}))}));if(!process.env.QUOTA_SPEED_FOCUS_AUDIT_ONLY)assert.equal(failures.length,0);
  }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
