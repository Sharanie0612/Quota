import type { ActivityOptions, ActivityReport } from "./types";

export function activityDeviceChoices(devices: ActivityReport["devices"], options?: ActivityOptions) {
  const all = new Map(devices.map(device => [device.id, device]));
  for (const remote of options?.codexSshDevices ?? []) {
    if (remote.deviceId) all.set(remote.deviceId, { id: remote.deviceId, name: remote.name || remote.host });
  }
  const choices = [...all.values()].map(device => {
    const remote = options?.codexSshDevices?.find(item => item.deviceId === device.id);
    const ssh = !!remote || device.name.startsWith("SSH · ");
    const known = device.name !== "远程采集设备" && !!device.name.trim();
    const name = remote?.name || (known ? device.name.replace(/^SSH · /, "") : `远程设备 ${device.id.slice(0, 8)}`);
    const aliases = remote ? [...new Set([remote.host, ...remote.aliases].filter(Boolean))] : [];
    const label = `${name}${ssh ? `（SSH${aliases.length ? ` · ${aliases.join(" / ")}` : ""}）` : ""}${remote && !remote.included ? " · 未纳入统计" : ""}`;
    return { id: device.id, name, ssh, aliases, label, included: remote?.included ?? true, home: remote?.home ?? "", known };
  });
  // Identical hostnames still represent separate devices; keep their IDs and labels distinct.
  return choices.map(device => ({...device,label: choices.some(other => other.id !== device.id && other.label === device.label) ? `${device.label} · ${device.id.slice(0, 8)}` : device.label}));
}
