import type { ReactNode } from "react";
import { aaDomains, aaVersion, evaluationWeight } from "../lib/aaMethodology";
import type { VisualModel } from "../lib/visualModels";
import { ModelLogo } from "./ModelLogo";
import { modelColors } from "./AbilityRadar";

const missing = <span className="benchmark-missing" title="该评测配置暂无可比较分数" aria-label="暂无分数">—</span>;
const format = (score: number | undefined, unit = "") => score === undefined ? missing : <>{score.toFixed(1)}{unit}</>;

function matrixRow(models: VisualModel[], title: ReactNode, value: (model: VisualModel) => ReactNode, className?: string) {
  return <tr className={className}>
    <th scope="row">{title}</th>
    {models.map(model => <td key={model.profile.id}>{value(model)}</td>)}
  </tr>;
}

export function BenchmarkBreakdown({ models }: { models: VisualModel[] }) {
  return <table className="benchmark-breakdown">
    <thead>
      <tr>
        <th scope="col">评测项目</th>
        {models.map((model, index) => <th scope="col" key={model.profile.id}>
          <span className="benchmark-column-name" style={{ borderColor: modelColors[index] }}>
            <ModelLogo name={model.entry.name} size={18} />
            <span>{model.model.name}<small>{model.profile.setting}</small></span>
          </span>
        </th>)}
      </tr>
    </thead>
    <tbody>
      {matrixRow(models, "AA 综合指数", model => <>
        {format(model.profile.index)}
        <small>{aaVersion(model.profile.version)}</small>
      </>, "benchmark-index-row")}
    </tbody>
    {aaDomains.map(domain => <tbody key={domain.id}>
      {matrixRow(models, <>{domain.label}<small>领域分 · 权重 25%</small></>, model => format(model.breakdown.scores[domain.id]), "benchmark-domain-row")}
      {domain.evaluations.map(evaluation => <tr key={evaluation.name}>
        <th scope="row">
          {evaluation.name}<small>{evaluationWeight(evaluation)}% · {evaluation.tasks.toLocaleString("zh-CN")} 项 × {evaluation.repeats} 轮</small>
        </th>
        {models.map(model => <td key={model.profile.id}>
          {evaluation.parts.map(part => {
            const observation = model.breakdown.raw.get(part.metric);
            return <div key={part.metric} data-metric={part.metric} data-value={observation?.value}>
              {part.label && <small>{part.label} · {part.weight}%</small>}
              {format(observation?.value, part.unit === "Elo" ? " Elo" : "%")}
            </div>;
          })}
        </td>)}
      </tr>)}
    </tbody>)}
    <tbody>
      {matrixRow(models, <>MMMU-Pro<small>独立视觉评测</small></>, model => format(model.breakdown.raw.get("MMMU-Pro")?.value, "%"), "benchmark-domain-row")}
    </tbody>
  </table>;
}
