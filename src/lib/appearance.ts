import { useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

export type ThemeId = 'codex' | 'claude' | 'vscode' | 'github' | 'quota';
export type ColorMode = 'system' | 'light' | 'dark';
type Palette = { bg:string; sidebar:string; workspace:string; surface:string; group:string; border:string; strong:string; text:string; primary?:string; secondary:string; muted:string; accent:string; onAccent:string; soft:string };
export const THEMES: {id:ThemeId;name:string;description:string;light:Palette;dark:Palette}[] = [
  {id:'codex',name:'Codex',description:'中性灰阶 · 黑白强调',light:{bg:'#f3f3f3',sidebar:'#f3f3f3',workspace:'#fafafa',surface:'#ffffff',group:'#f0f0f0',border:'#e3e3e3',strong:'#cccccc',text:'#242424',secondary:'#626262',muted:'#727272',accent:'#303030',onAccent:'#ffffff',soft:'#e9e9e9'},dark:{bg:'#171717',sidebar:'#171717',workspace:'#202020',surface:'#292929',group:'#333333',border:'#3b3b3b',strong:'#555555',text:'#ededed',secondary:'#b9b9b9',muted:'#aaaaaa',accent:'#e5e5e5',onAccent:'#202020',soft:'#3d3d3d'}},
  {id:'claude',name:'Claude',description:'温暖米白 · 陶土色',light:{bg:'#eeede6',sidebar:'#eeede6',workspace:'#faf9f5',surface:'#fffefa',group:'#f1efe7',border:'#dedbd1',strong:'#c7c1b4',text:'#302e29',secondary:'#666155',muted:'#756e61',accent:'#a54e33',onAccent:'#ffffff',soft:'#f3e4dc'},dark:{bg:'#242420',sidebar:'#242420',workspace:'#2d2d28',surface:'#36362f',group:'#404038',border:'#4b4a40',strong:'#696557',text:'#f0ede3',secondary:'#c3bfb0',muted:'#b1aa97',accent:'#e0a184',onAccent:'#30221c',soft:'#544037'}},
  {id:'vscode',name:'VS Code',description:'清晰分区 · 编辑器蓝',light:{bg:'#f3f3f3',sidebar:'#f3f3f3',workspace:'#ffffff',surface:'#ffffff',group:'#f3f3f3',border:'#e5e5e5',strong:'#c4c4c4',text:'#242424',secondary:'#616161',muted:'#6e6e6e',accent:'#005fb8',onAccent:'#ffffff',soft:'#e5f0fa'},dark:{bg:'#181818',sidebar:'#181818',workspace:'#1f1f1f',surface:'#252526',group:'#313131',border:'#3c3c3c',strong:'#555555',text:'#cccccc',secondary:'#b0b0b0',muted:'#a0a0a0',accent:'#4daafc',onAccent:'#102131',soft:'#243d51'}},
  {id:'github',name:'GitHub',description:'轻量白灰 · 清晰边线',light:{bg:'#f6f8fa',sidebar:'#f6f8fa',workspace:'#ffffff',surface:'#ffffff',group:'#f6f8fa',border:'#d1d9e0',strong:'#afb8c1',text:'#1f2328',secondary:'#59636e',muted:'#656d76',accent:'#0969da',primary:'#1f883d',onAccent:'#ffffff',soft:'#ddf4ff'},dark:{bg:'#010409',sidebar:'#010409',workspace:'#0d1117',surface:'#161b22',group:'#21262d',border:'#30363d',strong:'#484f58',text:'#f0f6fc',secondary:'#b1bac4',muted:'#9da7b3',accent:'#79b8ff',primary:'#238636',onAccent:'#102033',soft:'#22354b'}},
  {id:'quota',name:'Quota',description:'纯白 · 淡蓝 · 深海蓝',light:{bg:'#eef5ff',sidebar:'#edf5ff',workspace:'#ffffff',surface:'#ffffff',group:'#f1f6fd',border:'#dce7f5',strong:'#abc4e4',text:'#102f58',primary:'#153e78',secondary:'#4e6789',muted:'#60799a',accent:'#086bdc',onAccent:'#ffffff',soft:'#e4effd'},dark:{bg:'#09182c',sidebar:'#0c1d34',workspace:'#10243e',surface:'#162e4b',group:'#1d3858',border:'#2c496b',strong:'#54769f',text:'#edf5ff',primary:'#76b4ff',secondary:'#bed1ec',muted:'#a0b8d7',accent:'#86bbff',onAccent:'#132a48',soft:'#2a4567'}},
];
export interface Appearance {theme:ThemeId;mode:ColorMode;collapsed:boolean;glass:boolean;resolved:'light'|'dark';revision:number}
const KEY='quota.appearance.v1';
const fallback:Appearance={theme:'quota',mode:'system',collapsed:false,glass:false,resolved:'light',revision:0};
let snapshot=fallback;
const listeners=new Set<()=>void>();
let initialized=false;
function read():Appearance {
  try {const value=JSON.parse(localStorage.getItem(KEY)||'{}');return {...fallback,theme:THEMES.some(t=>t.id===value.theme)&&value.revision>0?value.theme:fallback.theme,mode:['system','light','dark'].includes(value.mode)?value.mode:'system',collapsed:value.collapsed===true,glass:value.glass===true,revision:Number.isSafeInteger(value.revision)&&value.revision>=0?value.revision:0};}catch{return {...fallback};}
}
function accept(value:Partial<Appearance>|null){
  if(!value||!THEMES.some(theme=>theme.id===value.theme)||!['system','light','dark'].includes(value.mode??'')||typeof value.collapsed!=='boolean')return;
  const revision=value.revision??0;if(revision<snapshot.revision)return;
  snapshot={...snapshot,theme:revision===0?fallback.theme:value.theme!,mode:value.mode!,collapsed:value.collapsed,glass:value.glass===true,revision};
  try{localStorage.setItem(KEY,JSON.stringify(snapshot));}catch{/* Backend remains the persisted source. */}
  apply();
}
function apply() {
  if(typeof document==='undefined')return;
  snapshot={...snapshot,resolved:snapshot.mode==='system'?(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):snapshot.mode};
  const palette=THEMES.find(theme=>theme.id===snapshot.theme)![snapshot.resolved];
  const values:Record<string,string>={bg:palette.bg,'bg-sidebar':palette.sidebar,'bg-topbar':palette.workspace,surface:palette.surface,'surface-2':palette.workspace,'surface-3':palette.group,border:palette.border,'border-strong':palette.strong,text:palette.text,'text-2':palette.secondary,'text-3':palette.muted,blue:palette.accent,'blue-hover':palette.accent,'blue-press':palette.accent,'blue-soft':palette.soft,'on-blue':palette.onAccent,'seg-thumb':palette.surface,primary:palette.primary??palette.accent,'on-primary':snapshot.theme==='github'?'#ffffff':palette.onAccent,'brand-strong':palette.text,'seg-track':palette.group,fill:palette.group,'fill-strong':palette.border,'fill-press':palette.strong,'shadow-card':'0 1px 3px color-mix(in srgb, '+palette.text+' 4%, transparent)'};
  const dark=snapshot.resolved==='dark';
  const charts:Record<ThemeId,string[]>={quota:dark?['#7eb6ff','#bfd8ff','#63c4d1','#b6aaeb','#e0bc89','#91a7c4']:['#1478ec','#153e78','#389ca8','#8a7ac2','#bb9253','#a2b1c8'],codex:dark?['#eeeeee','#8ac1a7','#93b2ce','#c3b4a1','#b3a2c8','#879195']:['#303030','#438365','#6685a0','#a68e71','#8c799f','#a6ada9'],claude:dark?['#e4a183','#b6c79b','#caba8f','#a8bbc9','#d1a7b8','#a59f91']:['#b96043','#748764','#b1935b','#73899e','#b48392','#ada89b'],vscode:dark?['#4daafc','#4ec9b0','#c586c0','#dcdcaa','#ce9178','#8c9aa6']:['#007acc','#16856e','#a646aa','#9c831d','#aa5d36','#909da9'],github:dark?['#58a6ff','#3fb950','#bc8cff','#d29922','#ff7b72','#8b949e']:['#0969da','#1a7f37','#8250df','#9a6700','#cf222e','#8c959f']};
  charts[snapshot.theme].forEach((value,index)=>values[index===5?'chart-rest':`chart-${index+1}`]=value);
  Object.assign(values,{red:dark?'#ff938a':'#c4362f',amber:dark?'#f1c86a':'#8b5a00',green:dark?'#78cf9b':'#277943','switch-on':palette.primary??palette.accent,'red-soft':'color-mix(in srgb, var(--red) 12%, '+palette.surface+')','amber-soft':'color-mix(in srgb, var(--amber) 12%, '+palette.surface+')','green-soft':'color-mix(in srgb, var(--green) 12%, '+palette.surface+')','shadow-pop':dark?'0 18px 50px #00000070':'0 18px 50px #00000030'});
  for(const [key,value] of Object.entries(values))document.documentElement.style.setProperty('--'+key,value);
  document.documentElement.style.colorScheme=snapshot.resolved;
  document.documentElement.dataset.colorTheme=snapshot.theme;
  document.documentElement.dataset.colorMode=snapshot.resolved;
  document.documentElement.dataset.glass=snapshot.glass?'on':'off';
  listeners.forEach(listener=>listener());
}
export function initializeAppearance() {
  if(initialized||typeof window==='undefined')return;
  initialized=true;snapshot=read();apply();
  let frame=0;document.addEventListener('pointermove',event=>{if(!snapshot.glass||frame||matchMedia('(prefers-reduced-motion: reduce)').matches)return;const surface=(event.target as Element).closest<HTMLElement>('.sidebar,.workspace-toolbar,.seg');if(!surface)return;const x=event.clientX,y=event.clientY;frame=requestAnimationFrame(()=>{frame=0;const rect=surface.getBoundingClientRect();surface.style.setProperty('--glass-x',`${x-rect.left}px`);surface.style.setProperty('--glass-y',`${y-rect.top}px`);});},{passive:true});
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change',apply);
  window.addEventListener('storage',event=>{if(event.key===KEY){snapshot=read();apply();}});
  void listen<Appearance>('appearance-updated',event=>accept(event.payload)).then(()=>invoke<Appearance|null>('get_appearance')).then(accept).catch(()=>undefined);
}
export function setAppearance(patch:Partial<Pick<Appearance,'theme'|'mode'|'collapsed'|'glass'>>) {
  snapshot={...snapshot,...patch,revision:Math.max(Date.now(),snapshot.revision+1)};
  try{localStorage.setItem(KEY,JSON.stringify({theme:snapshot.theme,mode:snapshot.mode,collapsed:snapshot.collapsed,glass:snapshot.glass,revision:snapshot.revision}));}catch{/* Keep the current session usable when storage is unavailable. */}
  apply();
  void invoke('save_appearance',{preferences:{theme:snapshot.theme,mode:snapshot.mode,collapsed:snapshot.collapsed,glass:snapshot.glass,revision:snapshot.revision}}).catch(()=>undefined);
}
export function useAppearance(){return useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener);},()=>snapshot,()=>fallback);}
