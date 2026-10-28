import type { BenchmarkProfile } from './types';

export const DOMAINS = [{id:'reasoning',name:'推理'},{id:'coding',name:'编程'},{id:'knowledge',name:'知识分析'},{id:'research',name:'科学研究'},{id:'agents',name:'智能体'},{id:'visual',name:'视觉与创作'}];
export const SERIES = ['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
export const fixed = (value:number|undefined|null) => value==null?'—':value.toFixed(1);
export function frontier(profiles:BenchmarkProfile[]) {
  let best=-Infinity;
  return profiles.filter(p=>p.cost!=null&&p.cost>0&&Number.isFinite(p.cost)&&Number.isFinite(p.index)).sort((a,b)=>a.cost!-b.cost!||b.index-a.index).filter(p=>{if(p.index<=best)return false;best=p.index;return true;});
}
