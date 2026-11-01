const assert=require('node:assert/strict');
const geometry=require('../../src-tauri/data/ui-geometry.json');

async function assertSurfaces(page,frosted){
  const state=await page.evaluate(()=>{
    const read=e=>{const s=getComputedStyle(e);return {element:e.tagName+'.'+e.className,radius:s.borderTopLeftRadius,background:s.backgroundColor,filter:s.backdropFilter,opacity:s.opacity,transform:s.transform};};
    return {material:document.documentElement.dataset.material,body:read(document.body),app:read(document.querySelector('.app')),main:read(document.querySelector('.main')),sidebar:read(document.querySelector('.sidebar')),toolbar:read(document.querySelector('.workspace-toolbar')),cards:[...document.querySelectorAll('.card')].map(read),buttons:[...document.querySelectorAll('.btn:not(.btn-quiet),.theme-option,.input,.select')].filter(e=>e.getBoundingClientRect().height>0).map(read)};
  });
  const expected=frosted==='solid'?'solid':frosted?'frosted':'liquid';
  assert.equal(state.material,expected);
  assert(!state.body.background.startsWith('rgba'),JSON.stringify(state.body));
  assert.equal(state.app.radius,geometry.window+'px');
  assert.equal(state.main.filter,'none');assert.equal(state.main.radius,geometry.surface+'px');
  for(const layer of [state.sidebar,state.toolbar]){assert.equal(layer.radius,geometry.surface+'px');if(expected==='solid')assert.equal(layer.filter,'none');else assert.match(layer.filter,/blur/);}
  for(const card of state.cards){assert.equal(card.radius,geometry.surface+'px');assert.equal(card.filter,'none');assert(!card.background.startsWith('rgba'));}
  for(const button of state.buttons){assert.equal(button.radius,geometry.control+'px',JSON.stringify(button));assert.equal(button.opacity,'1',JSON.stringify(button));assert.equal(button.filter,'none');assert(!button.background.startsWith('rgba'),JSON.stringify(button));}
  return state;
}
async function assertInkContrast(page,selector){
  const result=await page.locator(selector).evaluate(element=>{
    const ctx=document.createElement('canvas').getContext('2d'),resolve=color=>{ctx.fillStyle=color;ctx.fillRect(0,0,1,1);return [...ctx.getImageData(0,0,1,1).data];};
    const foreground=resolve(getComputedStyle(element).color),background=resolve(getComputedStyle(document.documentElement).getPropertyValue('--surface'));
    const luminance=rgb=>rgb.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
    const a=luminance(foreground),b=luminance(background);return {foreground,background,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
  });
  assert(result.ratio>=4.5,selector+' contrast '+JSON.stringify(result));return result;
}
async function chooseMaterial(page,frosted){
  const master=page.getByRole('button',{name:'液态玻璃',exact:true}),enabled=frosted!=='solid';
  if((await master.getAttribute('aria-pressed')==='true')!==enabled)await master.click();
  if(enabled){const reduced=page.getByRole('button',{name:'减少视觉效果',exact:true});if((await reduced.getAttribute('aria-pressed')==='true')!==frosted)await reduced.click();}
  await page.waitForFunction(value=>document.documentElement.dataset.material===(value==='solid'?'solid':value?'frosted':'liquid'),frosted);
}
async function assertSidebar(page,collapsed){
  await page.waitForFunction(collapsed=>document.querySelector('.app').classList.contains('sidebar-collapsed')===collapsed,collapsed);
  const state=await page.evaluate(()=>{
    const toggle=document.querySelector('.sidebar-toggle'),r=toggle.getBoundingClientRect(),header=toggle.closest('.sidebar-header'),h=header.getBoundingClientRect();
    return {header:!!header,inside:r.top>=h.top&&r.bottom<=h.bottom&&r.left>=h.left&&r.right<=h.right,clickable:document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.closest('.sidebar-toggle')===toggle,icons:[...document.querySelectorAll('.nav-item>svg')].map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height]),targets:[...document.querySelectorAll('.nav-item')].map(e=>[e.getBoundingClientRect().width,e.getBoundingClientRect().height])};
  });
  assert(state.inside&&state.clickable,JSON.stringify(state));
  for(const icon of state.icons)assert.deepEqual(icon,collapsed?[24,24]:[20,20]);
  for(const [width,height] of state.targets){assert(width>=48&&height>=48);if(collapsed)assert.equal(width,48);}
  return state;
}
module.exports={assertSurfaces,assertInkContrast,chooseMaterial,assertSidebar};
