import type { BenchmarkModel, BenchmarkProfile } from './types';

export function modelResult(model:BenchmarkModel,source:string,effort='best'){
  if(['general','coding','reasoning','agents','knowledge'].includes(source))return model.results.find(r=>r.sourceId==='epoch-ai'&&r.kind===source);
  return model.results.filter(r=>r.sourceId===(source==='livebench'?'livebench':'artificial-analysis')&&(source!=='aa'||effort==='best'||r.setting.split(',')[0].trim().toLowerCase()===effort)).sort((a,b)=>b.score-a.score||a.profileId.localeCompare(b.profileId))[0];
}
export const SCENARIOS=[{id:'general',name:'通用综合'},{id:'coding',name:'编程'},{id:'reasoning',name:'推理'},{id:'agents',name:'Agent'},{id:'knowledge',name:'知识'}];
export const configurationText=(value:string)=>{
  if(value.startsWith('Epoch 发布综合'))return '综合测评';
  const last=value.slice(value.lastIndexOf('_')+1).toLowerCase();
  const names:Record<string,string>={max:'Max',xhigh:'Xhigh',high:'High',medium:'Medium',low:'Low',none:'非推理',reasoning:'推理',unknown:'来源未注明档位'};
  return names[last]??settingText(value);
};
export const settingText=(value:string)=>value.replace('Default Fallback','默认回退').replace('平台公开设置','公开配置');
export const SERIES = ['var(--chart-1)','var(--chart-2)','var(--chart-3)','var(--chart-4)'];
export const fixed = (value:number|undefined|null) => value==null?'—':value.toFixed(1);
export function frontier(profiles:BenchmarkProfile[]) {
  let best=-Infinity;
  return profiles.filter(p=>p.cost!=null&&p.cost>0&&Number.isFinite(p.cost)&&Number.isFinite(p.index)).sort((a,b)=>a.cost!-b.cost!||b.index-a.index).filter(p=>{if(p.index<=best)return false;best=p.index;return true;});
}
