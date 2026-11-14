import { useId, useMemo, useState } from "react";
import { ladderScale } from "../lib/ladderPlot";
import { placeScatterLabels } from "../lib/scatterLayout";
import { useChartSize } from "../lib/useChartSize";
import type { ModelFamily } from "../lib/modelComparison";
import type { TaskCostModel } from "../lib/types";
import type { CSSProperties } from "react";

export type ComparisonPoint = { family: ModelFamily; configuration: TaskCostModel; cost: number };
type VendorColors = ReadonlyMap<string, string>;

const colors = ["--chart-2", "--chart-1", "--chart-3", "--chart-4", "--chart-5", "--blue", "--green", "--red", "--amber"];
const knownCreators: Record<string, number> = { OpenAI: 0, Anthropic: 1, Google: 2, DeepSeek: 3, Alibaba: 4, "Z AI": 5, Kimi: 6, Xiaomi: 7, Meta: 8 };

export function creatorColors(creators: string[]) {
  return new Map(creators.map(creator => {
    let key = 0;
    for (const char of creator) key = (key * 31 + char.charCodeAt(0)) >>> 0;
    const color = Object.prototype.hasOwnProperty.call(knownCreators, creator) ? knownCreators[creator] : key % colors.length;
    return [creator, `var(${colors[color]})`];
  }));
}

function tickCost(value: number) {
  return value < 0.000001 ? `$${value.toExponential(0)}` : `$${Number(value.toPrecision(3))}`;
}

export function ModelCostChart({ rows, vendorColors, selectedId, onSelect, formatCost }: {
  rows: ComparisonPoint[];
  vendorColors: VendorColors;
  selectedId: string | null;
  onSelect: (id: string) => void;
  formatCost: (value: number) => string;
}) {
  const chart = useChartSize(1000, 460);
  const gradient = useId();
  const [hover, setHover] = useState<string | null>(null);
  const { bounds, scale, points, frontier, labels } = useMemo(() => {
    const bounds = { left: 52, right: chart.width - 24, top: 40, bottom: chart.height - 61 };
    const data = rows.map(({ family, configuration, cost }) => ({
      id: family.id, name: family.name, family, configuration, cost, score: configuration.index,
    }));
    const scale = ladderScale(data, bounds);
    const points = data.map(point => ({ ...point, x: scale.x(point.cost), y: scale.y(point.score) }));
    const frontier: typeof points = [];
    for (const point of [...points].sort((a, b) => a.cost - b.cost || b.score - a.score || a.id.localeCompare(b.id))) {
      if (point.score > (frontier[frontier.length - 1]?.score ?? -Infinity)) frontier.push(point);
    }
    const preferred = new Set(frontier.map(point => point.id));
    if (selectedId) preferred.add(selectedId);
    const labels = placeScatterLabels(points, { ...bounds, top: bounds.top + 2, bottom: bounds.bottom - 1 }, preferred);
    return { bounds, scale, points, frontier, labels };
  }, [rows, chart.width, chart.height, selectedId]);
  const active = points.find(point => point.id === hover);
  const frontierIds = new Set(frontier.map(point => point.id));

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
      <defs><linearGradient id={gradient} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="var(--green-soft)"/><stop offset="100%" stopColor="var(--green-soft)" stopOpacity="0"/>
      </linearGradient></defs>
      <text x={bounds.left} y={20} className="task-axis-caption">Intelligence Index ↑</text>
      {frontier.length > 1 && <rect className="task-frontier-area" aria-hidden="true" x={bounds.left} y={bounds.top}
        width={bounds.right - bounds.left} height={bounds.bottom - bounds.top} fill={`url(#${gradient})`}/>}
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
        单任务成本（USD · 对数刻度） →
      </text>
      {frontier.length > 1 && <>
        <polyline className="task-frontier-line" data-frontier-ids={JSON.stringify(frontier.map(point => point.configuration.id))}
          points={frontier.map(point => `${point.x},${point.y}`).join(" ")}/>
        <text x={bounds.right} y={20} textAnchor="end" className="task-frontier-caption">┄ 帕累托前沿</text>
      </>}
      {points.map(point => {
        const label = labels.get(point.id);
        const picked = selectedId === point.id;
        return <g className={`task-plot-point${frontierIds.has(point.id) ? " on-frontier" : ""}`} key={point.id}
          style={{ "--point-color": vendorColors.get(point.family.creator) ?? "var(--blue)" } as CSSProperties}
          role="button" tabIndex={0} aria-pressed={picked}
          aria-label={`${point.configuration.name}，${point.score.toFixed(1)} 分，${formatCost(point.cost)}`}
          data-id={point.configuration.id} data-model={point.id} data-score={point.score} data-cost={point.cost}
          data-plot-x={point.x} data-plot-y={point.y}
          onFocus={() => setHover(point.id)} onBlur={() => setHover(null)}
          onMouseEnter={() => setHover(point.id)} onMouseLeave={() => setHover(null)}
          onClick={() => onSelect(point.id)}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(point.id); }
          }}>
          <circle className="task-point-hit" cx={point.x} cy={point.y} r={9}/>
          {picked && <circle className="task-point-selection" cx={point.x} cy={point.y} r={9}/>}
          <circle className="task-point-mark" cx={point.x} cy={point.y} r={picked ? 6 : 4.5}/>
          {label && <>
            {label.leader && <path className="task-label-leader"
              d={`M${point.x},${point.y}L${label.x},${label.x > label.left && label.x < label.left + label.width ? label.y + (point.y < label.y ? -8 : 8) : label.y}`}/>}
            <rect className="task-point-hit" x={label.left} y={label.y - 8.5} width={label.width} height={17}/>
            <text className="task-point-label" x={label.left + 3} y={label.y + 4} aria-hidden="true">{label.label}</text>
          </>}
        </g>;
      })}
      {active && !labels.has(active.id) && <circle aria-hidden="true" className="task-point-hover"
        cx={active.x} cy={active.y} r={8}/>}
    </svg>
    {active && <div role="tooltip" className="scatter-tooltip task-cost-tooltip" style={{
      left: Math.max(6, Math.min(chart.width - 291, active.x + 12)),
      top: active.y < 122 ? active.y + 17 : active.y - 104,
    }}>
      <b>{active.configuration.name}</b>
      <span>{active.family.creator}{active.family.releaseDate && ` · ${active.family.releaseDate}`}</span>
      <div><strong>{active.score.toFixed(1)} 分</strong><span>{formatCost(active.cost)} / 任务</span></div>
    </div>}
  </div>;
}
