import type { ActivityGroup, ActivityTokens } from "./types";

export type TimeScale = "day" | "week" | "month";
export type ActivityMetric = "total" | "input" | "output" | "cached";
export type ActivityRange = { from: string; to: string };
export function periodRange(key: string, scale: TimeScale, first: string, last: string): ActivityRange | null {
  const start = parseDay(key);
  if (!start) return null;
  const end = new Date(start);
  if (scale === "week") end.setDate(end.getDate() + 6);
  if (scale === "month") end.setMonth(end.getMonth() + 1, 0);
  const from = key < first ? first : key;
  const to = dateKey(end) > last ? last : dateKey(end);
  return from <= to ? { from, to } : null;
}
export type UsageDay = { key: string; tokens: ActivityTokens; recorded: boolean };
export const emptyTokens = (): ActivityTokens => ({ input: 0, output: 0, cached: 0, cacheWrite: 0, reasoning: 0, total: 0 });
export const dateKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
export function parseDay(key: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
  const [y, m, d] = key.split("-").map(Number);
  const date = new Date(y, m - 1, d, 12);
  return dateKey(date) === key ? date : null;
}
export function addTokens(target: ActivityTokens, source: ActivityTokens) {
  for (const key of Object.keys(target) as (keyof ActivityTokens)[]) {
    const value = source[key];
    if (Number.isFinite(value) && value >= 0) target[key] += value;
  }
}
/** Calendar days use local dates (the same timezone as the backend daily buckets). */
export function usageCalendar(rows: ActivityGroup[], days: number, now = new Date(), year?: number): UsageDay[] {
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
  const valid = rows.filter(row => parseDay(row.key) && row.key <= dateKey(end));
  const start = new Date(end);
  if (days > 0) start.setDate(start.getDate() - Math.max(0, Math.floor(days) - 1));
  else if (year != null) {
    start.setFullYear(year, 0, 1);
    if (year < end.getFullYear()) end.setFullYear(year, 11, 31);
  } else if (valid.length) start.setTime(parseDay(valid.map(row => row.key).sort()[0])!.getTime());
  const byDay = new Map<string, UsageDay>();
  for (const row of valid) {
    const item = byDay.get(row.key) ?? { key: row.key, tokens: emptyTokens(), recorded: true };
    addTokens(item.tokens, row.tokens); byDay.set(row.key, item);
  }
  const result: UsageDay[] = [];
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
    const key = dateKey(date);
    result.push(byDay.get(key) ?? { key, tokens: emptyTokens(), recorded: false });
  }
  return result;
}
export function bucketUsage(days: UsageDay[], scale: TimeScale): UsageDay[] {
  const groups = new Map<string, UsageDay>();
  for (const day of days) {
    const date = parseDay(day.key);
    if (!date) continue;
    if (scale === "week") date.setDate(date.getDate() - (date.getDay() + 6) % 7);
    if (scale === "month") date.setDate(1);
    const key = dateKey(date);
    const group = groups.get(key) ?? { key, tokens: emptyTokens(), recorded: false };
    addTokens(group.tokens, day.tokens); group.recorded ||= day.recorded;
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key));
}
export function heatLevel(value: number, max: number): number {
  if (!(value > 0) || !(max > 0)) return 0;
  return Math.min(4, Math.max(1, Math.ceil(value / max * 4)));
}
/** Smooth through observed points without overshooting either endpoint. No prediction. */
export function smoothUsagePath(points: { x: number; y: number }[]): string {
  if (!points.length) return "";
  return `M ${points[0].x} ${points[0].y}` + points.slice(1).map((point, index) => {
    const previous = points[index]; const step = (point.x - previous.x) / 3;
    return ` C ${previous.x + step} ${previous.y}, ${point.x - step} ${point.y}, ${point.x} ${point.y}`;
  }).join("");
}
