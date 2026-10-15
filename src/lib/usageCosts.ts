import type { ActivityTokens, UsageRate, UsagePriceReference } from "./types";

const million = 1_000_000;
const validPrice = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n >= 0;
export function exactUsagePrice(model: string, references: UsagePriceReference[]) {
  const matches = references.filter(ref => ref.aliases.some(alias => alias.toLowerCase() === model.toLowerCase())
    && ["每 1M tokens", "每百万 tokens"].includes(ref.price.unit) && ["CNY", "USD"].includes(ref.price.currency));
  return matches.sort((a, b) => b.verifiedAt.localeCompare(a.verifiedAt))[0] ?? null;
}

export function referenceRate(ref: UsagePriceReference | null): UsageRate | null {
  if (!ref) return null;
  return { currency: ref.price.currency, input: ref.price.input, output: ref.price.output,
    cachedInput: ref.price.cachedInput ?? null,
    // Without cache TTL in the usage logs, two write tiers cannot be chosen automatically.
    cacheWrite: ref.price.cacheWriteLong != null ? null : ref.price.cacheWrite ?? null };
}

export function usageCost(tokens: ActivityTokens, rate: UsageRate | null) {
  const issues: string[] = [];
  const counts = [tokens.input, tokens.cached, tokens.cacheWrite, tokens.output, tokens.reasoning, tokens.total];
  if (counts.some(n => !Number.isFinite(n) || n < 0) || tokens.cached + tokens.cacheWrite > tokens.input || tokens.reasoning > tokens.output) {
    return { amount: null, effective: null, parts: [], issues: ["用量子项不一致，无法准确计费"] };
  }
  const components = [
    { label: "未命中输入", count: tokens.input - tokens.cached - tokens.cacheWrite, price: rate?.input },
    { label: "缓存命中", count: tokens.cached, price: rate?.cachedInput },
    { label: "缓存写入", count: tokens.cacheWrite, price: rate?.cacheWrite },
    { label: "输出", count: tokens.output, price: rate?.output },
  ];
  if (!rate) issues.push("没有精确型号的已核实价格，请填写使用单价");
  else if (!["CNY", "USD"].includes(rate.currency)) issues.push("币种不支持");
  const parts = components.map(c => {
    if (c.count > 0 && !validPrice(c.price)) issues.push(`${c.label}单价待补充`);
    return { ...c, amount: c.count === 0 ? 0 : validPrice(c.price) ? c.count * c.price / million : null };
  });
  const amount = issues.length ? null : parts.reduce((sum, p) => sum + (p.amount ?? 0), 0);
  const billedTokens = tokens.input + tokens.output;
  return { amount, effective: amount != null && billedTokens > 0 ? amount * million / billedTokens : null, parts, issues };
}

export function billEffective(amount: number | null, tokens: ActivityTokens): number | null {
  const count = tokens.input + tokens.output;
  return validPrice(amount) && Number.isFinite(count) && count > 0 ? amount * million / count : null;
}
