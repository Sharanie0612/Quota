/** 金额、时间、供应商配色的展示工具 */

const CURRENCY_SYMBOL: Record<string, string> = {
  CNY: "¥",
  USD: "$",
  EUR: "€",
  JPY: "¥",
};

export function symbol(currency: string): string {
  return CURRENCY_SYMBOL[currency?.toUpperCase()] ?? "";
}

/** Credits 是 MiMo 订阅的额度单位（不是货币），显示时用单位后缀而不是货币符号 */
function isCredits(currency: string): boolean {
  const c = currency?.toUpperCase();
  return c === "CREDITS" || c === "CREDIT";
}

/** 余额显示：智能保留小数位。
 *  Credits（额度单位）数值可能上亿，直接显示完整数字没人看得懂，按 亿/万 紧凑显示。 */
export function money(value: number, currency = "CNY"): string {
  if (isCredits(currency)) {
    const abs = Math.abs(value);
    if (abs >= 1e8) return `${(value / 1e8).toFixed(2)} 亿 Credits`;
    if (abs >= 1e4) return `${(value / 1e4).toFixed(2)} 万 Credits`;
    return `${value.toFixed(0)} Credits`;
  }
  const abs = Math.abs(value);
  // 金额按 2 位小数显示；只有 0 之外、小于 0.01 的极小余额才保留 4 位
  const digits = abs > 0 && abs < 0.01 ? 4 : 2;
  const num = value.toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${symbol(currency)}${num}`;
}

export function priceText(v: number | null | undefined, currency = ""): string {
  if (v === null || v === undefined) return "—";
  if (v === 0) return `${symbol(currency)}0`; // 免费模型显示 ¥0，不要 ¥0.000
  const abs = Math.abs(v);
  const digits = abs >= 100 ? 0 : abs >= 1 ? 2 : 3;
  return `${symbol(currency)}${v.toFixed(digits)}`;
}

export function contextText(tokens: number | null | undefined): string | null {
  if (!tokens || tokens <= 0) return null;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${Number.isInteger(m) ? m : m.toFixed(1)}M`;
  }
  return `${Math.round(tokens / 1000)}K`;
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "尚未查询";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "尚未查询";
  const diff = Date.now() - t;
  if (diff < 0) return "刚刚";
  const sec = Math.floor(diff / 1000);
  if (sec < 45) return "刚刚";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return new Date(t).toLocaleDateString("zh-CN");
}

/** 供应商品牌色（苹果风格的低饱和渐变） */
const PROVIDER_COLORS: Record<string, [string, string]> = {
  deepseek: ["#4d6bfe", "#2a3fd8"],
  moonshot: ["#1f2937", "#4b5563"],
  zhipu: ["#3d5afe", "#1a237e"],
  dashscope: ["#7c3aed", "#4c1d95"],
  siliconflow: ["#0ea5e9", "#0369a1"],
  mimo: ["#ff6a00", "#c2410c"],
  openai: ["#10a37f", "#0b7a5f"],
  anthropic: ["#d97757", "#a8503a"],
  gemini: ["#4285f4", "#1a73e8"],
  custom: ["#6b7280", "#374151"],
};

export function providerColor(provider: string): [string, string] {
  return PROVIDER_COLORS[provider] ?? ["#8e8e93", "#636366"];
}

export function providerInitial(providerName: string, provider: string): string {
  if (provider === "deepseek") return "DS";
  if (provider === "moonshot") return "KM";
  if (provider === "zhipu") return "GL";
  if (provider === "dashscope") return "QW";
  if (provider === "siliconflow") return "SF";
  if (provider === "mimo") return "MI";
  if (provider === "openai") return "OA";
  if (provider === "anthropic") return "AN";
  if (provider === "gemini") return "GE";
  const first = providerName?.trim()?.[0];
  return first ? first.toUpperCase() : "··";
}

/** 余额来源的展示名（null 表示官方接口，不需要额外徽标） */
export function balanceSourceLabel(source: string): string | null {
  if (source === "manual") return "手动";
  if (source === "custom") return "自定义接口";
  if (source === "console") return "控制台 Cookie";
  if (source === "aliyun") return "阿里云账单";
  if (source === "costs") return "用量估算";
  return null;
}

/** 价格可信度 → 文案、色调与说明 */
export function confidenceMeta(level: string): {
  label: string;
  tone: "green" | "amber" | "red" | "gray";
  hint: string;
} {
  switch (level) {
    case "high":
      return { label: "价格已核实", tone: "green", hint: "价格已对照官方定价页核实过" };
    case "medium":
      return {
        label: "价格待复核",
        tone: "amber",
        hint: "有价格但未核实，可用「比价」抓官方定价页交叉核对",
      };
    case "low":
      return { label: "价格存疑", tone: "red", hint: "价格来自非核实来源，请对照官网确认" };
    default:
      return { label: "无价格", tone: "gray", hint: "资料库里还没有这个模型的价格" };
  }
}

/** 日期时间 → 「2026/9/23」这种短格式 */
export function dateText(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return new Date(t).toLocaleDateString("zh-CN");
}
