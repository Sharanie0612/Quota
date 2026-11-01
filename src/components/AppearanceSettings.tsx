import { THEMES, setAppearance, useAppearance } from '../lib/appearance';
import { Seg,Switch } from './ui';

export function AppearanceSettings(){
  const appearance=useAppearance();
  return <section className="card section appearance-settings"><h2>外观</h2><div className="setting-row"><div className="txt"><b>明暗模式</b></div><Seg value={appearance.mode} options={[{value:'system',label:'跟随系统'},{value:'light',label:'浅色'},{value:'dark',label:'深色'}]} onChange={mode=>setAppearance({mode})}/></div>
    <div className="theme-options" role="group" aria-label="配色方案">{[...THEMES].sort((a,b)=>Number(b.id==='quota')-Number(a.id==='quota')).map(theme=>{const palette=theme[appearance.resolved];return <button key={theme.id} type="button" aria-pressed={appearance.theme===theme.id} title={theme.description} onClick={()=>setAppearance({theme:theme.id})} className="theme-option"><span className="theme-swatch" style={{background:palette.workspace,borderColor:palette.border}} aria-hidden="true"><i style={{background:palette.sidebar}}/><i style={{background:palette.surface,borderColor:palette.border}}/><i style={{background:palette.accent}}/></span><b>{theme.name}{theme.id==='quota'?' · 默认':''}</b></button>;})}</div>
    <div className="setting-row material-setting"><div className="txt"><b>液态玻璃</b></div><Switch label="液态玻璃" controls="reduced-visual-effects" checked={appearance.glass} onChange={glass=>setAppearance({glass})}/></div>
    <div className="material-reduction" id="reduced-visual-effects" data-open={appearance.glass} aria-hidden={!appearance.glass}><div className="material-reduction-inner"><div className="setting-row"><div className="txt"><b>减少视觉效果</b></div><Switch label="减少视觉效果" disabled={!appearance.glass} checked={appearance.reduceEffects} onChange={reduceEffects=>setAppearance({reduceEffects})}/></div></div></div>
  </section>;
}
