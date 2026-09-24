/* 精简内置资料库：只保留 deepseek / kimi / glm / mimo / gpt 系列，
   删除其余模型条目。用法：node scripts/trim-catalog.cjs */
const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "..", "src-tauri", "data", "model_catalog.json");
const cat = JSON.parse(fs.readFileSync(file, "utf8"));

// 要删掉的条目（按显示名精确匹配）
const drop = new Set([
  "通义千问 Qwen 系列",
  "Anthropic Claude 系列",
  "Google Gemini 系列",
  "开源/第三方托管模型",
]);

const before = cat.entries.length;
cat.entries = cat.entries.filter((e) => !drop.has(e.name));
cat.updatedAt = "2026-09-23";
cat.disclaimer =
  "只收录 DeepSeek / Kimi / 智谱 GLM / 小米 MiMo / GPT 系列。价格来自厂商官网公开定价页，标注「已核实」的条目为对照官网核对过；价格会变动，请以官网为准。可以在界面上编辑任意模型卡片，或用「比价」抓官方定价页交叉核对。";

fs.writeFileSync(file, JSON.stringify(cat, null, 2) + "\n", "utf8");
console.log(`条目 ${before} -> ${cat.entries.length}（删除 ${before - cat.entries.length} 条）`);
for (const e of cat.entries) console.log("  保留:", e.name);
