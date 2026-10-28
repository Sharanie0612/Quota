import type { ActivityGroup } from './types';
export interface Share {key:string;name:string;value:number}
export function shares(rows:ActivityGroup[],name:(key:string)=>string,limit=5):Share[]{
  const sorted=rows.filter(r=>Number.isFinite(r.tokens.total)&&r.tokens.total>0).map(r=>({key:r.key,name:name(r.key),value:r.tokens.total})).sort((a,b)=>b.value-a.value||a.key.localeCompare(b.key));
  if(sorted.length<=limit)return sorted;
  return [...sorted.slice(0,limit),{key:'__other__',name:'其他',value:sorted.slice(limit).reduce((sum,row)=>sum+row.value,0)}];
}
export function cacheShares(rows:ActivityGroup[]):Share[]{
  const input=rows.reduce((sum,row)=>sum+Math.max(0,row.tokens.input||0),0);
  const hit=rows.reduce((sum,row)=>sum+Math.min(Math.max(0,row.tokens.input||0),Math.max(0,row.tokens.cached||0)),0);
  return [{key:'cached',name:'缓存命中',value:hit},{key:'uncached',name:'未命中',value:Math.max(0,input-hit)}];
}
