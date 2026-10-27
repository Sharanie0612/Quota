import { THEMES, setAppearance, useAppearance } from '../lib/appearance';
import { Seg } from './ui';

export function AppearanceSettings(){
  const appearance=useAppearance();
  return <section className="card section appearance-settings"><h2>外观</h2><div className="setting-row"><div className="txt"><b>明暗模式</b><span>外观保存在这台电脑</span></div><Seg value={appearance.mode} options={[{value:'system',label:'跟随系统'},{value:'light',label:'浅色'},{value:'dark',label:'深色'}]} onChange={mode=>setAppearance({mode})}/></div>
    <div className="theme-options" role="group" aria-label="配色方案">{THEMES.map(theme=>{const palette=theme[appearance.resolved];return <button key={theme.id} type="button" aria-pressed={appearance.theme===theme.id} onClick={()=>setAppearance({theme:theme.id})} className="theme-option"><span className="theme-swatch" style={{background:palette.workspace,borderColor:palette.border}} aria-hidden="true"><i style={{background:palette.sidebar}}/><i style={{background:palette.surface,borderColor:palette.border}}/><i style={{background:palette.accent}}/></span><b>{theme.name}</b><small>{theme.description}</small></button>;})}</div>
    <p className="hint">参考各产品的视觉风格设计，配色与明暗模式可独立选择。</p>
  </section>;
}
