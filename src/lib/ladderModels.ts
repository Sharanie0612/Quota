import type { LadderEntry } from "./types";

const effortPattern = /^(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:\b|,)/i;
export function reasoningLabel(entry: LadderEntry) {
  const named = entry.name.match(/[（(]([^）)]+)[）)]/)?.[1] ?? "";
  const effort = effortPattern.exec(named)?.[1] ?? /(?:^|-)(non-reasoning|xhigh|high|medium|low|max|minimal|reasoning)(?:-|$)/i.exec(entry.id)?.[1];
  return effort ? effort.toLowerCase().replace(/^./, char => char.toUpperCase()) : "未标注";
}
export function modelName(entry: LadderEntry) {
  return entry.name.replace(/\s*[（(]([^）)]+)[）)]/g, (whole, inside: string) => effortPattern.test(inside) ? "" : whole).trim();
}
export const modelFamily = (entry: LadderEntry) => JSON.stringify([entry.vendor, modelName(entry).toLowerCase()]);
const effortOrder = ["Non-reasoning", "Minimal", "Low", "Medium", "High", "Xhigh", "Max", "Reasoning", "未标注"];
export const compareNames = (a: string, b: string) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" });
export function modelFamilies(entries: LadderEntry[], sort = "vendor") {
  const groups = new Map<string, { key: string; name: string; vendor: string; variants: LadderEntry[] }>();
  for (const entry of entries) {
    const key = modelFamily(entry);
    const group = groups.get(key) ?? { key, name: modelName(entry), vendor: entry.vendor, variants: [] };
    group.variants.push(entry); groups.set(key, group);
  }
  return [...groups.values()].map(group => ({ ...group, variants: group.variants.sort((a, b) => effortOrder.indexOf(reasoningLabel(a)) - effortOrder.indexOf(reasoningLabel(b)) || compareNames(a.name, b.name)) }))
    .sort((a, b) => (sort === "vendor" ? compareNames(a.vendor, b.vendor) : 0) || compareNames(a.name, b.name) || compareNames(a.vendor, b.vendor));
}
// Only share a known release date within the exact same vendor and model family.
export function releaseDates(entries: LadderEntry[]) {
  const dates = new Map<string, string>();
  for (const entry of entries) {
    const date = entry.releasedAt?.slice(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) continue;
    const key = modelFamily(entry);
    if (!dates.has(key) || date < dates.get(key)!) dates.set(key, date);
  }
  return dates;
}
export function releasedWithin(date: string | undefined, days: number, now = new Date()) {
  if (!date) return false;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const released = Date.parse(`${date}T00:00:00Z`);
  const age = Math.round((today - released) / 86400000);
  return age >= 0 && age < days;
}
