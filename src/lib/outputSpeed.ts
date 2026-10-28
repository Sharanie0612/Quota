import type { OutputSpeedPoint } from './types';
export const speedValue=(point:OutputSpeedPoint)=>point.durationMs>0?point.outputTokens*1000/point.durationMs:null;
export function speedSeries(points:OutputSpeedPoint[]){
  const groups=new Map<string,OutputSpeedPoint[]>();
  for(const point of points){if(speedValue(point)==null||!Number.isFinite(speedValue(point))||point.outputTokens<=0)continue;groups.set(point.model,[...(groups.get(point.model)??[]),point]);}
  return [...groups].sort(([a],[b])=>a.localeCompare(b)).map(([model,rows])=>({model,rows:rows.sort((a,b)=>a.timestamp-b.timestamp)}));
}
