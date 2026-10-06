import type { LadderEntry } from "./types";
export type LadderMetric = "total" | "input" | "output";
export type LadderExchange = { cnyPerUsd: number; date: string; error: string | null };
export const plotBounds = { left: 62, right: 842, top: 44, bottom: 332 };

/** Only explicit Token units can share the per-million price axis. */
export function tokenUnitMultiplier(unit: string): number | null {
  const value = unit.replace(/\s+/g, "").toLowerCase();
  if (["每百万tokens", "每百万token", "每1mtokens", "每1mtoken", "per1mtokens"].includes(value)) return 1;
  if (["每千tokens", "每千token", "每1ktokens", "每1ktoken", "per1ktokens"].includes(value)) return 1000;
  return null;
}
export function comparisonPrice(entry: LadderEntry, metric: LadderMetric): number | null {
  const factor = tokenUnitMultiplier(entry.price.unit);
  const values = metric === "input" ? [entry.price.input] : metric === "output" ? [entry.price.output] : [entry.price.input, entry.price.output];
  if (factor == null || values.some(value => value == null || !Number.isFinite(value) || value < 0)) return null;
  const value = values.reduce<number>((sum, price) => sum + price!, 0) * factor;
  return Number.isFinite(value) ? value : null;
}
export function validExchange(exchange: LadderExchange | null | undefined): exchange is LadderExchange {
  return !!exchange && Number.isFinite(exchange.cnyPerUsd) && exchange.cnyPerUsd > 0;
}
export function plotPrice(entry: LadderEntry, metric: LadderMetric, currency: string, exchange?: LadderExchange | null): number | null {
  const price = comparisonPrice(entry, metric);
  if (price == null) return null;
  const converted = entry.price.currency === currency ? price
    : currency === "CNY" && entry.price.currency === "USD" && validExchange(exchange) ? price * exchange.cnyPerUsd : null;
  return converted != null && Number.isFinite(converted) ? converted : null;
}
/** Coordinates depend on price and score only, never on neighbouring models. */
export function ladderScale(points: { cost: number; score: number }[]) {
  const max = Math.max(1, ...points.map(point => point.cost));
  const min = Math.max(0, Math.floor(Math.min(100, ...points.map(point => point.score)) / 10) * 10 - 10);
  const x = (value: number) => plotBounds.left + Math.log1p(value) / Math.log1p(max) * (plotBounds.right - plotBounds.left);
  const y = (value: number) => plotBounds.bottom - (value - min) / (100 - min) * (plotBounds.bottom - plotBounds.top);
  const ticks = [0];
  for (let exponent = -6; exponent <= 308; exponent++) {
    for (const multiple of [1, 2, 5]) {
      const value = multiple * 10 ** exponent;
      if (value <= max && x(value) - x(ticks[ticks.length - 1]) > 48) ticks.push(value);
    }
  }
  if (x(max) - x(ticks[ticks.length - 1]) > 48) ticks.push(max);
  else ticks[ticks.length - 1] = max;
  return { max, min, x, y, ticks };
}
