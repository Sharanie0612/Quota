import { useCallback, useEffect, useState } from "react";
import { api, errText } from "../lib/api";
import { dateText, priceText, timeAgo } from "../lib/format";
import { toast } from "../lib/store";
import type { CatalogEntry, ModelCard, PriceComparison, PriceSource } from "../lib/types";
import { IconCheck, IconDownload, IconExternal, IconRefresh } from "./icons";
import { Badge, Button, IconButton, Modal, Notice } from "./ui";

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "可信度高",
  medium: "可信度中",
  low: "可信度低",
  none: "暂无价格",
};

const KIND_LABEL: Record<string, string> = {
  catalog: "本地资料库",
  official_page: "官方定价页",
  reference: "第三方参考价",
};

/**
 * 价格比对：把本地资料库、官方定价页抓取、第三方参考价放在一起，
 * 由用户判断题错，判完可以一键采用（写入本地资料库并把该条标记为已核实）。
 */
export function PriceCompareModal({
  card,
  provider,
  onClose,
  onAdopted,
}: {
  card: ModelCard;
  provider: string;
  onClose: () => void;
  onAdopted: () => void;
}) {
  const [cmp, setCmp] = useState<PriceComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [withReference, setWithReference] = useState(false);

  const run = useCallback(
    async (includePage: boolean, includeReference: boolean) => {
      setBusy(true);
      try {
        setCmp(await api.comparePrices(card.id, provider, includePage, includeReference));
      } catch (e) {
        toast(`比价失败：${errText(e)}`, "error");
      } finally {
        setBusy(false);
      }
    },
    [card.id, provider],
  );

  // 打开时先只看本地资料（不发网络请求），需要时再点按钮抓官方页
  useEffect(() => {
    void run(false, false);
  }, [run]);

  const adopt = async (src: PriceSource) => {
    const entry: CatalogEntry = {
      match: [card.id],
      name: card.name || card.id,
      vendor: card.vendor,
      providers: [],
      summary: card.summary,
      context: card.context,
      maxOutput: card.maxOutput,
      price: {
        currency: src.currency || "CNY",
        unit: src.unit || "每 1M tokens",
        input: src.input,
        output: src.output,
        note: src.note,
      },
      abilities: card.abilities,
      verified: true,
      verifiedAt: null,
      source: src.url || card.source,
      edited: true,
    };
    try {
      await api.saveCatalogEntry(entry);
      toast(`已采用「${src.name}」的价格，并标记为已核实`);
      onAdopted();
      onClose();
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const open = async (url: string) => {
    if (!url) {
      toast("这个来源没有可打开的链接", "error");
      return;
    }
    try {
      await api.openExternal(url);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  return (
    <Modal
      title={`价格比对 · ${card.name || card.id}`}
      onClose={onClose}
      wide
      footer={
        <>
          <span className="hint" style={{ marginRight: "auto", alignSelf: "center" }}>
            共 {cmp ? cmp.sources.length : 0} 个来源，采用后写入本机资料库
          </span>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 12 }}>
        同一条价格可能有多个来源。软件不会替你猜价格：抓到的数值一律标注来源与时间，
        由你对照原文判断，采用后再写进本地资料库（并记为已核实）。
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run(true, withReference)}
          disabled={busy}
        >
          <IconRefresh size={13} className={busy ? "spin" : ""} />
          {busy ? "检索中…" : "检索官方定价页"}
        </Button>
        <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={withReference}
            onChange={(e) => setWithReference(e.target.checked)}
            style={{ width: 14, height: 14 }}
          />
          同时取第三方参考价（OpenRouter，需联网）
        </label>
      </div>

      {cmp ? (
        <>
          <Notice tone={cmp.confidence === "low" || cmp.confidence === "none" ? "warn" : "info"}>
            <b>{CONFIDENCE_LABEL[cmp.confidence] ?? cmp.confidence}</b>
            <div style={{ marginTop: 2 }}>{cmp.confidenceReason}</div>
          </Notice>

          {cmp.warnings.length > 0 ? (
            <div className="hint" style={{ marginBottom: 10 }}>
              {cmp.warnings.map((w, i) => (
                <div key={i}>· {w}</div>
              ))}
            </div>
          ) : null}

          <div className="cmp-list">
            {cmp.sources.length === 0 ? (
              <div className="hint" style={{ padding: "10px 0" }}>
                还没有任何来源给出价格。点上面的「检索官方定价页」抓一次，或直接点卡片上的「编辑」手动填写。
              </div>
            ) : null}

            {cmp.sources.map((s, i) => (
              <div className="cmp-item" key={`${s.kind}-${i}`}>
                <div className="cmp-head">
                  <b>{s.name}</b>
                  <Badge tone={s.trusted ? "green" : "gray"}>
                    {s.trusted ? "已核实来源" : KIND_LABEL[s.kind] ?? s.kind}
                  </Badge>
                  <div className="spacer" />
                  {s.fetchedAt ? (
                    <span className="meta" title={s.fetchedAt}>
                      {dateText(s.fetchedAt) ?? timeAgo(s.fetchedAt)}
                    </span>
                  ) : null}
                  {s.url ? (
                    <IconButton title="打开来源页面" className="btn-sm" onClick={() => void open(s.url)}>
                      <IconExternal size={13} />
                    </IconButton>
                  ) : null}
                </div>
                <div className="cmp-price">
                  <span>
                    输入 <b>{priceText(s.input, s.currency)}</b>
                  </span>
                  <span>
                    输出 <b>{priceText(s.output, s.currency)}</b>
                  </span>
                  <span className="meta">{s.unit}</span>
                </div>
                {s.note ? <div className="cmp-note">{s.note}</div> : null}
                {s.input !== null || s.output !== null ? (
                  <div style={{ marginTop: 6 }}>
                    <Button size="sm" variant="quiet" onClick={() => void adopt(s)}>
                      <IconDownload size={13} />
                      采用这个价格
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {cmp.excerpts.length > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>
                官方定价页抓到的原文片段（{cmp.excerpts.length} 行，供人工核对）
              </summary>
              <div className="mono" style={{ marginTop: 8, maxHeight: 220, overflowY: "auto" }}>
                {cmp.excerpts.map((line, i) => (
                  <div key={i} style={{ padding: "2px 0" }}>
                    {line}
                  </div>
                ))}
              </div>
            </details>
          ) : null}

          {cmp.suggested ? (
            <div className="hint" style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8 }}>
              <IconCheck size={13} />
              建议采用：输入 {priceText(cmp.suggested.input, cmp.suggested.currency)} / 输出{" "}
              {priceText(cmp.suggested.output, cmp.suggested.currency)}
              <Button
                size="sm"
                variant="quiet"
                onClick={() =>
                  void adopt({
                    name: "建议值",
                    kind: "catalog",
                    url: cmp.suggested!.note ?? card.source ?? "",
                    currency: cmp.suggested!.currency,
                    unit: cmp.suggested!.unit,
                    input: cmp.suggested!.input,
                    output: cmp.suggested!.output,
                    note: cmp.suggested!.note,
                    fetchedAt: null,
                    trusted: false,
                  })
                }
              >
                一键采用
              </Button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="hint">正在读取本地资料…</div>
      )}
    </Modal>
  );
}
