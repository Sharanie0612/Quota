import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { api, errText } from '../lib/api';
import { IconArrowUpRight, IconChart } from './icons';
import './usage-widget.css';
import {LiveModelPanel} from './LiveModelPanel';
import type {LiveModelStatus} from '../lib/types';
import appIcon from '../../src-tauri/icons/128x128.png';

export function UsageWidget() {
  const [expanded,setExpanded]=useState(false);
  const [nativeExpanded,setNativeExpanded]=useState(false);
  const [side,setSide]=useState('right');
  const [total,setTotal]=useState(false);
  const [usage,setUsage]=useState<Awaited<ReturnType<typeof api.getWidgetUsage>>|null>(null);
  const [error,setError]=useState('');
  const [speed,setSpeed]=useState<LiveModelStatus|null>(null);
  const root=useRef<HTMLDivElement>(null);
  const timer=useRef<ReturnType<typeof setTimeout>>();
  const hovered=useRef(false);
  const focusValue=useRef(false);
  const enabled=useRef(true);
  const native=useRef(false);
  const dragging=useRef<{x:number;y:number;dx:number;dy:number}|null>(null);
  const moveQueue=useRef<{dx:number;dy:number;finished:boolean}|null>(null);
  const moving=useRef<Promise<void>|null>(null);
  const frame=useRef<number>();
  const move=():Promise<void>=>{
    if(moving.current)return moving.current;
    if(!moveQueue.current)return Promise.resolve();
    moving.current=(async()=>{
      try{while(moveQueue.current){const next=moveQueue.current;moveQueue.current=null;await api.moveWidget(next.dx,next.dy,next.finished);}}
      catch(e){setError(errText(e));dragging.current=null;}
      finally{moving.current=null;}
    })();
    return moving.current;
  };
  const desired=useRef(false);const working=useRef(false);const live=useRef(true);
  const interrupt=useRef<(()=>void)|null>(null);
  const settle=()=>new Promise<void>(resolve=>{
    const done=()=>{clearTimeout(timeout);interrupt.current=null;resolve();};
    // CSS completion is authoritative; the timer covers hidden/disabled views.
    const timeout=setTimeout(done,matchMedia('(prefers-reduced-motion: reduce)').matches?0:420);
    interrupt.current=done;
  });
  const expand=async(next:boolean)=>{
    clearTimeout(timer.current);const changed=desired.current!==next;desired.current=next;
    // Reverse the CSS transition immediately; never queue a full collapse first.
    if(native.current){setExpanded(next);if(changed)interrupt.current?.();}
    if(working.current)return;
    if(native.current===next)return;
    working.current=true;
    try {
      let target:boolean;
      do {
        target=desired.current;
        if(target){
          if(!native.current)await api.setWidgetExpanded(true);
          if(!live.current)break;
          native.current=true;setNativeExpanded(true);
          if(live.current)setExpanded(desired.current);
        }else{
          setExpanded(false);
          await settle();
          if(!live.current)break;
          if(desired.current)continue;
          await api.setWidgetExpanded(false);
          if(live.current){native.current=false;setNativeExpanded(false);}
        }
      }while(live.current&&target!==desired.current);
    }
    catch(e){if(live.current)setError(errText(e));}
    finally{working.current=false;}
  };
  const collapse=(force=false)=>{clearTimeout(timer.current);timer.current=setTimeout(()=>{if(!dragging.current&&(force||(!hovered.current&&!root.current?.contains(document.activeElement)))){if(force&&root.current?.contains(document.activeElement))(document.activeElement as HTMLElement)?.blur();void expand(false);}},120);};
  useEffect(()=>{
    live.current=true;let stopped=false;let loading=false;
    const load=async()=>{if(loading||!enabled.current)return;loading=true;try{const value=await api.getWidgetUsage();if(!stopped){setUsage(value);setError('');}}catch(e){if(!stopped)setError(errText(e));}finally{loading=false;}};
    const un=listen<{expanded:boolean;side:string;enabled?:boolean}>('widget-state',e=>{if(!stopped){const resume=!enabled.current&&e.payload.enabled!==false;enabled.current=e.payload.enabled!==false;native.current=e.payload.expanded;setNativeExpanded(e.payload.expanded);if(!working.current){desired.current=e.payload.expanded;setExpanded(e.payload.expanded);}setSide(e.payload.side);if(resume)void load();}});
    const activity=listen('activity-updated',()=>void load());
    let speedLoading=false;const loadSpeed=async()=>{if(speedLoading||!enabled.current)return;speedLoading=true;try{const next=await api.getWidgetSpeed();if(!stopped)setSpeed(next);}catch{/* Usage remains available if live metadata is unsupported. */}finally{speedLoading=false;}};
    const speedEvents=listen('output-speed-updated',()=>void loadSpeed());
    const speedTimer=setInterval(()=>void loadSpeed(),1000);void loadSpeed();
    void un.then(()=>api.widgetReady()).then(()=>load()).catch(e=>{if(!stopped)setError(errText(e));});
    const interval=setInterval(()=>void load(),30000);
    return()=>{stopped=true;live.current=false;interrupt.current?.();clearInterval(interval);clearInterval(speedTimer);void speedEvents.then(fn=>fn());clearTimeout(timer.current);if(frame.current)cancelAnimationFrame(frame.current);void un.then(f=>f());void activity.then(f=>f());};
  },[]);
  useEffect(()=>{if(expanded&&focusValue.current){focusValue.current=false;root.current?.querySelector<HTMLButtonElement>('.widget-value')?.focus();}},[expanded]);
  const value=usage?(total?usage.total:usage.today):null;
  const fullValue=value==null?(error?'暂无可用用量':'正在读取用量'):`${value.toLocaleString('zh-CN')} Token`;
  const compact=(n:number)=>Intl.NumberFormat('zh-CN',{notation:'compact',maximumFractionDigits:2}).formatToParts(n).map((part,index)=><span key={index} className={part.type==='compact'?'widget-number-unit':undefined}>{part.value}</span>);
  return <div ref={root} className={`usage-widget ${expanded?'is-expanded':''} ${nativeExpanded?'native-expanded':''} side-${side}`} onMouseEnter={()=>{hovered.current=true;void expand(true);}} onMouseLeave={()=>{hovered.current=false;collapse();}} onFocusCapture={()=>{if(!expanded)focusValue.current=true;void expand(true);}} onBlurCapture={()=>collapse()} onKeyDown={e=>{if(e.key==='Escape'){(document.activeElement as HTMLElement)?.blur();void expand(false);}}}>
    <button className="widget-handle" tabIndex={expanded?-1:0} aria-hidden={expanded} aria-label={`展开${total?'累计':'今日'}用量`} onClick={()=>void expand(true)}><span className={`widget-handle-dot${speed?.activeRequests?' working':''}`}/><span>用量</span><IconChart size={13}/></button><section className="widget-panel" aria-hidden={!expanded} aria-label="Token 用量悬浮窗" onTransitionEnd={e=>{if(e.propertyName==='clip-path'&&e.target===e.currentTarget&&!desired.current)interrupt.current?.();}}>
      <div className="widget-heading" title="拖动调整位置，松开贴边" onPointerDown={e=>{
        if(e.button!==0||(e.target as HTMLElement).closest('button'))return;
        clearTimeout(timer.current);dragging.current={x:e.screenX,y:e.screenY,dx:0,dy:0};e.currentTarget.setPointerCapture(e.pointerId);
        moveQueue.current={dx:0,dy:0,finished:false};void move();
      }} onPointerMove={e=>{
        if(!dragging.current)return;dragging.current.dx=e.screenX-dragging.current.x;dragging.current.dy=e.screenY-dragging.current.y;moveQueue.current={dx:dragging.current.dx,dy:dragging.current.dy,finished:false};
        if(!frame.current)frame.current=requestAnimationFrame(()=>{frame.current=undefined;void move();});
      }} onPointerUp={e=>{
        if(!dragging.current)return;moveQueue.current={dx:e.screenX-dragging.current.x,dy:e.screenY-dragging.current.y,finished:true};dragging.current=null;
        e.currentTarget.releasePointerCapture(e.pointerId);void move().then(()=>{if(!root.current?.matches(':hover'))collapse(true);});
      }} onPointerCancel={()=>{if(dragging.current){moveQueue.current={dx:dragging.current.dx,dy:dragging.current.dy,finished:true};dragging.current=null;void move().then(()=>collapse(true));}}}><img className="widget-brand-logo" src={appIcon} alt=""/><span>Quota</span><button className="widget-open" tabIndex={expanded?0:-1} title="打开主面板" aria-label="打开主面板" onClick={()=>void api.openMain().catch(e=>setError(errText(e)))}><IconArrowUpRight size={16}/></button></div>
      <LiveModelPanel status={speed} interactive={expanded}/>
      <button className="widget-value" tabIndex={expanded?0:-1} onClick={()=>setTotal(v=>!v)} aria-label={`${total?'累计':'今日'} ${fullValue}，点击切换${total?'今日':'累计'}用量`} title={fullValue}><span>{total?'累计 Token':'今日 Token'}<span className="widget-toggle">↔</span></span><strong key={`${total}`}>{value==null?'—':compact(value)}</strong></button>
      <div className={`widget-status ${error?'has-error':''}`} role="status">{error?'更新失败':usage?.partial?'部分来源待更新':''}</div>
    </section>
  </div>;
}
