import {useEffect,useState} from 'react';
import type {LiveModelStatus} from '../lib/types';
import {liveModelState,taskElapsed} from '../lib/liveModel';
import {ModelLogo} from './ModelLogo';

export function LiveModelPanel({status,compact=false,onOpen,interactive=true}:{status:LiveModelStatus|null;compact?:boolean;onOpen?:()=>void;interactive?:boolean}){
  const [clock,setClock]=useState(Date.now()),[selected,setSelected]=useState('');
  useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
  const {tasks,task,readable,receiving,speed,phase}=liveModelState(status,clock,selected);
  return <section className={`live-model-panel${compact?' compact':''}${task?' working':''}`} aria-label="模型实时工作状态">
    <div className="live-model-heading"><div><ModelLogo name={task?.model??'Codex'} size={compact?19:22}/>{tasks.length>1?<select tabIndex={interactive?0:-1} aria-label="悬浮窗当前模型" value={task.id} onChange={event=>setSelected(event.target.value)}>{tasks.map(task=><option key={task.id} value={task.id}>{task.model} · {new Date(task.startedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})}</option>)}</select>:<b title={task?.model}>{task?.model||'Codex'}</b>}</div><span className="live-model-phase" title={status?.errors.join('；')||phase}><i/>{phase}</span></div>
    <div className="live-model-values"><button className="live-model-rate" tabIndex={interactive?0:-1} disabled={!onOpen} onClick={onOpen} title="已完成响应的加权均速，点击查看历史"><span>本轮均速</span><div><strong>{speed==null?'—':speed.toLocaleString('zh-CN',{maximumFractionDigits:1})}</strong><span>tokens/s</span></div></button><div className="live-model-detail"><div><span>任务耗时</span><b>{task?taskElapsed(clock-task.startedAt):'—'}</b></div><div><span>已确认输出</span><b>{task?task.confirmedOutputTokens.toLocaleString('zh-CN'):'—'}{task&&<span> Token</span>}</b></div></div></div>
    <div className="live-model-signal" title="接收片段是本机 Codex 的全局活动信号，不能归属于所选模型，也不等于 Token 数。"><span className={receiving?'receiving':''}><i/>{readable&&status?.stream?.available?`Codex · ${status.stream.chunksLastFiveSeconds.toLocaleString('zh-CN')} 片段 / 5秒`:'等待输出'}</span><span>{task?`${task.measuredResponses} 次已计时`:'本机'}</span></div>
  </section>;
}
