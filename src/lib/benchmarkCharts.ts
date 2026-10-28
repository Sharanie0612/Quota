import type { BenchmarkModel, BenchmarkProfile } from './types';

export function modelResult(model:BenchmarkModel,source:string,effort='best'){
  return model.results.filter(r=>r.sourceId===(source==='livebench'?'livebench':'artificial-analysis')&&(source!=='aa'||effort==='best'||r.setting.split(',')[0].trim().toLowerCase()===effort)).sort((a,b)=>b.score-a.score||a.profileId.localeCompare(b.profileId))[0];
}
export const settingText=(value:string)=>value.replace('Default Fallback','默认回退').replace('平台公开设置','公开配置');
export const SERIES = ['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
export const fixed = (value:number|undefined|null) => value==null?'—':value.toFixed(1);
export function frontier(profiles:BenchmarkProfile[]) {
  let best=-Infinity;
  return profiles.filter(p=>p.cost!=null&&p.cost>0&&Number.isFinite(p.cost)&&Number.isFinite(p.index)).sort((a,b)=>a.cost!-b.cost!||b.index-a.index).filter(p=>{if(p.index<=best)return false;best=p.index;return true;});
}
