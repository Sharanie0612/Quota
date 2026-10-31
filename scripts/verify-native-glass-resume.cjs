// Isolated installed-app lifecycle/IPC checks, not manual pointer or DWM QA.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const root=process.env.QUOTA_NATIVE_DATA;assert(root&&path.isAbsolute(root));const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(config.accounts.length,0);assert.equal(config.settings.ladderAutoUpdate,false);
 const output=path.join(root,'glass-resume-evidence.json');fs.rmSync(output,{force:true});const cases=[];
 const browser=await chromium.connectOverCDP(process.env.QUOTA_CDP_URL||'http://127.0.0.1:9237');let invoke,original,isolated=false;
 try{
  let page;for(let n=0;n<100;n++){page=browser.contexts().flatMap(c=>c.pages()).find(p=>/^http:\/\/tauri.localhost\/$/.test(p.url()));if(page)break;await new Promise(resolve=>setTimeout(resolve,50));}assert(page);
  invoke=(name,args)=>page.evaluate(([name,args])=>window.__TAURI_INTERNALS__.invoke(name,args),[name,args]);const info=await invoke('app_info');assert.equal(path.resolve(info.configDir).toLowerCase(),path.resolve(root).toLowerCase());isolated=true;
  original=await invoke('get_appearance');const save=glass=>invoke('save_appearance',{preferences:{...original,mode:'light',glass,revision:Date.now()+1}});
  await page.emulateMedia({reducedMotion:'no-preference',forcedColors:'none'});await save(true);await invoke('show_main_window',{});await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on');await page.locator('.launch-screen').waitFor({state:'detached'});
  const button=page.locator('.workspace-toolbar button').first(),state=()=>button.evaluate(e=>{const host=e.closest('.workspace-toolbar'),a=e.getBoundingClientRect(),b=host.getBoundingClientRect();return{documentFocused:document.hasFocus(),hidden:document.hidden,focused:document.activeElement===e,keyboard:e.matches(':focus-visible'),glow:host.style.getPropertyValue('--glass-glow'),x:host.style.getPropertyValue('--glass-x'),expectedX:a.left+a.width/2-b.left,opacity:Number(getComputedStyle(host,'::after').opacity)};});
  const wait=async predicate=>{for(let n=0;n<100;n++){const current=await state();if(predicate(current))return current;await new Promise(resolve=>setTimeout(resolve,50));}assert.fail('Native focus state did not settle: '+JSON.stringify(await state()));};
  for(const kind of ['native-hide-show','reduced-motion','forced-colors','saved-glass-toggle']){
   await invoke('show_main_window',{});await wait(s=>s.documentFocused);await page.getByRole('navigation').getByRole('button').first().focus();await page.keyboard.press('Tab');await button.focus();const before=await wait(s=>s.focused&&s.keyboard&&s.glow==='1'&&s.opacity>.98);
   if(kind==='native-hide-show')await invoke('plugin:window|hide',{label:'main'});
   if(kind==='reduced-motion')await page.emulateMedia({reducedMotion:'reduce'});
   if(kind==='forced-colors')await page.emulateMedia({forcedColors:'active'});
   if(kind==='saved-glass-toggle')await save(false);
   // WebView2 can retain document focus/visibility while its HWND is hidden.
   // Verify native visibility independently instead of inventing a DOM blur.
   const paused=kind==='native-hide-show'?await state():await wait(s=>s.x==='');
   if(kind==='native-hide-show'){assert.equal(await invoke('plugin:window|is_visible',{label:'main'}),false);await invoke('show_main_window',{});assert.equal(await invoke('plugin:window|is_visible',{label:'main'}),true);await wait(s=>s.documentFocused);}
   if(kind==='reduced-motion')await page.emulateMedia({reducedMotion:'no-preference'});
   if(kind==='forced-colors')await page.emulateMedia({forcedColors:'none'});
   if(kind==='saved-glass-toggle')await save(true);
   await page.waitForTimeout(300);const resumed=await state(),retained=resumed.focused&&resumed.keyboard;
   const correct=retained?resumed.glow==='1'&&resumed.opacity>.98&&Math.abs(parseFloat(resumed.x)-resumed.expectedX)<1:resumed.x==='';
   cases.push({kind,before,paused,resumed,focusRetained:retained,nativeVisibilityVerified:kind==='native-hide-show',webviewPauseObserved:paused.x==='',correct});
  }
  const result={passed:cases.every(row=>row.correct),kind:'native-window-IPC-and-WebView-media-focus-recovery',profileConfirmed:true,desktopCapture:false,manualWindowInput:false,cases};fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:result.passed,cases:cases.map(row=>({kind:row.kind,focusRetained:row.focusRetained,correct:row.correct}))},null,2));
  if(process.env.QUOTA_GLASS_RESUME_AUDIT_ONLY!=='1')assert(result.passed,'native retained keyboard focus must regain its light');
 }catch(error){if(!fs.existsSync(output))fs.writeFileSync(output,JSON.stringify({passed:false,error:String(error),cases},null,2));throw error;}
 finally{if(isolated&&invoke&&original){await invoke('show_main_window',{}).catch(()=>{});await invoke('save_appearance',{preferences:{...original,revision:Date.now()+2}}).catch(()=>{});}await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1);});
