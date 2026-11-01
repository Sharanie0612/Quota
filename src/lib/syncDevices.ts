import type { ActivityOptions } from './types';

export interface NamedDevice { id: string; name: string }

/** A log source is not a computer running a Quota sync client. */
export function splitSyncDevices(devices: NamedDevice[], readers: {device: string}[], options: ActivityOptions) {
  const sshIds = new Set(options.codexSshDevices?.map(device => device.deviceId).filter(Boolean));
  const peers = new Set(readers.map(reader => reader.device));
  const ssh = devices.filter(device => device.id !== options.deviceId && (sshIds.has(device.id) || device.name.startsWith('SSH · ')));
  const sources = new Set(ssh.map(device => device.id));
  const named = new Map(devices.map(device => [device.id, device]));
  return {
    peers: [...peers].filter(id => id !== options.deviceId && !sources.has(id)).map(id => named.get(id) ?? {id, name: `其他电脑 ${id.slice(0, 8)}`}),
    ssh,
  };
}
