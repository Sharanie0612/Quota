/* 从 Simple Icons 导出的品牌 SVG 路径生成 src/components/logos.tsx（一次性生成脚本）。 */
const fs = require("fs");
const path = require("path");

const tmp = process.env.TEMP || "C:/Users/wujun/AppData/Local/Temp";
const read = (name) => {
  const p = path.join(tmp, name);
  return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, "utf8")) : { fill: "#000", paths: [] };
};

const deepseek = read("si_deepseek.paths.json");
const kimi = read("si_kimi.paths.json");
const xiaomi = read("si_xiaomi.paths.json");

const quote = (d) => '"' + d + '"';

const out = `/** 供应商 logo 徽标。
 *
 *  DeepSeek / KIMI / 小米 用的是 Simple Icons 的官方品牌图形（CC0 许可，可自由内嵌）；
 *  智谱 GLM 与 GPT 订阅没有收录的品牌图形，用字母徽标表示，不冒充官方 logo。
 *  统一画成「品牌色圆角方块 + 白色图形」，和原来的两字母缩写占位同一视觉节奏。
 */
import type { CSSProperties } from "react";

type Mark = {
  /** 徽标底色渐变 */
  bg: string;
  /** 图形路径（24x24 视窗，画成白色） */
  d: string[];
  /** 右下角的小角标文字，用于区分同一品牌的订阅版 */
  badge?: string;
  /** 没有品牌图形时用字母徽标 */
  letter?: string;
};

const MARKS: Record<string, Mark> = {
  deepseek: {
    bg: "linear-gradient(150deg, #4d6bfe, #2a3fd8)",
    d: [${deepseek.paths.map(quote).join(", ")}],
  },
  moonshot: {
    bg: "linear-gradient(150deg, #374151, #111827)",
    d: [${kimi.paths.map(quote).join(", ")}],
  },
  zhipu: {
    bg: "linear-gradient(150deg, #6d5ce7, #4433b8)",
    d: [],
    letter: "GLM",
  },
  mimo: {
    bg: "linear-gradient(150deg, #ff8a3d, #ff6900)",
    d: [${xiaomi.paths.map(quote).join(", ")}],
  },
  "mimo-plan": {
    bg: "linear-gradient(150deg, #ff8a3d, #ff6900)",
    d: [${xiaomi.paths.map(quote).join(", ")}],
    badge: "订",
  },
  custom: {
    bg: "linear-gradient(150deg, #2fbf9a, #0b7a5f)",
    d: [],
    letter: "GPT",
  },
};

/** 供应商 logo 徽标。 */
export function ProviderLogo({
  provider,
  size = 22,
  radius,
  style,
}: {
  provider: string;
  size?: number;
  radius?: number;
  style?: CSSProperties;
}) {
  const mark = MARKS[provider];
  const box: CSSProperties = {
    width: size,
    height: size,
    flex: \`0 0 \${size}px\`,
    borderRadius: radius ?? Math.round(size * 0.3),
    display: "grid",
    placeItems: "center",
    overflow: "hidden",
    position: "relative",
    ...style,
  };
  if (!mark) {
    // 未知供应商：中性底 + 首字母
    return (
      <span
        style={{
          ...box,
          background: "linear-gradient(150deg, #8e8e93, #636366)",
          color: "#fff",
          fontSize: Math.round(size * 0.42),
          fontWeight: 700,
        }}
      >
        {(provider[0] ?? "?").toUpperCase()}
      </span>
    );
  }
  return (
    <span style={{ ...box, background: mark.bg }}>
      {mark.d.length > 0 ? (
        <svg
          width={Math.round(size * 0.68)}
          height={Math.round(size * 0.68)}
          viewBox="0 0 24 24"
          fill="#fff"
          aria-hidden="true"
        >
          {mark.d.map((d, i) => (
            <path key={i} d={d} />
          ))}
        </svg>
      ) : (
        <span
          style={{
            color: "#fff",
            fontSize: Math.round(size * ((mark.letter ?? "").length > 2 ? 0.3 : 0.42)),
            fontWeight: 700,
            letterSpacing: "-0.02em",
          }}
        >
          {mark.letter}
        </span>
      )}
      {mark.badge ? (
        <span
          style={{
            position: "absolute",
            right: -1,
            bottom: -1,
            minWidth: Math.round(size * 0.44),
            height: Math.round(size * 0.44),
            borderRadius: Math.round(size * 0.22),
            background: "#fff",
            color: "#c2410c",
            fontSize: Math.round(size * 0.3),
            fontWeight: 700,
            display: "grid",
            placeItems: "center",
            lineHeight: 1,
            boxShadow: "0 0 0 1.5px rgba(0,0,0,0.06)",
          }}
        >
          {mark.badge}
        </span>
      ) : null}
    </span>
  );
}
`;

const dest = path.join(__dirname, "..", "src", "components", "logos.tsx");
fs.writeFileSync(dest, out, "utf8");
console.log("已生成", dest);
console.log("deepseek 路径数:", deepseek.paths.length, "| kimi:", kimi.paths.length, "| xiaomi:", xiaomi.paths.length);
