import { useMemo, useState } from "react";
import { ladderScale } from "../lib/ladderPlot";
import { placeScatterLabels } from "../lib/scatterLayout";
import { useChartSize } from "../lib/useChartSize";
import type { ModelFamily } from "../lib/modelComparison";
import type { TaskCostModel } from "../lib/types";
import type { CSSProperties } from "react";

export type ComparisonPoint = { family: ModelFamily; configuration: TaskCostModel; cost: number };
const referenceCount = 5;

function tickCost(value: number) {
  return value < 0.000001 ? value.toExponential(0) : Number(value.toPrecision(3)).toString();
}

export function ModelCostChart({ rows, selectedId, onSelect, formatCost }: {
  rows: ComparisonPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  formatCost: (value: number) => string;
}) {
  const chart = useChartSize(1000, 460);
  const [hover, setHover] = useState<string | null>(null);
  const { bounds, scale, points, labels } = useMemo(() => {
    const bounds = { left: 52, right: chart.width - 24, top: 40, bottom: chart.height - 61 };
    const data = rows.map(({ family, configuration, cost }) => ({
      id: family.id, name: family.name, family, configuration, cost, score: configuration.index,
    }));
    const scale = ladderScale(data, bounds);
    const points = data.map(point => ({ ...point, x: scale.x(point.cost), y: scale.y(point.score) }));
    const byCost = [...points].sort((a, b) => a.cost - b.cost || b.score - a.score || a.id.localeCompare(b.id));
    const frontier: typeof points = [];
    for (const point of byCost) {
      if (point.score > (frontier[frontier.length - 1]?.score ?? -Infinity)) frontier.push(point);
    }
    // A few reference models along the trade-off make the plot readable at app width.
    const count = Math.min(referenceCount, frontier.length);
    const references = Array.from({ length: count }, (_, i) =>
      frontier[Math.round(i * (frontier.length - 1) / Math.max(1, count - 1))]);
    const labels = placeScatterLabels(points, bounds, references);
    return { bounds, scale, points, labels };
  }, [rows, chart.width, chart.height]);
  const active = points.find(point => point.id === hover);
  const focusId = active?.id ?? (points.some(point => point.id === selectedId) ? selectedId : points[0]?.id);

  return <div className="task-scatter scatter-panel" data-measured={chart.measured}>
    <svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${chart.height}`} data-plot-width={chart.width}
      data-plot-height={chart.height} role="group" aria-label="AA 综合指数与单任务成本散点图"
      onKeyDown={event => {
        if (event.key === "Escape") setHover(null);
        if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)) return;
        const items = [...event.currentTarget.querySelectorAll<SVGGElement>(".task-plot-point")];
        const index = items.findIndex(item => item === document.activeElement);
        if (index < 0) return;
        event.preventDefault();
        const direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        items[(index + direction + items.length) % items.length].focus();
      }}>
      <text x={bounds.left} y={20} className="task-axis-caption">Intelligence Index</text>
      <path className="task-plot-frame" d={`M${bounds.left},${bounds.top}V${bounds.bottom}H${bounds.right}`} />
      {scale.scoreTicks.map(value => <g key={value} aria-hidden="true">
        <line className="task-plot-grid" x1={bounds.left} x2={bounds.right} y1={scale.y(value)} y2={scale.y(value)}/>
        <text className="task-axis-tick" x={bounds.left - 12} y={scale.y(value) + 4} textAnchor="end">{value}</text>
      </g>)}
      {scale.ticks.map(value => <g key={value} aria-hidden="true">
        <line className="task-plot-grid" x1={scale.x(value)} x2={scale.x(value)} y1={bounds.top} y2={bounds.bottom}/>
        <text className="task-axis-tick" x={scale.x(value)} y={bounds.bottom + 23} textAnchor="middle">{tickCost(value)}</text>
      </g>)}
      <text x={(bounds.left + bounds.right) / 2} y={chart.height - 10} textAnchor="middle" className="task-axis-caption">
        单任务成本（美元）
      </text>
      {points.map(point => {
        const label = labels.get(point.id);
        return <g className={`task-plot-point${label ? " task-reference-point" : ""}`} key={point.id}
          role="button" tabIndex={point.id === focusId ? 0 : -1}
          aria-label={`${point.configuration.name}，${point.score.toFixed(1)} 分，${formatCost(point.cost)}`}
          data-id={point.configuration.id} data-model={point.id} data-score={point.score} data-cost={point.cost}
          data-plot-x={point.x} data-plot-y={point.y}
          onFocus={() => setHover(point.id)} onBlur={() => setHover(null)}
          onMouseEnter={() => setHover(point.id)} onMouseLeave={() => setHover(null)}
          onClick={() => onSelect(point.id)}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.id); }
          }}>
          <circle className="task-point-hit" cx={point.x} cy={point.y} r={8}/>
          <circle className="task-point-mark" cx={point.x} cy={point.y} r={label ? 5 : 4}/>
          {label && <>
            <rect className="task-point-hit" x={label.left} y={label.y - 9} width={label.width} height={18}/>
            <text className="task-point-label" x={label.left + 3} y={label.y + 4} aria-hidden="true">{label.label}</text>
          </>}
        </g>;
      })}
      {active && <circle aria-hidden="true" className="task-point-hover" cx={active.x} cy={active.y} r={6}/>}
    </svg>
    {active && <div role="tooltip" className="scatter-tooltip task-cost-tooltip" style={{
      left: Math.max(6, Math.min(chart.width - 281, active.x + 12)),
      "--tooltip-y": `${active.y}px`,
      "--tooltip-offset": active.y < 122 ? "15px" : "calc(-100% - 10px)",
    } as CSSProperties}>
      <b>{active.configuration.name}</b>
      <div><strong>{active.score.toFixed(1)} 分</strong><span>{formatCost(active.cost)} / 任务</span></div>
    </div>}
  </div>;
}
