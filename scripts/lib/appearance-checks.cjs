const assert=require('node:assert/strict');
const geometry=require('../../src-tauri/data/ui-geometry.json');

async function assertSurfaces(page,frosted){
  const state=await page.evaluate(()=>{
    const read=e=>{const s=getComputedStyle(e);return {element:e.tagName+'.'+e.className,radius:s.borderTopLeftRadius,background:s.backgroundColor,filter:s.backdropFilter,opacity:s.opacity,transform:s.transform};};
    return {material:document.documentElement.dataset.material,body:read(document.body),app:read(document.querySelector('.app')),main:read(document.querySelector('.main')),sidebar:read(document.querySelector('.sidebar')),cards:[...document.querySelectorAll('.card')].map(read),buttons:[...document.querySelectorAll('.btn:not(.btn-quiet),.theme-option,.input,.select')].filter(e=>e.getBoundingClientRect().height>0).map(read)};
  });
  assert.equal(state.material,frosted?'frosted':'solid');
  assert(!state.body.background.startsWith('rgba'),JSON.stringify(state.body));
  assert.equal(state.app.radius,geometry.window+'px');
  for(const layer of [state.main,state.sidebar]){assert.equal(layer.radius,geometry.surface+'px');assert.equal(layer.filter!=='none',frosted);}
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
module.exports={assertSurfaces,assertInkContrast};
