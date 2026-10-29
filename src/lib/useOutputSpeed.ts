import {useEffect,useRef,useState} from 'react';
import {listen} from '@tauri-apps/api/event';
import {api,errText} from './api';
import type {OutputSpeedReport} from './types';

export function useOutputSpeed(device:string,model:string,days:number,minutes:number,grain:number){
  const key=JSON.stringify([device,model,days,minutes,grain]);
  const [state,setState]=useState<{key:string;data:OutputSpeedReport|null;error:string}>({key:'',data:null,error:''});
  const [refreshing,setRefreshing]=useState(false);
  const reload=useRef<()=>void>(()=>{});
  useEffect(()=>{
    let disposed=false,inFlight=false,queued=false;
    const load=async()=>{
      if(disposed)return;
      if(inFlight){queued=true;return;}
      inFlight=true;
      do{
        queued=false;
        try{
          const data=await api.getOutputSpeed(device,'codex',days,model,grain,0,minutes);
          if(!disposed)setState({key,data,error:''});
        }catch(error){
          if(!disposed)setState(previous=>({key,data:previous.key===key?previous.data:null,error:errText(error)}));
        }
      }while(queued&&!disposed);
      inFlight=false;
    };
    const schedule=()=>{if(document.visibilityState==='visible')void load();};
    reload.current=schedule;
    const subscriptions=['output-speed-updated','activity-updated'].map(name=>listen(name,schedule));
    // Coalesce concurrent events, keep the last successful result and preserve
    // the chart cursor. Slow reads cannot starve the page with cancelled calls.
    const timer=setInterval(schedule,1000);
    document.addEventListener('visibilitychange',schedule);
    void load();
    return()=>{disposed=true;clearInterval(timer);document.removeEventListener('visibilitychange',schedule);for(const promise of subscriptions)void promise.then(stop=>stop()).catch(()=>{});};
  },[key,device,model,days,minutes,grain]);
  const refresh=async()=>{
    setRefreshing(true);
    try{await api.refreshOutputSpeed();reload.current();}
    catch(error){setState(previous=>({...previous,error:errText(error)}));}
    finally{setRefreshing(false);}
  };
  return {data:state.key===key?state.data:null,error:state.key===key?state.error:'',refresh,refreshing};
}
