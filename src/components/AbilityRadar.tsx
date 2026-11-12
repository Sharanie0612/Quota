import type { LadderEntry } from "../lib/types";

export const abilityAxes = [{ key: "general", label: "综合" }, { key: "coding", label: "编程" }, { key: "math", label: "数学" }, { key: "science", label: "科学" }, { key: "reasoning", label: "推理" }, { key: "agents", label: "智能体" }];
export const modelColors = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"];

export function AbilityRadar({ entries, axes = abilityAxes, label = "模型能力图" }: {
  entries: LadderEntry[];
  axes?: { key: string; label: string }[];
  label?: string;
}) {
  function point(index: number, radius: number) {
    const angle = index * 2 * Math.PI / axes.length - Math.PI / 2;
    return [160 + Math.cos(angle) * radius, 150 + Math.sin(angle) * radius];
  }
  const polygon = (radius: number) => axes.map((_, index) => point(index, radius).join(",")).join(" ");
  return <svg className="ability-radar" viewBox="0 0 320 300" role="img" aria-label={label}>
    {[25, 50, 75, 100].map(radius => <g key={radius}>
      <polygon points={polygon(radius)} fill="none" stroke="var(--border-strong)" />
      <text x="164" y={150 - radius} fill="var(--text-2)" fontSize="9">{radius}</text>
    </g>)}
    {axes.map((axis, index) => {
      const [x, y] = point(index, axes.length === 4 && index % 2 ? 119 : 126);
      const [endX, endY] = point(index, 100);
      return <g key={axis.key} data-axis={axis.key}>
        <line x1="160" y1="150" x2={endX} y2={endY} stroke="var(--border)" />
        <text x={x} y={y + 4} textAnchor="middle" fill="var(--text-2)" fontSize="12">{axis.label}</text>
      </g>;
    })}
    {entries.map((entry, index) => {
      const scores = axes.map(axis => entry.rankings[axis.key]?.score);
      const complete = scores.every(score => score != null);
      return <g key={entry.id} style={{ color: modelColors[index % modelColors.length] }}>
        {complete && <polygon points={scores.map((score, i) => point(i, score).join(",")).join(" ")}
          fill="currentColor" fillOpacity={0.08} stroke="currentColor" strokeWidth="2" />}
        {scores.map((score, i) => {
          if (score == null) return null;
          const next = (i + 1) % axes.length;
          const [x, y] = point(i, score);
          const end = scores[next] == null ? null : point(next, scores[next]);
          return <g key={axes[i].key}>
            {!complete && end && <line x1={x} y1={y} x2={end[0]} y2={end[1]} stroke="currentColor" strokeWidth="2" />}
            <circle cx={x} cy={y} r="3" fill="currentColor">
              <title>{`${entry.name} · ${axes[i].label} ${score.toFixed(1)}`}</title>
            </circle>
          </g>;
        })}
      </g>;
    })}
  </svg>;
}
