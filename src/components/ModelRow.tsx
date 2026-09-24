import { ProviderLogo } from "./logos";
import { contextText, priceText } from "../lib/format";
import type { ModelCard as ModelCardType } from "../lib/types";
import { IconCopy, IconEye, IconEyeOff, IconPencil, IconScale } from "./icons";
import { Badge, IconButton } from "./ui";

/** 模型库的一行：logo + 名称 + 价格 + 动作（复制调用 / 比价 / 编辑 / 隐藏） */
export function ModelRow({
  card,
  provider,
  accountLabel,
  busy,
  showBar,
  maxCost,
  onCopy,
  onCompare,
  onEdit,
  onToggleHide,
}: {
  card: ModelCardType;
  provider: string;
  accountLabel: string;
  busy: boolean;
  showBar?: boolean;
  maxCost?: number;
  onCopy: () => void;
  onCompare: () => void;
  onEdit: () => void;
  onToggleHide: () => void;
}) {
  const ctx = contextText(card.context);
  const price = card.price;
  const input = price?.input ?? null;
  const output = price?.output ?? null;
  const hasPrice = input !== null || output !== null;
  // 合计成本（输入 + 输出，仅用于价格对比时排条形）
  const cost = (input ?? 0) + (output ?? 0);
  const barPct = showBar && maxCost && maxCost > 0 ? Math.max(4, Math.round((cost / maxCost) * 100)) : 0;

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
            <span className="k">输入</span>
            <b className="v">{priceText(input, price!.currency)}</b>
            <span className="k">输出</span>
            <b className="v">{priceText(output, price!.currency)}</b>
            <span className="unit">{price!.unit || "每 1M tokens"}</span>
          </>
        ) : (
          <span className="noprice">未收录价格，点「比价」查官方定价页</span>
        )}
      </div>

      {showBar ? (
        <div className="mrow-bar" title={hasPrice ? `输入+输出合计 ${priceText(cost, price?.currency ?? "CNY")}` : "未收录价格"}>
          {hasPrice ? <span style={{ width: `${barPct}%` }} /> : null}
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
              title="复制 API 调用示例（cURL，含 Key）"
              className="btn-sm"
              busy={busy}
              onClick={onCopy}
            >
              <IconCopy size={14} />
            </IconButton>
            <IconButton title="比价（多个来源核对）" className="btn-sm" onClick={onCompare}>
              <IconScale size={14} />
            </IconButton>
            <IconButton title="编辑资料" className="btn-sm" onClick={onEdit}>
              <IconPencil size={14} />
            </IconButton>
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
