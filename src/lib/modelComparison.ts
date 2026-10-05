import type { ModelCard } from "./types";

/** 缺失计价条件不能按零成本参与比较。 */
export function comparisonCost(card: ModelCard): number {
  const price = card.price;
  if (!price?.currency.trim() || !price.unit.trim() || price.input == null || price.output == null
    || !Number.isFinite(price.input) || !Number.isFinite(price.output) || price.input < 0 || price.output < 0) {
    return Number.POSITIVE_INFINITY;
  }
  const cost = price.input + price.output;
  return Number.isFinite(cost) ? cost : Number.POSITIVE_INFINITY;
}

function unitKey(unit: string): string {
  const compact = unit.replace(/\s+/g, "");
  const key = compact.toLowerCase();
  return ["每1mtokens", "每1mtoken", "每百万tokens", "每百万token", "per1mtokens"].includes(key)
    ? "tokens/1000000" : compact;
}

export interface ModelComparisonGroup {
  key: string;
  currency: string;
  unit: string;
  cards: ModelCard[];
  maxCost: number;
}

/** 各币种、各计价单位独立排序及缩放，不假设汇率或缺失单位。 */
export function groupModelComparisons(cards: ModelCard[]): ModelComparisonGroup[] {
  const groups = new Map<string, ModelComparisonGroup>();
  for (const card of cards) {
    const currency = card.price?.currency.trim().toUpperCase() ?? "";
    const unit = card.price?.unit.trim() ?? "";
    const normalizedUnit = unitKey(unit);
    const key = JSON.stringify([currency, normalizedUnit]);
    let group = groups.get(key);
    if (!group) {
      group = { key, currency, unit: normalizedUnit === "tokens/1000000" ? "每百万 Token" : unit, cards: [], maxCost: 0 };
      groups.set(key, group);
    }
    group.cards.push(card);
    const cost = comparisonCost(card);
    if (Number.isFinite(cost)) group.maxCost = Math.max(group.maxCost, cost);
  }
  for (const group of groups.values()) {
    group.cards.sort((a, b) => {
      const left = comparisonCost(a), right = comparisonCost(b);
      return left === right ? 0 : left < right ? -1 : 1;
    });
  }
  return [...groups.values()].sort((a, b) => a.currency === b.currency
    ? a.unit.localeCompare(b.unit, "zh-CN")
    : !a.currency ? 1 : !b.currency ? -1 : a.currency.localeCompare(b.currency));
}
