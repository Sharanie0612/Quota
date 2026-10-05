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
  builtin: "内置资料库",
  official_page: "官方定价页",
  reference: "第三方参考价",
};

/**
 * 价格比对：把本地资料库、官方定价页抓取、第三方参考价放在一起，
 * 用户核对后显式采用；第三方参考价保留待核实状态。
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
  const [adopting, setAdopting] = useState(false);

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
    if (adopting) return;
    setAdopting(true);
    const entry: CatalogEntry = {
      match: [card.id],
      name: card.name || card.id,
      vendor: card.vendor,
      providers: [provider],
      summary: card.summary,
      context: card.context,
      maxOutput: card.maxOutput,
      price: {
        currency: src.currency || "CNY",
        unit: src.unit || "每 1M tokens",
        input: src.input,
        output: src.output,
        cachedInput: src.cachedInput,
        cacheWrite: src.cacheWrite,
        cacheWriteLong: src.cacheWriteLong,
        note: src.note,
      },
      abilities: card.abilities,
      verified: src.kind !== "reference",
      verifiedAt: null,
      source: src.url || null,
      edited: true,
    };
    try {
      await api.saveCatalogEntry(entry);
      toast(src.kind === "reference" ? "已保存参考价格，仍需对照官网核实" : `已采用「${src.name}」的价格，并标记为已核实`);
      onAdopted();
      onClose();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setAdopting(false);
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
            共 {cmp ? cmp.sources.length : 0} 份价格记录，采用后写入本机资料库
          </span>
          <Button onClick={onClose}>完成</Button>
        </>
      }
    >
      <div className="hint" style={{ marginBottom: 12 }}>
        核对官网的标准价格后再采用。
      </div>
      {cmp?.sources.some(source => source.kind === "builtin") && <Notice>
        本机已有资料覆盖。下方同时列出内置官方资料，重新核对后可采用；当前价格不会自动更改。
      </Notice>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <Button
          size="sm"
          variant="primary"
          onClick={() => void run(true, withReference)}
          disabled={busy || adopting}
        >
          <IconRefresh size={13} className={busy ? "spin" : ""} />
          {busy ? "检索中…" : "检索官方定价页"}
        </Button>
        <label className="hint" style={{ display: "flex", alignItems: "center", gap: 6, margin: 0 }}>
          <input
            type="checkbox"
            checked={withReference}
            disabled={adopting}
            onChange={(e) => setWithReference(e.target.checked)}
            style={{ width: 14, height: 14 }}
          />
          第三方参考价
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
                暂无价格，请检索官网或手动填写。
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
                  {s.cachedInput != null && <span>缓存命中 <b>{priceText(s.cachedInput, s.currency)}</b></span>}
                  {s.cacheWrite != null && <span>缓存写入 5 分钟 <b>{priceText(s.cacheWrite, s.currency)}</b></span>}
                  {s.cacheWriteLong != null && <span>缓存写入 1 小时 <b>{priceText(s.cacheWriteLong, s.currency)}</b></span>}
                  <span className="meta">{s.unit}</span>
                </div>
                {s.note ? <div className="cmp-note">{s.note}</div> : null}
                {[s.input, s.output, s.cachedInput, s.cacheWrite, s.cacheWriteLong].some(value => value != null) ? (
                  <div style={{ marginTop: 6 }}>
                    <Button size="sm" variant="quiet" disabled={busy || adopting} onClick={() => void adopt(s)}>
                      <IconDownload size={13} />
                      {adopting ? "保存中…" : "采用这个价格"}
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {cmp.excerpts.length > 0 ? (
            <details style={{ marginTop: 12 }}>
              <summary className="hint" style={{ cursor: "pointer" }}>
                查看官网原文（{cmp.excerpts.length} 行）
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
            <div className="hint" style={{ marginTop: 10, display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
              <IconCheck size={13} />
              建议采用：输入 {priceText(cmp.suggested.input, cmp.suggested.currency)} / 输出{" "}
              {priceText(cmp.suggested.output, cmp.suggested.currency)}
              {cmp.suggestedSource && <span>来自「{cmp.suggestedSource.name}」</span>}
              {cmp.suggestedSource && <Button
                size="sm"
                variant="quiet"
                disabled={busy || adopting}
                onClick={() =>
                  void adopt(cmp.suggestedSource!)
                }
              >
                {adopting ? "保存中…" : "一键采用"}
              </Button>}
            </div>
          ) : null}
        </>
      ) : (
        <div className="hint">正在读取本地资料…</div>
      )}
    </Modal>
  );
}
