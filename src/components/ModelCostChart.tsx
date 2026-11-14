import { useMemo, useState, type CSSProperties, type Ref } from "react";
import { ladderScale } from "../lib/ladderPlot";
import { placeScatterLabels, plotPriceLabel } from "../lib/scatterLayout";
import { useChartSize } from "../lib/useChartSize";
import type { ModelFamily } from "../lib/modelComparison";
import type { TaskCostModel } from "../lib/types";

export type ComparisonPoint = { family: ModelFamily; configuration: TaskCostModel; cost: number };

// Creator colors match the published AA chart. Unknown creators get a stable color.
const creatorColors = new Map(Object.entries({
  Xiaomi: "#ff6900", OpenAI: "#1f1f1f", Anthropic: "#cc785c", InclusionAI: "#4fb5ff", "Inclusion AI": "#4fb5ff",
  SpaceXAI: "#736cd3", Kimi: "#047afe", Reflection: "#195428", Google: "#34a853",
  Alibaba: "#ff7018", "Z AI": "#1c7ff8", "Z.AI": "#1c7ff8", Tencent: "#5cb9ff", Meta: "#0089f4",
  NVIDIA: "#76b900", "Thinking Machines": "#676767", Mistral: "#f32e02", DeepSeek: "#2243e6",
}).map(([name, color]) => [name.toLowerCase(), color]));

export function chartCreatorColor(name: string) {
  const key = name.toLowerCase();
  const hash = [...key].reduce((value, letter) => Math.imul(value ^ letter.charCodeAt(0), 16777619) >>> 0, 2166136261);
  return creatorColors.get(key) ?? `hsl(${hash % 360} 63% 46%)`;
}

function costTicks(low: number, high: number, x: (value: number) => number, fallback: number[]) {
  const ticks: number[] = [];
  for (let decade = Math.floor(Math.log10(low)); decade <= Math.ceil(Math.log10(high)); decade++) {
    for (const multiple of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
      const value = multiple * 10 ** decade;
      const prior = ticks[ticks.length - 1];
      const spacing = prior ? 6 + 3.4 * (plotPriceLabel(prior, "USD").length + plotPriceLabel(value, "USD").length) : 0;
      if (value >= low && value <= high && (!prior || x(value) - x(prior) >= Math.max(32, spacing))) ticks.push(value);
    }
  }
  return ticks.length > 1 ? ticks : fallback;
}

