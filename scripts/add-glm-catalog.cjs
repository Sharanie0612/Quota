/* 把 docs/model-catalog.md 第 3 节的智谱 GLM 现役价目表补进 model_catalog.json。
   数据逐条抄自文档（2026-09-23 对照官网核实），本脚本幂等：已有同名条目则跳过。
   运行：node scripts/add-glm-catalog.cjs */

const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "src-tauri", "data", "model_catalog.json");
const SOURCE = "https://docs.bigmodel.cn/cn/guide/start/pricing";
const VERIFIED_AT = "2026-09-23T00:00:00+08:00";

// [id, 显示名, 一句话简介, 上下文, 最长输出, 输入价, 输出价, 能力, 阶梯备注]
// 输入/输出价：数字 = 首档非缓存价；"free" = 官方免费；null = 官网定价表未列出（不编造）
const ROWS = [
  ["glm-5.3", "GLM-5.3", "始终思考的旗舰，编程智能体强", 1000000, 128000, 8, 28, ["工具调用", "推理", "代码"], null],
  ["glm-5.3-flash", "GLM-5.3-Flash", "原生多模态，图视频文件理解", 1000000, 128000, 0.8, 2.8, ["视觉", "工具调用", "推理", "代码"], null],
  ["glm-5.3-flashx", "GLM-5.3-FlashX", "多模态高速版，约 200 tok/s", 1000000, 128000, 2, 7, ["视觉", "工具调用", "推理"], null],
  ["glm-5.2", "GLM-5.2", "工程交付与长程任务见长", 1000000, 128000, 8, 28, ["工具调用", "推理", "代码"], null],
  ["glm-5.1", "GLM-5.1", "编码对标 Opus 4.6，可长程自主", 200000, 128000, 6, 24, ["工具调用", "推理", "代码"], "输入 ≥32K 档 8/28"],
  ["glm-5-turbo", "GLM-5-Turbo", "长任务连续性优化版", 200000, 128000, 5, 22, ["工具调用", "推理", "代码"], "输出 ≥32K 档 7/26"],
  ["glm-5", "GLM-5", "Agentic 长程规划与执行", 200000, 128000, 4, 18, ["工具调用", "推理", "代码"], "≥32K 档 6/22"],
  ["glm-4.7", "GLM-4.7", "通用对话推理，智能体升级", 200000, 128000, 2, 8, ["工具调用", "推理", "代码"], "输出 ≥0.2K 档 3/14；输入 [32K,200K) 档 4/16"],
  ["glm-4.7-flashx", "GLM-4.7-FlashX", "轻量高速，小尺寸强能力", 200000, 128000, 0.5, 3, ["推理", "工具调用"], null],
  ["glm-4.7-flash", "GLM-4.7-Flash", "免费通用文本模型", 200000, 128000, "free", "free", ["工具调用", "推理"], null],
  ["glm-4.6", "GLM-4.6", "高级编码，复杂推理与工具调用", 200000, 128000, null, null, ["工具调用", "推理", "代码"], "官网 API 定价表未列出价格，以官网为准"],
  ["glm-4.5-air", "GLM-4.5-Air", "推理编码智能体均衡轻量", 128000, 96000, 0.8, 2, ["工具调用", "推理", "代码"], "输出 ≥0.2K 档 0.8/6；输入 [32K,128K) 档 1.2/8"],
  ["glm-5v-turbo", "GLM-5V-Turbo", "多模态 Coding 视觉基座", 200000, 128000, 5, 22, ["视觉", "推理", "代码"], "输出 ≥32K 档 7/26"],
  ["glm-4.6v", "GLM-4.6V", "原生工具调用，前端复刻强", 128000, 32000, 1, 3, ["视觉", "工具调用", "代码"], "[32K,128K) 档 2/6"],
  ["glm-4.6v-flashx", "GLM-4.6V-FlashX", "高并发视觉推理", 128000, 32000, 0.15, 1.5, ["视觉", "推理"], "[32K,128K) 档 0.3/3"],
  ["glm-4.6v-flash", "GLM-4.6V-Flash", "免费视觉推理模型", 128000, 32000, "free", "free", ["视觉", "推理"], null],
  ["glm-4.5v", "GLM-4.5V", "视觉理解多模态模型", 64000, null, 2, 6, ["视觉", "推理"], "[32K,64K) 档 4/12"],
  ["glm-4.1v-thinking-flashx", "GLM-4.1V-Thinking-FlashX", "复杂场景视觉思考", 64000, 16000, 2, 6, ["视觉", "推理"], null],
  ["glm-4.1v-thinking-flash", "GLM-4.1V-Thinking-Flash", "免费视觉思考模型", 64000, 16000, "free", "free", ["视觉", "推理"], null],
  ["glm-4v-flash", "GLM-4V-Flash", "免费图像理解模型", 4000, null, "free", "free", ["视觉"], null],
  ["glm-4-long", "GLM-4-Long", "超长文本与记忆型任务", 1000000, 4000, 1, 1, [], null],
  ["glm-4-flashx-250414", "GLM-4-FlashX-250414", "高并发增强高速版", 128000, 16000, 0.1, 0.1, ["工具调用", "推理"], null],
  ["glm-4-flash-250414", "GLM-4-Flash-250414", "免费文本模型", 128000, 16000, "free", "free", [], null],
  ["glm-ocr", "GLM-OCR", "轻量高精图文文档解析", 32000, null, 0.2, 0.2, ["视觉"], null],
  ["codegeex-4", "CodeGeeX-4", "代码补全与生成模型", 128000, 32000, 0.1, 0.1, ["代码"], "官网统一单价 0.1，不区分输入/输出"],
];

function priceFor(input, output, tierNote) {
  if (input === null && output === null) {
    return { currency: "CNY", unit: "每 1M tokens", input: null, output: null, note: tierNote || null };
  }
  const free = input === "free";
  const note = free
    ? "官方标注免费，价格随时可能调整，以官网为准"
    : tierNote;
  return {
    currency: "CNY",
    unit: "每 1M tokens",
    input: free ? 0 : input,
    output: free ? 0 : output,
    note: note || null,
  };
}

function entryFor([id, name, summary, ctx, maxOut, input, output, abilities, tierNote]) {
  return {
    match: [id],
    name,
    vendor: "智谱 AI",
    providers: ["zhipu", "siliconflow", "custom"],
    summary,
    context: ctx,
    maxOutput: maxOut,
    price: priceFor(input, output, tierNote),
    abilities,
    verified: true,
    verifiedAt: VERIFIED_AT,
    source: SOURCE,
  };
}

const file = JSON.parse(fs.readFileSync(FILE, "utf8"));
const existing = new Set(file.entries.map((e) => e.name));
const add = ROWS.map(entryFor).filter((e) => !existing.has(e.name));

if (add.length === 0) {
  console.log("GLM 条目已全部存在，无需改动。");
  process.exit(0);
}

// 插在第一条 hidden 条目（DeepSeek V3 系列）之前，保持现役条目在前、过时条目在后
const firstHidden = file.entries.findIndex((e) => e.hidden === true);
const at = firstHidden === -1 ? file.entries.length : firstHidden;
file.entries.splice(at, 0, ...add);

fs.writeFileSync(FILE, JSON.stringify(file, null, 2));
console.log(`已插入 ${add.length} 条 GLM 条目（位置 ${at}），总计 ${file.entries.length} 条。`);
