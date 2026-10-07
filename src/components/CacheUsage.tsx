import type { ActivityGroup } from "../lib/types";
import { ModelLogo } from "./ModelLogo";
import { modelColors } from "./AbilityRadar";
export function CacheUsage({rows,modelKeys,format,onModel}: {rows:ActivityGroup[];modelKeys:string[];format:(n:number)=>string;onModel:(key:string)=>void}) {
  const models=[...rows].sort((a,b)=>b.tokens.input-a.tokens.input);
  const palette=[...modelColors,...modelColors.map((color,i)=>`color-mix(in srgb, ${color} 65%, ${modelColors[(i+1)%modelColors.length]})`)];
  const colors=new Map([...new Set([...modelKeys,...rows.map(row=>row.key)])].sort().map((key,i)=>[key,palette[i%palette.length]]));
  return <section className="card cache-usage"><div className="usage-heading"><h3>缓存命中</h3><span className="hint">命中率 = 缓存命中 / 输入</span></div><div className="cache-table-scroll"><table><thead><tr><th>模型</th><th>命中率</th><th>命中 Token</th><th>未命中 Token</th></tr></thead><tbody>{models.map(row=>{
    const rate=row.tokens.input>0?Math.min(1,row.tokens.cached/row.tokens.input):0;
    return <tr key={row.key}><td><button className="activity-model-link" onClick={()=>onModel(row.key)}><i className="cache-color" style={{background:colors.get(row.key)}}/><ModelLogo name={row.key} size={20}/>{row.key||"未知模型"}</button></td><td><div className="cache-rate"><div><span style={{width:`${rate*100}%`,background:colors.get(row.key)}}/></div><b>{row.tokens.input?`${(rate*100).toFixed(1)}%`:"—"}</b></div></td><td>{format(row.tokens.cached)}</td><td>{format(Math.max(0,row.tokens.input-row.tokens.cached))}</td></tr>;
  })}</tbody></table></div>{!models.length&&<p className="hint">当前范围暂无缓存记录</p>}</section>;
}
