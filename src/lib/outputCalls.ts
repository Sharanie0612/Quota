import type {CompletedOutput} from './types';
export type CallPoint={call:CompletedOutput;x:number;y:number};
/** One coordinate per completed call. Equal times/rates remain equal; IDs stay distinct. */
export function callLayout(calls:CompletedOutput[],width:number,height:number){
  const rows=[...calls].sort((a,b)=>a.completedAt-b.completedAt||a.id.localeCompare(b.id));
  const left=60,right=width-22,top=30,bottom=height-44;
  const first=rows[0]?.completedAt??0,last=rows[rows.length-1]?.completedAt??first;
  const pad=Math.max(5000,(last-first)*.025),start=first-pad,end=last+pad;
  const maximum=rows.reduce((max,row)=>Math.max(max,row.speed),20);
  const power=10**Math.floor(Math.log10(maximum/5)),step=([1,2,2.5,5,10].find(n=>n*power>=maximum/5)??10)*power;
  const ceiling=Math.ceil(maximum/step)*step,ticks=Array.from({length:Math.round(ceiling/step)+1},(_,i)=>i*step);
  const points=rows.map(call=>({call,x:left+(call.completedAt-start)/(end-start)*(right-left),y:bottom-call.speed/ceiling*(bottom-top)}));
  return {points,left,right,top,bottom,start,end,ceiling,ticks};
}
export function nearestCall(points:CallPoint[],x:number,y:number){
  let nearest:CallPoint|undefined,distance=24;
  for(const point of points){const delta=Math.hypot(point.x-x,point.y-y);if(delta<distance){nearest=point;distance=delta;}}
  return nearest;
}
