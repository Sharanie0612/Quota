import type { BenchmarkObservation, BenchmarkProfile } from "./types";

export const aaSource = "artificial-analysis";
export const aaMethodology = "https://artificialanalysis.ai/methodology/intelligence-benchmarking";
export const aaLeaderboard = "https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index";

type Part = { metric: string; weight: number; unit: "percent" | "Elo"; label?: string };
type Evaluation = { name: string; tasks: number; repeats: number; scoring: string; parts: Part[] };
type Domain = { id: string; label: string; evaluations: Evaluation[] };

const percent = (metric: string, weight: number, label?: string): Part => ({
  metric, weight, unit: "percent", label,
});

// The v5.0.1 CritPt regrade did not change the index weights.
export const aaDomains: Domain[] = [
  {
    id: "knowledge-work", label: "知识工作",
    evaluations: [
      {
        name: "AA-Briefcase v1.1", tasks: 91, repeats: 1, scoring: "工作交付物评分与成对比较",
        parts: [{ metric: "AA-Briefcase v1.1", weight: 15, unit: "Elo" }],
      },
      {
        name: "AutomationBench-AA", tasks: 657, repeats: 1, scoring: "工作流目标完成率，触发违规条件时记零",
        parts: [percent("AutomationBench-AA", 5)],
      },
      {
        name: "GDP.pdf", tasks: 100, repeats: 5, scoring: "基于长 PDF 作答，所有评分项均通过才得分",
        parts: [percent("GDP.pdf", 5)],
      },
    ],
  },
  {
    id: "coding", label: "编程",
    evaluations: [
      {
        name: "FrontierCode-AA 2.0", tasks: 132, repeats: 3, scoring: "在开源仓库完成改动，通过测试和评分规则",
        parts: [percent("FrontierCode 2.0", 15)],
      },
      {
        name: "Terminal-Bench 4.0", tasks: 66, repeats: 3, scoring: "终端任务 · pass@1",
        parts: [percent("Terminal-Bench 4.0", 10)],
      },
    ],
  },
  {
    id: "science", label: "科学",
    evaluations: [
      {
        name: "Terminal-Bench-Science 0.1", tasks: 70, repeats: 3, scoring: "终端科研任务 · pass@1",
        parts: [percent("Terminal-Bench-Science 0.1", 15)],
      },
      {
        name: "CritPt v2（困难子集）", tasks: 40, repeats: 5, scoring: "物理研究难题 · 官方评分服务器 · pass@1",
        parts: [percent("CritPt v2 · hard subset", 10)],
      },
    ],
  },
  {
    id: "general-knowledge", label: "通用",
    evaluations: [
      {
        name: "AA-Omniscience v1.1", tasks: 3000, repeats: 1, scoring: "开放问答，分别衡量答对与避免幻觉",
        parts: [
          percent("AA-Omniscience v1.1 · accuracy", 10, "准确率"),
          percent("AA-Omniscience v1.1 · non-hallucination", 5, "非幻觉率"),
        ],
      },
      {
        name: "HLE-Diamond", tasks: 1000, repeats: 1, scoring: "跨学科开放问答 · pass@1",
        parts: [percent("HLE-Diamond", 10)],
      },
    ],
  },
];

export const visualAxes = aaDomains.map(({ id, label }) => ({ key: id, label }));
export const scoreOptions = [{ key: "general", label: "综合指数" }, ...visualAxes];
export const evaluationWeight = (evaluation: Evaluation) => evaluation.parts.reduce((sum, part) => sum + part.weight, 0);

export function aaVersion(version: string | undefined) {
  if (version === "Intelligence Index v5") return "v5.0";
  if (version === "Intelligence Index v5.0.1") return "v5.0.1";
  return null;
}

type ProfileBreakdown = {
  scores: Record<string, number>;
  raw: ReadonlyMap<string, BenchmarkObservation>;
  coverage: number;
};

export function profileBreakdown(profile: BenchmarkProfile, observations: BenchmarkObservation[]): ProfileBreakdown {
  const raw = new Map<string, BenchmarkObservation>();
  const conflicts = new Set<string>();
  const known = new Map(aaDomains.flatMap(domain => domain.evaluations.flatMap(evaluation =>
    evaluation.parts.map(part => [part.metric, part.unit] as const))));
  known.set("MMMU-Pro", "percent");
  for (const row of observations) {
    if (row.official || row.sourceId !== aaSource || row.profileId !== profile.id || row.modelId !== profile.modelId
      || row.vendor !== profile.vendor || row.setting !== profile.setting) continue;
    const unit = known.get(row.metric);
    if (!unit || unit !== row.unit || !Number.isFinite(row.value) || row.value < 0
      || row.value > (unit === "Elo" ? 5000 : 100)) continue;
    if (conflicts.has(row.metric)) continue;
    const previous = raw.get(row.metric);
    if (previous && previous.value !== row.value) {
      conflicts.add(row.metric);
      raw.delete(row.metric);
    } else {
      raw.set(row.metric, row);
    }
  }

  const scores: Record<string, number> = {};
  let coverage = 0;
  for (const domain of aaDomains) {
    const parts = domain.evaluations.flatMap(evaluation => evaluation.parts);
    let points = 0;
    let weight = 0;
    for (const part of parts) {
      const observation = raw.get(part.metric);
      if (!observation) continue;
      const score = part.unit === "Elo"
        ? Math.max(0, Math.min(100, (observation.value - 500) / 20))
        : observation.value;
      points += score * part.weight;
      weight += part.weight;
    }
    coverage += domain.evaluations.filter(evaluation => evaluation.parts.every(part => raw.has(part.metric))).length;
    const total = parts.reduce((sum, part) => sum + part.weight, 0);
    if (weight === total) scores[domain.id] = points / total;
  }
  return { scores, raw, coverage };
}
