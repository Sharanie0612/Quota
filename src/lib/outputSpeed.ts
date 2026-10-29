import type { OutputSpeedPoint } from './types';
export const speedBuckets=[{value:0,label:'自动'},{value:10,label:'10 秒'},{value:60,label:'1 分钟'},{value:300,label:'5 分钟'},{value:3600,label:'1 小时'},{value:21600,label:'6 小时'},{value:86400,label:'1 天'}];
export const speedBucketLabel=(seconds:number)=>speedBuckets.find(b=>b.value===seconds)?.label??`${seconds} 秒`;
export const speedValue=(point:OutputSpeedPoint)=>point.durationMs>0?point.outputTokens*1000/point.durationMs:null;
export function speedSeries(points:OutputSpeedPoint[]){
  const groups=new Map<string,OutputSpeedPoint[]>();
  for(const point of points){if(speedValue(point)==null||!Number.isFinite(speedValue(point))||point.outputTokens<=0)continue;groups.set(point.model,[...(groups.get(point.model)??[]),point]);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([model,rows])=>({model,rows:rows.sort((a,b)=>a.timestamp-b.timestamp)}));
}
