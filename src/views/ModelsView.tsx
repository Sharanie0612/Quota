import { useCallback, useEffect, useMemo, useState } from "react";
import { ModelEditModal } from "../components/ModelEditModal";
import { ModelRow } from "../components/ModelRow";
import { PriceCompareModal } from "../components/PriceCompareModal";
import { IconLayers, IconRefresh, IconSearch } from "../components/icons";
import { Button, EmptyState, Seg } from "../components/ui";
import { api, copyText, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { AccountView, ModelCard as ModelCardType, ProviderView } from "../lib/types";

type Mode = "list" | "compare";

/** 输入 + 输出的合计价格；没有价格的返回 Infinity（价格对比时排到最后） */
function costOf(c: ModelCardType): number {
  const p = c.price;
  if (!p || (p.input === null && p.output === null)) return Number.POSITIVE_INFINITY;
  return (p.input ?? 0) + (p.output ?? 0);
}

/**
 * 模型库：只做四件事——
 *   1. 刷新最新的模型列表（拉各账户的 /models）
 *   2. 一键复制调用 API 的 cURL 示例
 *   3. 看每个模型的价格
 *   4. 价格对比（按 输入+输出 合计从便宜到贵排）
 */
export function ModelsView({
  accounts,
  providers,
  providerFilter,
  setProviderFilter,
  onCount,
  onAddAccount,
  onRefreshAll,
}: {
  accounts: AccountView[];
  providers: ProviderView[];
  providerFilter: string;
  setProviderFilter: (v: string) => void;
  onCount: (n: number) => void;
  onAddAccount: () => void;
  onRefreshAll: () => Promise<unknown>;
}) {
  const [cards, setCards] = useState<ModelCardType[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("list");
  const [showHidden, setShowHidden] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const [editCard, setEditCard] = useState<ModelCardType | null>(null);
  const [compareCard, setCompareCard] = useState<ModelCardType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.modelCards(providerFilter === "all" ? undefined : providerFilter);
      setCards(list);
      onCount(list.filter((c) => !c.hidden).length);
    } catch (e) {
      toast(`读取模型列表失败：${errText(e)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [providerFilter, onCount]);

  useEffect(() => {
    void load();
  }, [load, accounts]);

  /** 1. 刷新最新的模型列表 */
  const refreshList = async () => {
    setBusy(true);
    try {
      await onRefreshAll();
      await load();
      toast("已刷新，模型列表与价格都更新到最新");
    } catch (e) {
      toast(`刷新失败：${errText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  /** 2. 一键复制调用示例 */
  const copyCall = async (card: ModelCardType) => {
    const accountId = card.accountIds[0];
    if (!accountId) {
      toast("该模型没有关联的账户，无法生成调用示例", "error");
      return;
    }
    setCopyingId(card.id);
    try {
      const snippet = await api.apiSnippet(accountId, card.id);
      await copyText(snippet);
      toast("已复制 cURL 调用示例（含 API Key，注意别外传）");
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setCopyingId(null);
    }
  };

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  const providerOf = (card: ModelCardType) =>
    accounts.find((a) => a.id === card.accountIds[0])?.provider ?? "";

  const hiddenCount = useMemo(() => cards.filter((c) => c.hidden).length, [cards]);
  const visibleCount = cards.length - hiddenCount;

  /** 手动隐藏 / 恢复某个模型（记在本机，刷新、重启后仍生效） */
  const toggleHide = async (card: ModelCardType) => {
    try {
      await api.setModelHidden(card.id, !card.hidden);
      toast(
        card.hidden
          ? `已恢复显示「${card.name}」`
          : `已隐藏「${card.name}」，点「显示已隐藏」可以找回`,
      );
      await load();
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // 手动隐藏的模型默认不出现；点「显示已隐藏」后只在模型列表里查看（价格对比永远只算在售的）
    let list = cards.filter((c) => !c.hidden || (showHidden && mode === "list"));
    if (q) {
      list = list.filter((c) =>
        [c.id, c.name, c.vendor, ...c.abilities].join(" ").toLowerCase().includes(q),
      );
    }
    if (mode === "compare") {
      // 没有价格的模型排到最后，不要被当成「最便宜」
      list = [...list].sort((a, b) => costOf(a) - costOf(b));
    }
    return list;
  }, [cards, search, mode, showHidden]);

  const maxCost = useMemo(() => {
    const costs = filtered.map(costOf).filter((c) => Number.isFinite(c));
    return costs.length > 0 ? Math.max(...costs) : 0;
  }, [filtered]);

  const filterVendor = providers.find((p) => p.id === providerFilter)?.vendor;

  return (
    <div className="content-inner">
      <div className="mrow-toolbar">
        <Button size="sm" variant="primary" onClick={() => void refreshList()} disabled={busy}>
          <IconRefresh size={13} className={busy ? "spin" : ""} />
          {busy ? "刷新中…" : "刷新模型列表"}
        </Button>
        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder="搜模型名或型号"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="spacer" />
        {hiddenCount > 0 ? (
          <button
            type="button"
            className={showHidden ? "chip chip-active" : "chip"}
            title={showHidden ? "点一下收起被隐藏的模型" : "点一下查看你手动隐藏的模型"}
            onClick={() => setShowHidden((v) => !v)}
          >
            {showHidden ? "收起已隐藏 ✕" : `显示已隐藏（${hiddenCount}）`}
          </button>
        ) : null}
        {filterVendor ? (
          <button
            type="button"
            className="chip chip-active"
            title="点一下回到全部"
            onClick={() => setProviderFilter("all")}
          >
            只看 {filterVendor} ✕
          </button>
        ) : null}
        <Seg
          value={mode}
          options={[
            { value: "list", label: "模型列表" },
            { value: "compare", label: "价格对比" },
          ]}
          onChange={setMode}
        />
      </div>

      {mode === "compare" && !loading && filtered.length > 0 ? (
        <div className="hint" style={{ margin: "0 2px 8px" }}>
          按「输入 + 输出」合计价格从便宜到贵排列（各平台计价单位都是每 1M tokens），
          条形长度表示相对价格高低。
        </div>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={26} />}
          title="先添加一个账户"
          desc="模型列表是按你的账户从各平台拉回来的。添加账户后点「刷新模型列表」，这里就会出现可用模型和价格。"
          action={
            <Button variant="primary" onClick={onAddAccount}>
              添加模型账户
            </Button>
          }
        />
      ) : loading ? (
        <div className="mrow-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mrow">
              <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 16, width: 220 }} />
              <div className="skeleton" style={{ height: 16, width: 140 }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={26} />}
          title={
            visibleCount === 0 ? (hiddenCount > 0 ? "模型都被隐藏了" : "还没有模型") : "没有匹配的模型"
          }
          desc={
            visibleCount === 0
              ? hiddenCount > 0
                ? "点工具栏的「显示已隐藏」可以查看并恢复。"
                : "点上面的「刷新模型列表」拉取一次；如果还是空的，检查账户里的 API Key 是否已填写。"
              : "换个关键词试试。"
          }
        />
      ) : (
        <div className="mrow-list">
          {filtered.map((c) => (
            <ModelRow
              key={c.id}
              card={c}
              provider={providerOf(c)}
              accountLabel={accountLabel(c.accountIds[0] ?? "")}
              busy={copyingId === c.id}
              showBar={mode === "compare"}
              maxCost={maxCost}
              onCopy={() => void copyCall(c)}
              onCompare={() => setCompareCard(c)}
              onEdit={() => setEditCard(c)}
              onToggleHide={() => void toggleHide(c)}
            />
          ))}
        </div>
      )}

      {editCard ? (
        <ModelEditModal
          card={editCard}
          onClose={() => setEditCard(null)}
          onSaved={() => {
            setEditCard(null);
            void load();
          }}
        />
      ) : null}

      {compareCard ? (
        <PriceCompareModal
          card={compareCard}
          provider={providerOf(compareCard)}
          onClose={() => setCompareCard(null)}
          onAdopted={() => void load()}
        />
      ) : null}
    </div>
  );
}
