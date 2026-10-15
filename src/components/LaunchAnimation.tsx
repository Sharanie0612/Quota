import { useEffect, useState } from 'react';
import appIcon from '../../src-tauri/icons/128x128.png';
export function LaunchAnimation(){
  const [phase,setPhase]=useState('enter');
  useEffect(()=>{
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fade=setTimeout(()=>setPhase('leave'),reduced?0:550);
    const done=setTimeout(()=>setPhase('done'),reduced?30:900);
    return()=>{clearTimeout(fade);clearTimeout(done);};
  },[]);
  if(phase==='done')return null;
  return <div className={`launch-screen ${phase}`} data-tauri-drag-region role="status" aria-label="正在打开 Quota"><div className="launch-content"><div className="launch-icon"><img src={appIcon} alt=""/></div><strong>Quota</strong><span>用量，尽在掌握</span><i/></div></div>;
}
