import type { OutputSpeedPoint } from './types';
export const speedBuckets=[{value:0,label:'自动'},{value:10,label:'10 秒'},{value:60,label:'1 分钟'},{value:300,label:'5 分钟'},{value:3600,label:'1 小时'},{value:21600,label:'6 小时'},{value:86400,label:'1 天'}];
export const speedBucketLabel=(seconds:number)=>speedBuckets.find(b=>b.value===seconds)?.label??`${seconds} 秒`;
export const speedValue=(point:OutputSpeedPoint)=>point.durationMs>0?point.outputTokens*1000/point.durationMs:null;
export function speedTimeTicks(start:number,end:number,width:number){
  const target=Math.max(3,Math.floor(width/160)),span=end-start;
  if(span<=0)return [start];
  const ticks:number[]=[];
  if(span>=2*86400000){
    const step=[1,2,7,14,30,90,365].find(days=>days*86400000>=span/target)??365;
    const date=new Date(start);date.setHours(0,0,0,0);
    if(date.getTime()<start)date.setDate(date.getDate()+1);
    while(date.getTime()<=end&&ticks.length<16){ticks.push(date.getTime());date.setDate(date.getDate()+step);}
  }else{
    const step=[60000,300000,600000,900000,1800000,3600000,7200000,10800000,21600000,43200000].find(ms=>ms>=span/target)??43200000;
    const midnight=new Date(start);midnight.setHours(0,0,0,0);
    const first=midnight.getTime()+Math.ceil((start-midnight.getTime())/step)*step;
    for(let at=first;at<=end&&ticks.length<16;at+=step)ticks.push(at);
  }
  if(!ticks.length)return [start,end];
  if((ticks[0]-start)/span*width>90)ticks.unshift(start);
  if((end-ticks[ticks.length-1])/span*width>90)ticks.push(end);
  return ticks;
}
export function speedSeries(points:OutputSpeedPoint[]){
  const groups=new Map<string,OutputSpeedPoint[]>();
  for(const point of points){if(speedValue(point)==null||!Number.isFinite(speedValue(point))||point.outputTokens<=0)continue;groups.set(point.model,[...(groups.get(point.model)??[]),point]);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([model,rows])=>({model,rows:rows.sort((a,b)=>a.timestamp-b.timestamp)}));
}
