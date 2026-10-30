import {useLayoutEffect,useState} from 'react';
import type {LiveModelStatus} from '../lib/types';
import {liveModelState,taskElapsed} from '../lib/liveModel';
import {ModelLogo} from './ModelLogo';

export function LiveModelPanel({status,interactive=true}:{status:LiveModelStatus|null;interactive?:boolean}){
  const [clock,setClock]=useState(Date.now);
  // Refresh before the opening frame; an invisible panel needs no ticking text.
  useLayoutEffect(()=>{
    if(!interactive)return;
    let timer:ReturnType<typeof setInterval>|undefined;
    const refresh=()=>{
      clearInterval(timer);timer=undefined;
      if(document.hidden)return;
      setClock(Date.now());timer=setInterval(()=>setClock(Date.now()),1000);
    };
    refresh();document.addEventListener('visibilitychange',refresh);
    return()=>{clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
  },[interactive]);
  const {tasks,phase}=liveModelState(status,interactive&&!document.hidden?clock:Date.now());
  return <section className={`live-model-panel task-panel${tasks.length?' working':''}`} aria-label="正在工作的任务">
    <div className="task-panel-heading"><span className="live-model-phase"><i/>{tasks.length?'正在工作':phase}</span>{tasks.length>0&&<span>{tasks.length} 个任务</span>}</div>
    <div className="task-list" tabIndex={interactive&&tasks.length>2?0:-1}>
      {tasks.length?tasks.map(task=><div className="task-row" key={task.id}><ModelLogo name={task.model} size={22}/><div><b title={task.model}>{task.model||'Codex 任务'}</b><span>{new Date(task.startedAt).toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})} 开始</span></div><time>{taskElapsed(clock-task.startedAt)}</time></div>):<div className="task-idle">{phase==='等待模型任务'?'运行 Codex 时会自动显示任务':'任务状态暂不可用'}</div>}
    </div>
  </section>;
}
