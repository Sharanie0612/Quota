// Text contrast on controlled backdrops, using the built renderer and the
// native tint configured in Rust. This does not capture the user's desktop.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.QUOTA_PLAYWRIGHT_MODULE||'playwright');
const base=process.env.QUOTA_PREVIEW_URL||'http://127.0.0.1:4187/',out=path.resolve(process.env.QUOTA_UI_OUTPUT||'target/glass-contrast');
const source=fs.readFileSync(path.join(__dirname,'../src-tauri/src/appearance.rs'),'utf8');
const tint=source.match(/let tint = if dark\s*\{\(([^)]+)\)\}\s*else\s*\{\(([^)]+)\)\}/);assert(tint,'explicit native tint');
const native={dark:tint[1].split(',').map(Number),light:tint[2].split(',').map(Number)};
const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const themes=['Quota','Codex','Claude','VS Code','GitHub'],modes=[['light','\u6d45\u8272'],['dark','\u6df1\u8272']];
const backgrounds={black:'#000',white:'#fff',blue:'#163b69',mixed:'linear-gradient(135deg,#204f72,#eac5ad 40%,#456858 75%,#ededed)'};
const views=[['settings','\u8bbe\u7f6e','.appearance-settings'],['usage','\u6211\u7684\u4f7f\u7528','.usage-kpis'],['accounts','\u8d26\u6237\u603b\u89c8','.account-card'],['models','AI \u6a21\u578b','.scatter-point'],['activity','Token \u6d3b\u52a8','#activity-charts'],['speed','\u8f93\u51fa\u901f\u5ea6','.speed-plot'],['account-form','\u8d26\u6237\u603b\u89c8','dialog[open] .modal'],['widget','','.task-row'],['widget-error','','.live-model-phase']];
const steady='*,*::before,*::after{transition:none!important;animation:none!important}';
async function main(){
 fs.mkdirSync(out,{recursive:true});const browser=await chromium.launch({executablePath:process.env.QUOTA_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});const rows=[],errors=[],settleRetries=[];
 try{
  for(const theme of themes.filter(theme=>!process.env.QUOTA_CONTRAST_THEME||theme===process.env.QUOTA_CONTRAST_THEME))for(const [mode,modeLabel] of modes.filter(([mode])=>!process.env.QUOTA_CONTRAST_MODE||mode===process.env.QUOTA_CONTRAST_MODE)){
   const page=await browser.newPage({viewport:{width:1360,height:1000},locale:'zh-CN',colorScheme:mode,reducedMotion:'reduce'});page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(()=>{window.demoNativeGlass=true;window.demoAppearance=JSON.parse(localStorage.getItem('quota.appearance.v1')||'null');});await page.goto(base);
   // Sample settled foregrounds: hiding text must not start color transitions
   // which would make the next backdrop appear to have transparent text.
   await page.addStyleTag({content:steady});
   const go=async label=>page.getByRole('navigation',{name:'\u4e3b\u5bfc\u822a'}).getByRole('button',{name:label,exact:true}).click();await go('\u8bbe\u7f6e');
   await page.locator('.appearance-settings').getByRole('button',{name:new RegExp('^'+theme)}).click();await page.locator('.appearance-settings').getByRole('tab',{name:modeLabel,exact:true}).click();await page.getByRole('button',{name:'\u6db2\u6001\u73bb\u7483',exact:true}).click();await page.waitForFunction(()=>document.documentElement.dataset.nativeGlass==='on'&&getComputedStyle(document.body).backgroundColor==='rgba(0, 0, 0, 0)');
   await page.evaluate(()=>{const plane=document.createElement('div');plane.id='contrast-backdrop';plane.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none';document.body.prepend(plane);});
   const selected=process.env.QUOTA_CONTRAST_VIEW?views.filter(([view])=>view===process.env.QUOTA_CONTRAST_VIEW):process.env.QUOTA_CONTRAST_SCOPE==='primary'?views.slice(0,2):process.env.QUOTA_CONTRAST_SCOPE==='widget'?views.filter(([view])=>view.startsWith('widget')):views;
   for(const [view,label,ready] of selected){
    if(view.startsWith('widget')){
     await page.setViewportSize({width:324,height:276});await page.goto(base+'?window=usage-widget&widgetLiveCase='+(view==='widget'?'multiple':'error'));await page.addStyleTag({content:steady});await page.locator('.widget-value strong').filter({hasNotText:'\u2014'}).waitFor();await page.locator('.live-model-phase').filter({hasNotText:'\u6b63\u5728\u8fde\u63a5'}).waitFor();await page.mouse.move(-10,-10);await page.locator('.widget-handle').hover();await page.locator('.is-expanded').waitFor();assert.notEqual(await page.locator('html').getAttribute('data-native-glass'),'on');
     await page.evaluate(()=>{const plane=document.createElement('div');plane.id='contrast-backdrop';plane.style.cssText='position:fixed;inset:0;z-index:-1;pointer-events:none';document.body.prepend(plane);});
    }else{await go(label);if(view==='account-form')await page.getByRole('button',{name:'\u6dfb\u52a0\u8d26\u6237',exact:true}).click();}
    await page.locator(ready).first().waitFor();await page.evaluate(()=>document.fonts.ready);
    for(const [background,css] of Object.entries(backgrounds)){
     for(let attempt=0;attempt<3;attempt++){
     const [r,g,b,a]=native[mode];await page.locator('#contrast-backdrop').evaluate((el,value)=>{el.style.background=value;},view.startsWith('widget')?css:`linear-gradient(rgba(${r},${g},${b},${a/255}),rgba(${r},${g},${b},${a/255})),${css}`);
     await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
     const samples=await page.evaluate(()=>{
      const result=[],probes=[],canvas=document.createElement('canvas');canvas.width=canvas.height=1;const ctx=canvas.getContext('2d');
      const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
      const root=document.querySelector('dialog[open]')||document.querySelector('.app')||document.querySelector('.usage-widget');
      const visible=box=>box.width>=1&&box.height>=1&&box.top>=0&&box.bottom<=innerHeight&&box.left>=0&&box.right<=innerWidth;
      const clipped=(el,box)=>{for(let parent=el.parentElement;parent;parent=parent.parentElement){const style=getComputedStyle(parent),rect=parent.getBoundingClientRect();if(/hidden|auto|scroll|clip/.test(style.overflowY)&&(box.top<rect.top-1||box.bottom>rect.bottom+1))return true;if(/hidden|auto|scroll|clip/.test(style.overflowX)&&(box.left<rect.left-1||box.right>rect.right+1))return true;}return false;};
      const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
       const text=walker.currentNode,textValue=text.textContent.trim(),el=text.parentElement;if(!textValue||!el||el.closest('.brand,[aria-hidden="true"],script,style,button:disabled,select:disabled,input:disabled'))continue;
       const style=getComputedStyle(el);if(style.visibility==='hidden'||style.display==='none')continue;
       const range=document.createRange();range.selectNodeContents(text);const box=range.getBoundingClientRect();if(!visible(box)||clipped(el,box))continue;
       let opacity=1;for(let parent=el;parent;parent=parent.parentElement)opacity*=Number(getComputedStyle(parent).opacity);if(opacity<.01)continue;
       const rgba=color(el.namespaceURI?.includes('svg')?style.fill:style.color);rgba[3]*=opacity;
       const font=Number.parseFloat(style.fontSize),large=font>=24||(font>=18.66&&Number(style.fontWeight)>=700);
       const x=Math.floor(box.left+box.width/2),y=Math.floor(box.top+box.height/2);result.push({text:textValue.slice(0,60),selector:el.tagName.toLowerCase()+'.'+[...el.classList].join('.'),foreground:rgba,x,y,minimum:large?3:4.5});probes.push({node:text,x,y});el.dataset.contrastHide='true';
      }
      for(const el of root.querySelectorAll('input:not(:disabled),textarea:not(:disabled),select:not(:disabled)')){
       if(el.matches('[type="checkbox"],[type="radio"],[type="file"],[type="hidden"]'))continue;
       const box=el.getBoundingClientRect();if(!visible(box)||clipped(el,box))continue;
       const text=el instanceof HTMLSelectElement?el.selectedOptions[0]?.text:el.value||el.placeholder;if(!text)continue;
       const placeholder=!(el instanceof HTMLSelectElement)&&!el.value,style=getComputedStyle(el,placeholder?'::placeholder':null),rgba=color(style.color);rgba[3]*=Number(style.opacity);
       const x=Math.floor(box.left+box.width/2),y=Math.floor(box.top+box.height/2);result.push({text:text.slice(0,60),selector:el.tagName.toLowerCase()+'.'+[...el.classList].join('.')+(placeholder?'::placeholder':''),foreground:rgba,x,y,minimum:4.5});probes.push({node:el,x,y});el.dataset.contrastHide='true';
      }
      window.quotaContrastProbes=probes;
      const hide=document.createElement('style');hide.id='contrast-hide-style';hide.textContent='[data-contrast-hide="true"],[data-contrast-hide="true"] *,[data-contrast-hide="true"]::placeholder{color:transparent!important;-webkit-text-fill-color:transparent!important;fill:transparent!important;stroke:transparent!important;text-shadow:none!important;caret-color:transparent!important}';document.head.append(hide);return result;
     });
     const shot=await page.screenshot({animations:'disabled'});
     const stable=await page.evaluate(()=>window.quotaContrastProbes.every(({node,x,y})=>{if(!node.isConnected)return false;let box;if(node.nodeType===Node.TEXT_NODE){const range=document.createRange();range.selectNodeContents(node);box=range.getBoundingClientRect();}else box=node.getBoundingClientRect();return Math.abs(Math.floor(box.left+box.width/2)-x)<=1&&Math.abs(Math.floor(box.top+box.height/2)-y)<=1;}));
     if(process.env.QUOTA_CONTRAST_CAPTURE)fs.writeFileSync(path.join(out,`${theme}-${mode}-${view}-${background}-hidden.png`),shot);
     const colors=await page.evaluate(async ({png,samples})=>{const image=await createImageBitmap(new Blob([Uint8Array.from(atob(png),c=>c.charCodeAt(0))],{type:'image/png'})),c=document.createElement('canvas');c.width=image.width;c.height=image.height;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);return samples.map(s=>[...ctx.getImageData(s.x,s.y,1,1).data]);},{png:shot.toString('base64'),samples});
     await page.evaluate(()=>{document.getElementById('contrast-hide-style').remove();document.querySelectorAll('[data-contrast-hide]').forEach(el=>delete el.dataset.contrastHide);});
     if(!stable){settleRetries.push({theme,mode,view,background,attempt});assert(attempt<2,'content must settle before sampling the background at text coordinates');continue;}
     if(process.env.QUOTA_CONTRAST_CAPTURE)await page.screenshot({path:path.join(out,`${theme}-${mode}-${view}-${background}.png`),animations:'disabled'});
     samples.forEach((sample,i)=>{const bg=colors[i],alpha=sample.foreground[3]/255,fg=sample.foreground.slice(0,3).map((v,j)=>v*alpha+bg[j]*(1-alpha));rows.push({theme,mode,view,background,...sample,backgroundColor:bg,ratio:contrast(fg,bg)});});
     break;
     }
    }
    if(view==='account-form')await page.keyboard.press('Escape');
   }
   await page.close();
  }
  assert.deepEqual(errors,[]);const failures=rows.filter(row=>row.ratio<row.minimum);fs.writeFileSync(path.join(out,'evidence.json'),JSON.stringify({passed:!failures.length,kind:'built-renderer-native-tint-simulation',native,widgetNativeTint:false,samples:rows.length,settleRetries,failures,rows},null,2));
  console.log(`${rows.length} text/background samples; ${failures.length} below the specified minimum`);console.log(JSON.stringify(failures.slice(0,14).map(({theme,mode,view,background,text,selector,ratio,minimum})=>({theme,mode,view,background,text,selector,ratio,minimum}))).replace(/[^\x00-\x7f]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0')));
  if(!process.env.QUOTA_CONTRAST_AUDIT_ONLY)assert.equal(failures.length,0,'readable text on controlled native backdrops');
 }finally{await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
