// Installed, empty-profile Win32 lifecycle evidence. This is not a DWM screenshot.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const root=process.env.QUOTA_NATIVE_DATA;assert(root&&path.isAbsolute(root));
 const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(config.accounts.length,0);assert.equal(config.settings.ladderAutoUpdate,false);
 const out=path.join(root,'native-chrome-evidence.json'),cases=[];
 const browser=await chromium.connectOverCDP(process.env.QUOTA_CDP_URL||'http://127.0.0.1:9237');let invoke,original,isolated=false;
 try{
  let page,widget;for(let n=0;n<100;n++){const pages=browser.contexts().flatMap(c=>c.pages());page=pages.find(p=>/^http:\/\/tauri.localhost\/$/.test(p.url()));widget=pages.find(p=>p.url().includes('window=usage-widget'));if(page&&widget)break;await new Promise(resolve=>setTimeout(resolve,100));}assert(page&&widget);
  invoke=(name,args)=>page.evaluate(([name,args])=>window.__TAURI_INTERNALS__.invoke(name,args),[name,args]);
  const info=await invoke('app_info');assert.equal(path.resolve(info.configDir).toLowerCase(),path.resolve(root).toLowerCase());isolated=true;
  assert.equal((await widget.evaluate(()=>window.__TAURI_INTERNALS__.invoke('app_info'))).configDir.toLowerCase(),info.configDir.toLowerCase());
  assert(await widget.evaluate(()=>window.__TAURI_INTERNALS__.invoke('get_main_window_chrome').then(()=>false,()=>true)),'widget cannot control or query main chrome');
  original=await invoke('get_appearance');const before=await invoke('get_main_window_chrome');assert(before.installed,'guard must exist on the first renderer call');
  if((await invoke('get_main_window_state')).maximized)await invoke('plugin:window|toggle_maximize',{label:'main'});
  for(const glass of [false,true])for(const mode of ['light','dark']){
   await invoke('save_appearance',{preferences:{...original,glass,mode,revision:Date.now()+1}});
   await page.waitForFunction(([glass,mode])=>document.documentElement.dataset.material===(glass?'frosted':'solid')&&document.documentElement.dataset.colorMode===mode,[glass,mode]);
   await invoke('plugin:window|hide',{label:'main'});assert.equal(await invoke('plugin:window|is_visible',{label:'main'}),false);
   await invoke('show_main_window',{});assert.equal(await invoke('plugin:window|is_visible',{label:'main'}),true);
   await invoke('plugin:window|minimize',{label:'main'});assert.equal(await invoke('plugin:window|is_minimized',{label:'main'}),true);
   await invoke('show_main_window',{});assert.equal(await invoke('plugin:window|is_minimized',{label:'main'}),false);
   const outer=await invoke('plugin:window|outer_size',{label:'main'}),inner=await invoke('plugin:window|inner_size',{label:'main'}),origin=await invoke('plugin:window|outer_position',{label:'main'}),client=await invoke('plugin:window|inner_position',{label:'main'});
   assert.deepEqual(inner,outer,'no caption height or thick border inset');assert.deepEqual(client,origin,'client begins at custom frame origin');
   const chrome=await invoke('get_main_window_chrome');assert(chrome.installed);cases.push({glass,mode,outer,inner,origin,client,chrome});
  }
  const after=await invoke('get_main_window_chrome');assert(after.safeActivationForwards>before.safeActivationForwards,'actual native lifecycle must pass through guard');
  const result={passed:true,kind:'native-subclass-and-window-lifecycle',profileConfirmed:true,desktopCapture:false,manualWindowInput:false,before,after,cases};fs.writeFileSync(out,JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,cases:cases.length,before,after}));
 }catch(error){fs.writeFileSync(out,JSON.stringify({passed:false,error:String(error),cases},null,2));throw error;}
 finally{if(isolated&&invoke&&original)await invoke('save_appearance',{preferences:{...original,revision:Date.now()+2}}).catch(()=>{});await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1);});
