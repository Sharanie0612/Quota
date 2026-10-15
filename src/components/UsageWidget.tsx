import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, errText } from '../lib/api';
import { IconArrowUpRight, IconChart } from './icons';
import './usage-widget.css';

export function UsageWidget() {
  const [expanded,setExpanded]=useState(false);
  const [nativeExpanded,setNativeExpanded]=useState(false);
  const [side,setSide]=useState('right');
  const [total,setTotal]=useState(false);
  const [usage,setUsage]=useState<Awaited<ReturnType<typeof api.getWidgetUsage>>|null>(null);
  const [error,setError]=useState('');
  const root=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>();
  const hovered=useRef(false);
  const focusValue=useRef(false);
  const enabled=useRef(true);
  const desired=useRef(false);const working=useRef(false);const live=useRef(true);
  const expand=async(next:boolean)=>{
    clearTimeout(timer.current);desired.current=next;
    if(working.current)return;
    working.current=true;
    try {
      let target:boolean;
      do {
        target=desired.current;
        if(target){
          await api.setWidgetExpanded(true);
          if(!live.current)break;
          setNativeExpanded(true);
          await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
          if(live.current)setExpanded(desired.current);
        }else{
          setExpanded(false);
          await new Promise(resolve=>setTimeout(resolve,matchMedia('(prefers-reduced-motion: reduce)').matches?0:260));
          if(!live.current)break;
          if(desired.current)continue;
          await api.setWidgetExpanded(false);
          if(live.current)setNativeExpanded(false);
        }
      }while(live.current&&target!==desired.current);
    }
    catch(e){if(live.current)setError(errText(e));}
    finally{working.current=false;}
  };
  const collapse=(force=false)=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{if(force||(!hovered.current&&!root.current?.contains(document.activeElement))){if(force&&root.current?.contains(document.activeElement))(document.activeElement as HTMLElement)?.blur();void expand(false);}},800);};
  useEffect(()=>{
    live.current=true;let stopped=false;let loading=false;
    const load=async()=>{if(loading||!enabled.current)return;loading=true;try{const value=await api.getWidgetUsage();if(!stopped){setUsage(value);setError('');}}catch(e){if(!stopped)setError(errText(e));}finally{loading=false;}};
    const un=listen<{expanded:boolean;side:string;enabled?:boolean}>('widget-state',e=>{if(!stopped){const resume=!enabled.current&&e.payload.enabled!==false;enabled.current=e.payload.enabled!==false;setNativeExpanded(e.payload.expanded);if(!working.current){desired.current=e.payload.expanded;setExpanded(e.payload.expanded);}setSide(e.payload.side);if(resume)void load();}});
    const activity=listen('activity-updated',()=>void load());
    void un.then(()=>api.widgetReady()).then(()=>load()).catch(e=>{if(!stopped)setError(errText(e));});
    const interval=setInterval(()=>void load(),30000);
    return()=>{stopped=true;live.current=false;clearInterval(interval);clearTimeout(timer.current);void un.then(f=>f());void activity.then(f=>f());};
  },[]);
  useEffect(()=>{if(expanded&&focusValue.current){focusValue.current=false;root.current?.querySelector<HTMLButtonElement>('.widget-value')?.focus();}},[expanded]);
  const value=usage?(total?usage.total:usage.today):null;
  const fullValue=value==null?(error?'暂无可用用量':'正在读取用量'):`${value.toLocaleString('zh-CN')} Token`;
  const compact=(n:number)=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).formatToParts(n).map((part,index)=><span key={index} className={part.type==='compact'?'widget-number-unit':undefined}>{part.value}</span>);
  return <div ref={root} className={`usage-widget ${expanded?'is-expanded':''} ${nativeExpanded?'native-expanded':''} side-${side}`} onMouseEnter={()=>{hovered.current=true;void expand(true);}} onMouseLeave={()=>{hovered.current=false;collapse(true);}} onFocusCapture={()=>{if(!expanded)focusValue.current=true;void expand(true);}} onBlurCapture={()=>collapse()} onKeyDown={e=>{if(e.key==='Escape'){(document.activeElement as HTMLElement)?.blur();void expand(false);}}}>
    <button className="widget-handle" tabIndex={expanded?-1:0} aria-hidden={expanded} aria-label={`展开${total?'累计':'今日'}用量`} onClick={()=>void expand(true)}><span className="widget-handle-dot"/><span>用量</span><IconChart size={13}/></button><section className="widget-panel" aria-hidden={!expanded} aria-label="Token 用量悬浮窗">
      <div className="widget-heading"><span className="widget-orbit" aria-hidden="true">Q<span/></span><span>Quota<span className="widget-subtitle">全部设备 · 不含 Trae</span></span><button className="widget-open" tabIndex={expanded?0:-1} title="打开主面板" aria-label="打开主面板" onClick={()=>void api.openMain().catch(e=>setError(errText(e)))}><IconArrowUpRight size={16}/></button></div>
      <button className="widget-value" tabIndex={expanded?0:-1} onClick={()=>setTotal(v=>!v)} aria-label={`${total?'累计':'今日'} ${fullValue}，点击切换${total?'今日':'累计'}用量`} title={fullValue}><span>{total?'累计 Token':'今日 Token'}<span className="widget-toggle">点击切换 ↔</span></span><strong key={`${total}`}>{value==null?'—':compact(value)}</strong></button>
      <div className={`widget-status ${error?'has-error':''}`} role="status">{error?'暂未更新 · 点击打开主面板检查':usage?.partial?'部分来源待更新':usage?.updatedAt?(total?'全部已采集历史':usage.date):'暂无已采集记录'}</div>
    </section>
  </div>;
}
