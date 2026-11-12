import { useMemo, useState } from "react";
import { ladderScale } from "../lib/ladderPlot";
import { scatterClusters } from "../lib/scatterLayout";
import { useChartSize } from "../lib/useChartSize";
import { ModelLogo } from "./ModelLogo";
import "./ladder-chart.css";

export interface PlotModel {
  id: string;
  name: string;
  detail: string;
  cost: number;
  score: number;
  dimmed?: boolean;
}

type Props = {
  points: PlotModel[];
  xLabel: string;
  yLabel: string;
  label: string;
  costLabel: (value: number) => string;
  selectedId: string | null;
  onSelect: (id: string) => void;
  showFrontier?: boolean;
};

export function LadderCanvas({ points, xLabel, yLabel, label, costLabel, selectedId, onSelect, showFrontier }: Props) {
  const chart = useChartSize(1000, 440);
  const [hover, setHover] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const { bounds, scale, clusters, frontier } = useMemo(() => {
    const bounds = { left: 54, right: chart.width - 30, top: 38, bottom: chart.height - 64 };
    const scale = ladderScale(points, bounds);
    const projected = points.map(point => ({ ...point, x: scale.x(point.cost), y: scale.y(point.score) }));
    const frontier: typeof projected = [];
    if (showFrontier) {
      const ordered = [...projected].sort((a, b) => a.cost - b.cost || b.score - a.score || a.id.localeCompare(b.id));
      for (const point of ordered) {
        if (point.score > (frontier[frontier.length - 1]?.score ?? -Infinity)) frontier.push(point);
      }
    }
    return { bounds, scale, clusters: scatterClusters(projected), frontier };
  }, [points, chart.width, chart.height, showFrontier]);

  const active = clusters.find(cluster => cluster.anchor.id === hover);
  const expanded = clusters.find(cluster => cluster.anchor.id === opened);

  function choose(cluster: typeof clusters[number]) {
    if (cluster.members.length === 1) onSelect(cluster.anchor.id);
    else setOpened(current => current === cluster.anchor.id ? null : cluster.anchor.id);
  }

  return <div className="scatter-panel" onKeyDown={event => {
    if (event.key === "Escape") {
      setOpened(null);
      setHover(null);
    }
  }}>
    <svg ref={chart.ref} viewBox={`0 0 ${chart.width} ${chart.height}`} data-plot-width={chart.width} data-plot-height={chart.height}
      role="group" aria-label={label}>
      <text x={bounds.left} y={18} className="scatter-axis-title">{yLabel} ↑</text>
      {scale.scoreTicks.map(value => <g key={value}>
        <line x1={bounds.left} x2={bounds.right} y1={scale.y(value)} y2={scale.y(value)} className="scatter-grid" />
        <text x={bounds.left - 12} y={scale.y(value) + 4} textAnchor="end" className="scatter-tick">{value}</text>
      </g>)}
      {scale.ticks.map(value => <g key={value}>
        <line x1={scale.x(value)} x2={scale.x(value)} y1={bounds.top} y2={bounds.bottom} className="scatter-grid" />
        <text x={scale.x(value)} y={bounds.bottom + 26} textAnchor="middle" className="scatter-tick">
          {value > 0 && value < 0.001 ? value.toExponential(0) : Number(value.toPrecision(3))}
        </text>
      </g>)}
      <text x={(bounds.left + bounds.right) / 2} y={chart.height - 8} textAnchor="middle" className="scatter-axis-title">{xLabel} →</text>
      {frontier.length > 1 && <>
        <text x={bounds.right} y={18} textAnchor="end" className="scatter-axis-title">帕累托前沿</text>
        <polyline className="scatter-frontier" data-frontier-ids={JSON.stringify(frontier.map(point => point.id))}
          points={frontier.map(point => `${point.x},${point.y}`).join(" ")} />
      </>}
      {clusters.map(cluster => {
        const { anchor, members } = cluster;
        const selected = members.some(point => point.id === selectedId);
        const multiple = members.length > 1;
        return <g key={anchor.id} className="scatter-point" role="button" tabIndex={0} aria-pressed={selected || opened === anchor.id}
          data-cost={anchor.cost} data-score={anchor.score} data-plot-x={anchor.x} data-plot-y={anchor.y}
          data-profile-ids={members.map(point => point.id).join("|")}
          data-members={JSON.stringify(members.map(({ id, cost, score, x, y }) => ({ id, cost, score, x, y })))}
          aria-label={multiple ? `附近 ${members.length} 款模型，点击选择` : `${anchor.name}，${anchor.score.toFixed(1)} 分，${costLabel(anchor.cost)}`}
          style={{ opacity: members.every(point => point.dimmed) ? 0.18 : 1 }}
          onMouseEnter={() => setHover(anchor.id)} onMouseLeave={() => setHover(null)}
          onFocus={() => setHover(anchor.id)} onBlur={() => setHover(null)}
          onClick={() => choose(cluster)} onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              choose(cluster);
            }
          }}>
          <circle cx={anchor.x} cy={anchor.y} r={multiple ? 12 : 8} className={`scatter-marker${multiple ? " is-cluster" : ""}`} />
          {(selected || hover === anchor.id || opened === anchor.id) &&
            <circle cx={anchor.x} cy={anchor.y} r={multiple ? 16 : 12} className="scatter-selection-ring" />}
          {multiple ? <text x={anchor.x} y={anchor.y + 4} textAnchor="middle" className="scatter-badge">{members.length}</text>
            : <foreignObject x={anchor.x - 7} y={anchor.y - 7} width={14} height={14} className="scatter-logo">
              <ModelLogo name={anchor.name} size={14} />
            </foreignObject>}
        </g>;
      })}
    </svg>
    {active && <div role="tooltip" className="scatter-tooltip" style={{
      left: Math.max(8, Math.min(chart.width - 285, active.anchor.x - 120)),
      top: active.anchor.y < 130 ? active.anchor.y + 25 : active.anchor.y - 100,
    }}>
      {active.members.length > 1 ? <>
        <b>{active.members.length} 款相近模型</b>
        <span>{active.members.slice(0, 3).map(point => point.name).join("、")}{active.members.length > 3 ? "…" : ""}</span>
      </> : <>
        <b><ModelLogo name={active.anchor.name} size={21} />{active.anchor.name}</b>
        <div><strong>{active.anchor.score.toFixed(1)} 分</strong><span>{costLabel(active.anchor.cost)}</span></div>
      </>}
    </div>}
    {expanded && <section className="scatter-picker" aria-label="相近模型">
      <header><b>相近模型 · {expanded.members.length}</b>
        <button className="btn btn-quiet btn-sm" onClick={() => setOpened(null)} aria-label="收起相近模型">收起</button>
      </header>
      <div>{expanded.members.map(point => <button key={point.id} onClick={() => onSelect(point.id)}>
        <ModelLogo name={point.name} size={22} />
        <span>{point.name}<small>{point.detail}</small></span>
        <b>{point.score.toFixed(1)} 分</b><strong>{costLabel(point.cost)}</strong>
      </button>)}</div>
    </section>}
  </div>;
}
