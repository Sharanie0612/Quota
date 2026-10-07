import claude from "../assets/brands/claude-color.svg";
import gemini from "../assets/brands/gemini-color.svg";
import gemma from "../assets/brands/gemma-color.svg";
import banana from "../assets/brands/nanobanana-color.svg";
import deepseek from "../assets/brands/deepseek-color.svg";
import kimi from "../assets/brands/kimi.svg";
import glm from "../assets/brands/zai.svg";
import mimo from "../assets/brands/xiaomimimo.svg";
import qwen from "../assets/brands/qwen-color.svg";
import grok from "../assets/brands/grok.svg";
import { ProviderLogo } from "./logos";

const logos: Record<string, string> = { Claude: claude, Gemini: gemini, Gemma: gemma, "Nano Banana": banana, DeepSeek: deepseek, Kimi: kimi, GLM: glm, MiMo: mimo, Qwen: qwen, Grok: grok };
const monochrome = new Set(["Kimi", "MiMo", "Grok", "GLM"]);
export function modelBrand(name: string): string {
  name = name.split("/").pop() ?? name;
  for (const [pattern, brand] of [
    [/^gpt|^o\d|^tts-1|^chatgpt/i, "GPT"], [/^claude/i, "Claude"],
    [/^gemini/i, "Gemini"], [/^gemma/i, "Gemma"], [/^nano banana/i, "Nano Banana"],
    [/^deepseek/i, "DeepSeek"], [/^kimi|^moonshot/i, "Kimi"], [/^glm|^chatglm/i, "GLM"],
    [/^mimo/i, "MiMo"], [/^qwen/i, "Qwen"], [/^grok/i, "Grok"], [/^wan/i, "Wan"],
    [/^muse/i, "Muse"], [/^llama/i, "Llama"],
  ] as [RegExp, string][]) if (pattern.test(name)) return brand;
  return name.split(/[\s(（]/)[0] || "模型";
}
export function ModelLogo({ name, size = 24 }: { name: string; size?: number }) {
  const brand = modelBrand(name);
  return <span className={`vendor-logo${monochrome.has(brand) ? " vendor-logo-mono" : ""}`} data-model-brand={brand} style={{ width: size, height: size }}>
    {brand === "GPT" ? <ProviderLogo provider="openai" size={size} />
      : logos[brand] ? <img src={logos[brand]} alt={`${brand} 模型 Logo`} width={size} height={size} />
      : <span aria-label={`${brand} 模型缩写`} title={`${brand} 暂无独立 Logo，显示模型缩写`}>{brand.slice(0, 1)}</span>}
  </span>;
}
