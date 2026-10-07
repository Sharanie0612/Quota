import type { LadderEntry } from "../lib/types";

export const abilityAxes = [{key:"general",label:"综合"},{key:"coding",label:"编程"},{key:"math",label:"数学"},{key:"science",label:"科学"},{key:"reasoning",label:"推理"},{key:"agents",label:"智能体"}];
export const modelColors = ["var(--blue)", "var(--green)", "var(--amber)", "var(--red)", "var(--text-2)"];
export function AbilityRadar({entries}: {entries: LadderEntry[]}) {
  const point = (i:number, score:number) => {const angle = i * Math.PI / 3 - Math.PI / 2; return [160 + Math.cos(angle)*score, 150 + Math.sin(angle)*score];};
  const polygon = (radius:number) => abilityAxes.map((_,i)=>point(i,radius).join(",")).join(" ");
  return <svg className="ability-radar" viewBox="0 0 320 300" role="img" aria-label="模型六维能力图，缺失维度不连线">
    {[25,50,75,100].map(r=><g key={r}><polygon points={polygon(r)} fill="none" stroke="var(--border-strong)"/><text x="164" y={150-r} fill="var(--text-3)" fontSize="9">{r}</text></g>)}
    {abilityAxes.map((a,i)=>{const [x,y]=point(i,126);const [ex,ey]=point(i,100);return <g key={a.key}><line x1="160" y1="150" x2={ex} y2={ey} stroke="var(--border)"/><text x={x} y={y+4} textAnchor="middle" fill="var(--text-2)" fontSize="12">{a.label}</text></g>;})}
    {entries.map((entry,j)=>{const scores=abilityAxes.map(a=>entry.rankings[a.key]?.score);const color=modelColors[j%modelColors.length];return <g key={entry.id} style={{color}}>
      {scores.every(v=>v!=null) && <polygon points={scores.map((v,i)=>point(i,v).join(",")).join(" ")} fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth="2"/>}
      {scores.map((score,i)=> score == null ? null : <g key={i}>{scores[(i+1)%6]!=null && <line x1={point(i,score)[0]} y1={point(i,score)[1]} x2={point((i+1)%6,scores[(i+1)%6])[0]} y2={point((i+1)%6,scores[(i+1)%6])[1]} stroke="currentColor" strokeWidth="2"/>}<circle cx={point(i,score)[0]} cy={point(i,score)[1]} r="3" fill="currentColor"><title>{`${entry.name} · ${abilityAxes[i].label} ${score}`}</title></circle></g>)}
    </g>;})}
  </svg>;
}
