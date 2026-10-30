// Real Rust + bundled WebView, using an empty isolated profile only. Gate the
// success callback of one production interaction; never fabricate its result.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
async function main(){
 const root=process.env.QUOTA_NATIVE_DATA;assert(root&&path.isAbsolute(root));
 const config=JSON.parse(fs.readFileSync(path.join(root,'config.json'),'utf8'));assert.equal(config.accounts.length,0);assert.equal(config.settings.ladderAutoUpdate,false);
 const output=path.join(root,'widget-reset-evidence.json');fs.rmSync(output,{force:true});
 const browser=await chromium.connectOverCDP(process.env.QUOTA_CDP_URL||'http://127.0.0.1:9237');let invoke,isolated=false;const cases=[];
 try{
  const pages=browser.contexts().flatMap(c=>c.pages()),main=pages.find(p=>/^http:\/\/tauri.localhost\/$/.test(p.url())),widget=pages.find(p=>p.url().includes('window=usage-widget'));assert(main&&widget);
  invoke=(name,args)=>main.evaluate(([name,args])=>window.__TAURI_INTERNALS__.invoke(name,args),[name,args]);
  const info=await invoke('app_info');assert.equal(path.resolve(info.configDir).toLowerCase(),path.resolve(root).toLowerCase(),'CDP must target the explicitly isolated profile');isolated=true;
  const state=()=>widget.locator('.usage-widget').evaluate(e=>({expanded:e.classList.contains('is-expanded'),nativeExpanded:e.classList.contains('native-expanded'),left:e.classList.contains('side-left')}));
  for(const kind of ['disable','side-change','position-change','new-hover']){
   await invoke('save_widget_options',{options:{enabled:true,side:'right',heightPercent:50}});await widget.reload();await widget.locator('.widget-handle').waitFor();await widget.waitForTimeout(250);
   await widget.mouse.move(-10,-10);await widget.locator('.usage-widget').dispatchEvent('keydown',{key:'Escape'});await widget.waitForFunction(()=>!document.querySelector('.usage-widget').classList.contains('native-expanded'));
   await widget.evaluate(()=>{
    const callbacks=window.__TAURI_INTERNALS__.callbacks,originalSet=callbacks.set;window.resetProbe={registered:0};
    callbacks.set=function(id,callback){window.resetProbe.registered++;return originalSet.call(this,id,window.resetProbe.registered===1?data=>{window.resetProbe.completed=true;window.resetProbe.release=()=>callback(data);}:callback);};
    try{document.querySelector('.widget-handle').dispatchEvent(new MouseEvent('mouseover',{bubbles:true}));}finally{delete callbacks.set;}
   });
   await widget.waitForFunction(()=>window.resetProbe.completed&&window.resetProbe.release);assert.equal(await widget.evaluate(()=>window.resetProbe.registered),2);
   const options={enabled:kind!=='disable',side:kind==='side-change'||kind==='new-hover'?'left':'right',heightPercent:kind==='position-change'?75:50};
   const saved=await invoke('save_widget_options',{options});await widget.waitForFunction(()=>!document.querySelector('.usage-widget').classList.contains('native-expanded'));const beforeAck=await state();
   if(kind==='new-hover')await widget.locator('.widget-handle').dispatchEvent('mouseover',{bubbles:true});
   await widget.evaluate(()=>window.resetProbe.release());
   if(kind==='new-hover')await widget.locator('.usage-widget.is-expanded.native-expanded.side-left').waitFor();
   const afterAck=await state(),expected=kind==='new-hover';
   const consistent=afterAck.expanded===expected&&afterAck.nativeExpanded===expected&&afterAck.left===(options.side==='left');
   cases.push({kind,saved,beforeAck,afterAck,consistent});assert(consistent,kind+' ignored the current settings/hover intent');
  }
  fs.writeFileSync(output,JSON.stringify({passed:true,kind:'real-rust-bundled-webview-synthetic-delayed-frontend-ack',profileConfirmed:true,synthetic:true,desktopCapture:false,cases},null,2));
  console.log(cases.map(row=>'PASS native '+row.kind+' supersedes an obsolete reply').join('\n'));
 }catch(error){fs.writeFileSync(output,JSON.stringify({passed:false,error:String(error),cases},null,2));throw error;}
 finally{if(isolated&&invoke)await invoke('save_widget_options',{options:{enabled:false,side:'right',heightPercent:50}}).catch(()=>{});await browser.close();}
}
main().catch(error=>{console.error(error);process.exit(1);});
