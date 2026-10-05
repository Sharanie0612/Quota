import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModelRow } from "../components/ModelRow";
import { IconLayers, IconRefresh, IconSearch } from "../components/icons";
import { Button, EmptyState, Notice, Seg } from "../components/ui";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import { groupModelComparisons } from "../lib/modelComparison";
import type { AccountView, ModelCard as ModelCardType, ProviderView } from "../lib/types";

type Mode = "list" | "compare";

/** 已核实价格的保质期：超过这么多天就在顶部提醒重新比价 */
const STALE_DAYS = 90;

/** 有价格但资料需要复核：从未核实过，或已核实但超过保质期 */
function needsRecheck(c: ModelCardType): boolean {
  const hasPrice =
    !!c.price && [c.price.input,c.price.output,c.price.cachedInput,c.price.cacheWrite,c.price.cacheWriteLong].some(value => value != null);
  if (!hasPrice || c.hidden) return false;
  if (!c.verified) return c.priceConfidence === "medium";
  if (!c.verifiedAt) return true;
  const age = Date.now() - Date.parse(c.verifiedAt);
  return Number.isFinite(age) && age > STALE_DAYS * 86400_000;
}

/**
 * 模型库：只做四件事——
 *   1. 刷新最新的模型列表（拉各账户的 /models）
 *   2. 隐藏或恢复可用模型
 *   3. 看每个模型的价格
 *   4. 价格对比（币种和单位各自分组，组内按输入+输出合计排序）
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
  const [result, setResult] = useState<{ provider: string; cards: ModelCardType[] } | null>(null);
  const [failure, setFailure] = useState<{ provider: string; message: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const live = useRef(false);
  const scope = useRef(providerFilter);
  scope.current = providerFilter;
  const hasResult = result?.provider === providerFilter;
  const cards = hasResult ? result.cards : [];
  const readError = failure?.provider === providerFilter ? failure.message : null;
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState<Mode>("list");
  const [showHidden, setShowHidden] = useState(false);
  const [staleOnly, setStaleOnly] = useState(false);

  const load = useCallback(async () => {
    if (!live.current || scope.current !== providerFilter) return false;
    const current = ++request.current;
    setLoading(true);
    setFailure(null);
    try {
      const list = await api.modelCards(providerFilter === "all" ? undefined : providerFilter);
      if (!live.current || current !== request.current || scope.current !== providerFilter) return false;
      setResult({ provider: providerFilter, cards: list });
      onCount(list.filter((c) => !c.hidden).length);
      return true;
    } catch (e) {
      if (live.current && current === request.current && scope.current === providerFilter) {
        setFailure({ provider: providerFilter, message: errText(e) });
      }
      return false;
    } finally {
      if (live.current && current === request.current && scope.current === providerFilter) setLoading(false);
    }
  }, [providerFilter, onCount]);
  const latestLoad = useRef(load);
  latestLoad.current = load;

  useEffect(() => {
    live.current = true;
    void load();
    return () => { live.current = false; ++request.current; };
  }, [load, accounts]);

  /** 1. 刷新最新的模型列表 */
  const refreshList = async () => {
    setBusy(true);
    try {
      const refreshed = await onRefreshAll();
      if (!live.current || refreshed === false) return;
      if (await latestLoad.current()) toast("模型列表已更新");
    } catch (e) {
      toast(`刷新失败：${errText(e)}`, "error");
    } finally {
      setBusy(false);
    }
  };

  const accountLabel = (id: string) => accounts.find((a) => a.id === id)?.label ?? id;
  const providerOf = (card: ModelCardType) =>
    accounts.find((a) => a.id === card.accountIds[0])?.provider ?? "";

  const hiddenCount = useMemo(() => cards.filter((c) => c.hidden).length, [cards]);
  const visibleCount = cards.length - hiddenCount;

  /** 价格资料待复核的模型（横幅与「只看待复核」过滤共用） */
  const staleCards = useMemo(
    () => cards.filter((c) => !c.hidden && needsRecheck(c)),
    [cards],
  );

  /** 手动隐藏 / 恢复某个模型（记在本机，刷新、重启后仍生效） */
  const toggleHide = async (card: ModelCardType) => {
    try {
      await api.setModelHidden(card.id, !card.hidden);
      toast(
        card.hidden
          ? `已恢复显示「${card.name}」`
          : `已隐藏「${card.name}」，点「显示已隐藏」可以找回`,
      );
      await latestLoad.current();
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
    if (staleOnly && mode === "list") {
      list = list.filter((c) => needsRecheck(c));
    }
    return list;
  }, [cards, search, mode, showHidden, staleOnly]);

  const comparisonGroups = useMemo(() => mode === "compare" ? groupModelComparisons(filtered) : [], [filtered, mode]);

  const renderRows = (list: ModelCardType[], maxCost?: number) => list.map(c => <ModelRow
    key={c.id} card={c} provider={providerOf(c)} accountLabel={accountLabel(c.accountIds[0] ?? "")}
    showBar={mode === "compare"} maxCost={maxCost}
    onToggleHide={() => void toggleHide(c)}
  />);

  const filterVendor = providers.find((p) => p.id === providerFilter)?.vendor;

  return (
    <div className="content-inner">
      <div className="mrow-toolbar">
        <Button size="sm" variant="primary" onClick={() => void refreshList()} disabled={busy || loading}>
          <IconRefresh size={13} className={busy ? "spin" : ""} />
          {busy ? "刷新中…" : "刷新模型列表"}
        </Button>
        <div className="search">
          <IconSearch size={15} />
          <input
            className="input"
            placeholder="搜模型名或型号"
            aria-label="搜索模型"
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
        {staleOnly ? (
          <button
            type="button"
            className="chip chip-active"
            title="点一下回到全部模型"
            onClick={() => setStaleOnly(false)}
          >
            只看待复核（{staleCards.length}）✕
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

      {readError && <Notice tone="error" actions={<Button size="sm" onClick={() => void load()} disabled={loading}>重试读取</Button>}>
        读取模型列表失败：{readError}
        {hasResult && <div className="hint" style={{ marginTop: 2 }}>已保留当前列表，可重试读取。</div>}
      </Notice>}
      {loading && hasResult && <div className="hint" role="status" style={{ margin: "0 2px 8px" }}>正在更新模型列表…</div>}

      {mode === "compare" && !loading && filtered.length > 0 ? (
        <div className="hint" style={{ margin: "0 2px 8px" }}>
          按原厂币种和计价单位分组，组内比较各一单位的输入与输出合计。
        </div>
      ) : null}

      {mode === "list" && !loading && staleCards.length > 0 ? (
        <Notice
          tone="warn"
          actions={
            <Button
              size="sm"
              variant="quiet"
              onClick={() => {
                setStaleOnly(true);
                setSearch("");
              }}
            >
              查看这些模型
            </Button>
          }
        >
          {staleCards.length} 个模型价格待复核
        </Notice>
      ) : null}

      {accounts.length === 0 ? (
        <EmptyState
          icon={<IconLayers size={26} />}
          title="先添加一个账户"
          desc="添加账户后同步可用模型。"
          action={
            <Button variant="primary" onClick={onAddAccount}>
              添加模型账户
            </Button>
          }
        />
      ) : (!hasResult && !readError) ? (
        <div className="mrow-list">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="mrow">
              <div className="skeleton" style={{ width: 28, height: 28, borderRadius: 8 }} />
              <div className="skeleton" style={{ height: 16, width: 220 }} />
              <div className="skeleton" style={{ height: 16, width: 140 }} />
            </div>
          ))}
        </div>
      ) : (!hasResult && readError) ? null : filtered.length === 0 ? (
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
      ) : mode === "compare" ? <div className="model-comparison-groups">
        {comparisonGroups.map(group => <section key={group.key} aria-label={`${group.currency || "币种待核实"} · ${group.unit || "单位待核实"}价格比较`}>
          <div className="model-comparison-heading"><b>{group.currency || "币种待核实"}</b><span>{group.unit || "单位待核实"}</span><span>{group.cards.length} 个模型</span></div>
          <div className="mrow-list">{renderRows(group.cards, group.maxCost)}</div>
        </section>)}
      </div> : <div className="mrow-list">{renderRows(filtered)}</div>}




    </div>
  );
}
