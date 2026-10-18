import type { SshDevice, SshIdentity } from "./types";

// Keep old identities when an alias is retargeted: their history remains excluded.
export function mergeSshDevices(previous:SshDevice[], identities:SshIdentity[]):SshDevice[] {
  let devices=previous.map(d=>({...d,aliases:[...d.aliases]}));
  for(const identity of identities){
    const matches=(d:SshDevice)=>d.home===identity.home&&(d.host===identity.host||d.aliases.includes(identity.host));
    if(identity.error){
      const known=devices.filter(matches);
      if(known.length)devices=devices.map(d=>matches(d)?{...d,error:identity.error!}:d);
      else devices.push({...identity,included:false,aliases:[identity.host],error:identity.error});
      continue;
    }
    const legacy=devices.find(d=>matches(d)&&!d.deviceId);
    devices=devices.filter(d=>!matches(d)||!!d.deviceId).map(d=>matches(d)&&d.deviceId!==identity.deviceId
      ? {...d,included:false,error:"此连接的设备标识已变化，原设备历史已退出汇总。"}:d);
    const index=devices.findIndex(d=>d.deviceId===identity.deviceId);
    if(index>=0){
      const current=devices[index];
      devices[index]={...current,name:identity.name,error:undefined,aliases:[...new Set([...current.aliases,identity.host])],
        // Prefer a connection that was successfully identified this round.
        host:identity.host,home:identity.home};
    }else devices.push({...identity,included:legacy?.included??false,aliases:[identity.host],error:undefined});
  }
  return devices;
}
