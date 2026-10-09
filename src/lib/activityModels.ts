import type { ActivityGroup } from "./types";

/** Model rows carry the usage channel after a unit separator that model names cannot contain. */
const separator = "\u001f";
const channelNames: Record<string, string> = { trae: "Trae 提供", api: "API 接入", unknown: "未鉴别" };

/** Display name of a model row, without its channel suffix. */
export function activityModelName(key: string) { return key.split(separator)[0]; }

/** Usage channel of a model row: "trae", "api" or "" when undetermined. */
export function activityModelChannel(key: string) { return key.split(separator)[1] ?? ""; }

/** Chinese label for a usage channel; "unknown" is the channel summary bucket. */
export function activityChannelName(channel: string) { return channelNames[channel] ?? ""; }

/** Classify for display only; the original ID is always passed to the backend. */
export function activityModelIdentity(key: string) {
  const raw = activityModelName(key).toLowerCase();
  const name = raw.split("/").pop() ?? raw;
  if (/^(gpt|o[134](?:-|$)|codex)/.test(name) || /^openai\//.test(raw)) return { provider: "custom", vendor: "OpenAI" };
  if (/^deepseek/.test(name)) return { provider: "deepseek", vendor: "DeepSeek" };
  if (/^glm/.test(name) || /^(zai|z-ai|zhipu)\//.test(raw)) return { provider: "zhipu", vendor: "智谱 GLM" };
  if (/^(kimi|moonshot)/.test(name)) return { provider: "moonshot", vendor: "Kimi" };
  if (/^mimo/.test(name) || /^xiaomi\//.test(raw)) return { provider: "mimo", vendor: "小米 MiMo" };
  if (/^claude/.test(name) || /^anthropic\//.test(raw)) return { provider: "anthropic", vendor: "Anthropic" };
  if (/^gemini/.test(name) || /^google\//.test(raw)) return { provider: "google", vendor: "Google" };
  if (/^qwen/.test(name) || /^alibaba\//.test(raw)) return { provider: "alibaba", vendor: "Alibaba" };
  return { provider: "unknown", vendor: "其他 / 未识别" };
}

export function activityModelChoices(rows: ActivityGroup[], search: string) {
  const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = (key: string) => `${activityModelName(key)} ${activityModelIdentity(key).vendor} ${activityChannelName(activityModelChannel(key))}`.toLowerCase();
  return rows.filter(row => row.key !== "" && !activityModelChannel(row.key) && words.every(word => text(row.key).includes(word)))
    .sort((a, b) => activityModelIdentity(a.key).vendor.localeCompare(activityModelIdentity(b.key).vendor, "zh-CN") || b.tokens.total - a.tokens.total || a.key.localeCompare(b.key));
}

/** Channels present in the given rows, in a stable order. */
export function activityChannels(rows: ActivityGroup[]) {
  const present = new Set(rows.map(row => activityModelChannel(row.key)).filter(Boolean));
  return (["trae", "api"] as const).filter(channel => present.has(channel));
}

/** Readable label for the current model/channel/vendor filter value. */
export function activityFilterLabel(value: string) {
  if (!value) return "";
  if (value.startsWith("channel:")) return activityChannelName(value.slice(8)) || "Trae 用量通道";
  if (value.startsWith("vendor:")) return "供应商汇总";
  const channel = activityChannelName(activityModelChannel(value));
  return channel ? `${activityModelName(value)} · ${channel}` : activityModelName(value);
}
