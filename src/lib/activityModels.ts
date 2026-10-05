import type { ActivityGroup } from "./types";

/** Classify for display only; the original ID is always passed to the backend. */
export function activityModelIdentity(key: string) {
  const raw = key.toLowerCase();
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
  return rows.filter(row => row.key !== "" && words.every(word => `${row.key} ${activityModelIdentity(row.key).vendor}`.toLowerCase().includes(word)))
    .sort((a, b) => activityModelIdentity(a.key).vendor.localeCompare(activityModelIdentity(b.key).vendor, "zh-CN") || b.tokens.total - a.tokens.total || a.key.localeCompare(b.key));
}