export function ModelCostChart({ rows, selectedId, onSelect, formatCost, labelsVisible, frontierVisible, quadrantVisible, hoveredCreator, surfaceRef }: {
  rows: ComparisonPoint[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  formatCost: (value: number) => string;
  labelsVisible: boolean;
  frontierVisible: boolean;
  quadrantVisible: boolean;
  hoveredCreator?: string | null;
  surfaceRef?: Ref<HTMLDivElement>;
}) {
  const chart = useChartSize(1000, 390);
  const [hover, setHover] = useState<string | null>(null);
  const { bounds, scale, points, labels, frontier, ticks } = useMemo(() => {
    const bounds = { left: 61, right: chart.width - 16, top: 16, bottom: chart.height - 52 };
    const data = rows.map(({ family, configuration, cost }) => ({
      id: family.id, name: configuration.name, family, configuration, cost, score: configuration.index,
    }));
    const scale = ladderScale(data, bounds, 10);
    const points = data.map(point => ({ ...point, x: scale.x(point.cost), y: scale.y(point.score) }));
    const byCost = [...points].sort((a, b) => a.cost - b.cost || b.score - a.score || a.id.localeCompare(b.id));
    const frontier: typeof points = [];
    for (const point of byCost) {
      if (point.score > (frontier[frontier.length - 1]?.score ?? -Infinity)) frontier.push(point);
    }
    const efficient = new Set(frontier.map(point => point.id));
    const order = [...frontier, ...points.filter(point => !efficient.has(point.id))];
    const labels = labelsVisible ? placeScatterLabels(points, { ...bounds, top: 1 }, order.slice(0, 64)) : new Map();
    const ticks = scale.minCost > 0 ? costTicks(scale.minCost, scale.max, scale.x, scale.ticks) : scale.ticks;
    return { bounds, scale, points, labels, frontier, ticks };
  }, [rows, chart.width, chart.height, labelsVisible]);
  const active = points.find(point => point.id === hover);
  const focusId = active?.id ?? (points.some(point => point.id === selectedId) ? selectedId : points[0]?.id);
  const plotWidth = bounds.right - bounds.left;
  const plotHeight = bounds.bottom - bounds.top;
  const halfY = bounds.top + plotHeight / 2;
  const halfX = bounds.left + plotWidth / 2;

  return <div ref={surfaceRef} className="task-scatter scatter-panel" data-measured={chart.measured}>
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
      {quadrantVisible && <g aria-hidden="true">
        <rect className="task-attractive-area" x={bounds.left} y={bounds.top} width={plotWidth / 2} height={plotHeight / 2}/>
        <rect className="task-expensive-area" x={halfX} y={halfY} width={plotWidth / 2} height={plotHeight / 2}/>
      </g>}
      <text className="task-axis-caption" textAnchor="middle"
        transform={`translate(13 ${(bounds.bottom + bounds.top) / 2}) rotate(-90)`}>Artificial Analysis Intelligence Index</text>
      {scale.scoreTicks.map(value => <g key={value} aria-hidden="true">
        <path className="task-axis-mark" d={`M${bounds.left - 4},${scale.y(value)}h4`}/>
        <text className="task-axis-tick" x={bounds.left - 10} y={scale.y(value) + 4} textAnchor="end">{value}</text>
      </g>)}
      {ticks.map(value => <g key={value} aria-hidden="true">
        <path className="task-axis-mark" d={`M${scale.x(value)},${bounds.bottom}v4`}/>
        <text className="task-axis-tick" x={scale.x(value)} y={bounds.bottom + 18} textAnchor="middle">{plotPriceLabel(value, "USD")}</text>
      </g>)}
      <text x={halfX} y={chart.height - 8} textAnchor="middle" className="task-axis-caption">Cost per Task (USD, Log Scale)</text>
      {frontierVisible && frontier.length > 1 && <polyline className="task-frontier-line" aria-hidden="true"
        data-frontier-ids={JSON.stringify(frontier.map(point => point.configuration.id))}
        points={frontier.map(point => `${point.x},${point.y}`).join(" ")}/>}
      {points.map(point => {
        const label = labels.get(point.id);
        const pointColor = chartCreatorColor(point.family.creator);
        return <g className="task-plot-point" key={point.id}
          style={{ "--point-color": pointColor } as CSSProperties}
          data-emphasis={!hoveredCreator || hoveredCreator === point.family.creator}
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
          <circle className="task-point-hit" cx={point.x} cy={point.y} r={9}/>
          <circle className="task-point-mark" cx={point.x} cy={point.y} r={6}/>
          {label && <>
            {Math.abs(point.y - label.y) > 18 && <path className="task-label-leader" d={`M${point.x},${point.y}L${label.anchorX},${label.y}`}/>}
            <rect className="task-point-hit" x={label.left} y={label.y - 8} width={label.width} height={16}/>
            <text className="task-point-label" x={label.left + 2} y={label.y + 4} aria-hidden="true">{label.label}</text>
          </>}
        </g>;
      })}
    </svg>
    {active && <div role="tooltip" className="scatter-tooltip task-cost-tooltip" style={{
      left: Math.max(6, Math.min(chart.width - 281, active.x + 12)),
      "--tooltip-y": `${active.y}px`,
      "--tooltip-offset": active.y < 74 ? "14px" : "calc(-100% - 8px)",
    } as CSSProperties}>
      <b>{active.configuration.name}</b>
      <span>{active.family.creator}</span>
      <div><strong>{active.score.toFixed(1)} 分</strong><span>{formatCost(active.cost)} / 任务</span></div>
    </div>}
  </div>;
}
