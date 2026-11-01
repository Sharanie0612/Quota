import type {AiModelSnapshot,BenchmarkBoard,BenchmarkEdition,BenchmarkModel,BenchmarkProfile,LadderEntry,LadderSnapshot,ModelRelease} from './types';
export const visualAxes=[{key:'reasoning',label:'推理'},{key:'coding',label:'编程'},{key:'knowledge',label:'知识'},{key:'research',label:'科研'},{key:'agents',label:'智能体'},{key:'visual',label:'视觉'}];
const metrics:Record<string,string>={reasoning:'HLE-Diamond',coding:'FrontierCode 2.0',knowledge:'AA-Omniscience v1.1 · accuracy',research:'CritPt v2 · hard subset',agents:'AutomationBench-AA',visual:'MMMU-Pro'};
export const modelIdentity=(value:string)=>value.replace(/\s*\([^)]*\)\s*$/,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const vendorIdentity=(value:string)=>({zai:'zhipu',zhipu:'zhipu',xiaomi:'xiaomi',spacexai:'xai'}[modelIdentity(value)]??modelIdentity(value));
export function inEvaluationWindow(value:string|undefined,days:number,now=new Date()){
  if(!days)return true;if(!value||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T12:00:00');if(Number.isNaN(date.getTime())||date.toLocaleDateString('en-CA')!==value)return false;
  const cutoff=new Date(now.getFullYear(),now.getMonth(),now.getDate(),12);cutoff.setDate(cutoff.getDate()-(days-1));
  return date.getTime()>=cutoff.getTime()&&value<=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');
}
export type EvaluationScope='main30'|'all30'|'all';
export interface VisualModel {entry:LadderEntry;profile:BenchmarkProfile;model:BenchmarkModel;release?:ModelRelease;edition?:BenchmarkEdition}
export function filterVisualModels(models:VisualModel[],scope:EvaluationScope,now=new Date()){
  return models.filter(m=>(scope==='all'||(m.profile.version===m.edition?.version&&inEvaluationWindow(m.edition?.publishedAt,30,now)))&&(scope!=='main30'||!!m.edition?.primaryProfiles.includes(m.profile.id)));
}
export function visualModels(board:BenchmarkBoard,registry:AiModelSnapshot|null,legacy:LadderSnapshot|null):VisualModel[]{
  return board.profiles.filter(p=>p.sourceId==='artificial-analysis'&&Number.isFinite(p.index)&&p.index>=0&&p.index<=100).flatMap(profile=>{
    const model=board.models.find(m=>m.id===profile.modelId);if(!model)return [];
    const key=modelIdentity(model.name),vendor=vendorIdentity(model.vendor);
    const same=(name:string,owner:string)=>modelIdentity(name)===key&&vendorIdentity(owner)===vendor;
    const official=registry?.models.find(m=>m.available&&!!m.verifiedAt&&(same(m.name,m.vendor)||same(m.apiId,m.vendor)));
    const old=legacy?.entries.find(e=>same(e.name,e.vendor)&&!!e.verifiedAt);
    const release=board.releases?.find(r=>r.id===key&&vendorIdentity(r.vendor)===vendor);
    const result=model.results.find(r=>r.sourceId==='artificial-analysis'&&r.profileId===profile.id);if(!result)return [];
    const edition=board.sources.find(s=>s.id==='artificial-analysis')?.edition??undefined;
    const rankings:LadderEntry['rankings']={general:{rank:0,score:profile.index,source:result.url,updatedAt:edition?.publishedAt??''}};
    for(const axis of visualAxes){const raw=model.observations.find(o=>o.sourceId==='artificial-analysis'&&o.profileId===profile.id&&o.metric===metrics[axis.key]&&o.unit==='percent'&&o.value>=0&&o.value<=100);if(raw)rankings[axis.key]={rank:0,score:raw.value,source:raw.url,updatedAt:raw.checkedAt};}
    const price=official?.price??old?.price??{currency:'CNY',unit:'每百万 Tokens',input:null,output:null,note:null};
    return [{entry:{id:profile.id,name:profile.name,vendor:model.vendor,provider:official?.provider??old?.provider??'',rankings,price,priceSource:official?.source??old?.priceSource??'',verifiedAt:official?.verifiedAt??old?.verifiedAt??null,releasedAt:release?.releasedAt??null},profile,model,release,edition}];
  }).sort((a,b)=>b.profile.index-a.profile.index||a.profile.id.localeCompare(b.profile.id));
}
export const axisMetric=(axis:string)=>metrics[axis]??'Artificial Analysis Intelligence Index v5';
