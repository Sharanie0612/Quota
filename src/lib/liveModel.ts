import type {LiveModelStatus} from './types';

export function liveModelState(status:LiveModelStatus|null,clock:number,selected='') {
  const fresh=!!status?.checkedAt&&clock-status.checkedAt>=-1000&&clock-status.checkedAt<6000;
  const readable=!!(fresh&&status?.enabled&&status.sourceConfigured&&!status.errors.length);
  const tasks=readable?(status?.tasks??[]).filter(task=>task.startedAt>0):[];
  const task=tasks.find(value=>value.id===selected)??tasks[0];
  const delta=status?.stream?.lastDeltaAt;
  const receiving=!!(readable&&delta&&clock-delta>=-1000&&clock-delta<2000);
  const speed=task&&task.measuredResponses>0&&task.measuredDurationMs>0
    ?task.measuredOutputTokens*1000/task.measuredDurationMs:null;
  const phase=!status?'正在连接':!status.enabled?'采集已暂停':!status.sourceConfigured?'未设置来源'
    :status.errors.length?'读取异常':!fresh?'读取延迟':task?'模型工作中':receiving?'Codex 正在输出':'等待模型任务';
  return {fresh,readable,tasks,task,receiving,speed,phase};
}

export function taskElapsed(milliseconds:number) {
  const seconds=Math.max(0,Math.floor(milliseconds/1000));
  if(seconds>=3600)return `${Math.floor(seconds/3600)}时${Math.floor(seconds%3600/60)}分`;
  if(seconds>=60)return `${Math.floor(seconds/60)}分${seconds%60}秒`;
  return `${seconds}秒`;
}
