import type { LadderEntry } from './types';

export function pricingOptions(entry:LadderEntry) {
  const options=entry.priceOptions??[];
  return entry.offPeak&&!options.some(p=>p.id==='off-peak')?[...options,{id:'off-peak',label:'闲时半价',price:entry.offPeak}]:options;
}

/** No generic percentage: each scenario needs an exact, verified vendor table. */
export function applyPricing(entry:LadderEntry,scenario:string):LadderEntry {
  if(scenario==='standard')return entry;
  const option=entry.verifiedAt?pricingOptions(entry).find(p=>p.id===scenario):undefined;
  if(option)return {...entry,price:{...option.price,note:`${option.label} · ${option.price.note??''}`}};
  // Off-peak is an optional real-time policy; other scenarios are different services.
  if(scenario==='off-peak')return {...entry,price:{...entry.price,note:`按标准价比较（无已核实闲时档） · ${entry.price.note??''}`}};
  return {...entry,price:{...entry.price,input:null,output:null,cachedInput:null,cacheWrite:null,cacheWriteLong:null,note:'该型号尚无已核实的所选计费档位；切换标准价格查看。'}};
}
