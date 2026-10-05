import { ProviderLogo } from "./logos";
import { contextText, priceText } from "../lib/format";
import { comparisonCost } from "../lib/modelComparison";
import type { ModelCard as ModelCardType } from "../lib/types";
import { IconEye, IconEyeOff } from "./icons";
import { Badge, IconButton } from "./ui";

/** 模型库的一行：logo + 名称 + 价格 + 动作（隐藏 / 恢复） */
export function ModelRow({
  card,
  provider,
  accountLabel,
  showBar,
  maxCost,
  onToggleHide,
}: {
  card: ModelCardType;
  provider: string;
  accountLabel: string;
  showBar?: boolean;
  maxCost?: number;
  onToggleHide: () => void;
}) {
  const ctx = contextText(card.context);
  const price = card.price;
  const input = price?.input ?? null;
  const output = price?.output ?? null;
  const hasPrice = input !== null || output !== null || price?.cachedInput != null;
  const cost = comparisonCost(card);
  const comparable = Number.isFinite(cost);
  // 合计成本（输入 + 输出，仅用于价格对比时排条形）
  const barPct = comparable && cost > 0 && showBar && maxCost && maxCost > 0 ? Math.max(4, Math.round((cost / maxCost) * 100)) : 0;

  return (
    <div className="mrow">
      <ProviderLogo provider={provider} size={28} />
      <div className="mrow-name">
        <div className="mrow-title">
          {card.name}
          {card.hidden ? <Badge tone="amber">已隐藏</Badge> : null}
          {card.verified ? null : <Badge tone="amber">待核实</Badge>}
          {ctx ? <Badge>上下文 {ctx}</Badge> : null}
        </div>
        <div className="mrow-id" title={`${card.id} · ${accountLabel}`}>
          {card.id}
        </div>
      </div>

      <div className="mrow-price">
        {hasPrice ? (
          <>
            <span className="mrow-price-item"><span className="k">未命中</span><b className="v">{priceText(input, price!.currency)}</b></span>
            <span className="mrow-price-item"><span className="k">命中</span><b className="v">{priceText(price?.cachedInput ?? null, price!.currency)}</b></span>
            <span className="mrow-price-item"><span className="k">输出</span><b className="v">{priceText(output, price!.currency)}</b></span>
            <span className="unit">{price!.unit.trim() || "单位待核实"}</span>
          </>
        ) : (
          <span className="noprice">待核实</span>
        )}
      </div>

      {showBar ? (
        <div className="mrow-bar" title={comparable ? `输入+输出合计 ${priceText(cost, price!.currency)} / ${price!.unit}` : "输入、输出、币种或单位不完整，暂不能比较合计成本"}>
          {comparable ? <span style={{ width: `${barPct}%` }} /> : null}
        </div>
      ) : null}

      <div className="mrow-acts">
        {card.hidden ? (
          <IconButton title="恢复显示该模型" className="btn-sm" onClick={onToggleHide}>
            <IconEye size={14} />
          </IconButton>
        ) : (
          <>
            <IconButton
              title="在模型库中隐藏该模型（可在「显示已隐藏」里恢复）"
              className="btn-sm"
              onClick={onToggleHide}
            >
              <IconEyeOff size={14} />
            </IconButton>
          </>
        )}
      </div>
    </div>
  );
}
