import type { ActivityFilters } from './types';

export const softwareNames:Record<string,string>={codex:'Codex',claude:'Claude Code',gemini:'Gemini CLI',cursor:'Cursor',harness:'DeepSeek Harness',zcode:'ZCode',kimi:'Kimi Code',qoder:'Qoder',trae:'Trae',workbuddy:'WorkBuddy',codebuddy:'CodeBuddy'};
export const launcherNames:Record<string,string>={direct:'直接使用',multica:'Multica',unknown:'历史未标记'};
export const accessNames:Record<string,string>={builtin:'平台内置',api:'自带 API',unknown:'未标记接入'};
export const environmentNames:Record<string,string>={local:'本机',ssh:'SSH',wsl:'WSL',mounted:'虚拟机 / 挂载目录',imported:'同步的运行环境'};
export const vendorNames:Record<string,string>={custom:'OpenAI',anthropic:'Anthropic',google:'Google',deepseek:'DeepSeek',moonshot:'Kimi',zhipu:'智谱 GLM',alibaba:'阿里 Qwen',xai:'xAI',unknown:'未知厂商'};
export const emptyActivityFilters:ActivityFilters={software:'',launcher:'',environment:'',access:'',vendor:''};
const key='quota.activity.filters.v2';
export function loadActivityFilters():{filters:ActivityFilters;days:string;model:string}{
  try { const saved=JSON.parse(localStorage.getItem(key)??'{}') as Record<string,unknown>;
    const filters={...emptyActivityFilters};for(const name of Object.keys(filters) as (keyof ActivityFilters)[])if(typeof saved[name]==='string'&&(saved[name] as string).length<640)filters[name]=saved[name] as string;
    return {filters,days:['0','7','30','90','365'].includes(String(saved.days))?String(saved.days):'0',model:typeof saved.model==='string'?saved.model.slice(0,640):''};
  }catch{return {filters:{...emptyActivityFilters},days:'0',model:''};}
}
export function saveActivityFilters(filters:ActivityFilters,days:string,model:string){try{localStorage.setItem(key,JSON.stringify({...filters,days,model}));}catch{/* Storage may be unavailable; viewing remains usable. */}}
