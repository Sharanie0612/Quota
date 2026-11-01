import { useEffect, useState } from 'react';
import appIcon from '../../src-tauri/icons/128x128.png';
import {useAppearance} from '../lib/appearance';
export function LaunchAnimation(){
  const appearance=useAppearance();
  const reducedMotion=appearance.reducedMotion||(appearance.glass&&appearance.reduceEffects);
  const [phase,setPhase]=useState('enter');
  useEffect(()=>{
    const fade=setTimeout(()=>setPhase('leave'),reducedMotion?0:550);
    const done=setTimeout(()=>setPhase('done'),reducedMotion?30:900);
    return()=>{clearTimeout(fade);clearTimeout(done);};
  },[reducedMotion]);
  if(phase==='done'||reducedMotion)return null;
  return <div className={`launch-screen ${phase}`} data-tauri-drag-region role="status" aria-label="正在打开 Quota"><div className="launch-content"><div className="launch-icon"><img src={appIcon} alt=""/></div><strong>Quota</strong><span>用量，尽在掌握</span><i/></div></div>;
}
