import { useEffect, useMemo, useRef, useState } from "react";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { AccountView, CustomProbe, ProviderView } from "../lib/types";
import { Button, Field, Modal, Notice, Seg } from "./ui";
import { IconTrash } from "./icons";

export function AccountSheet({
  providers,
  initial,
  initialBalanceMode,
  defaultThreshold,
  onClose,
  onSaved,
  onDeleted,
}: {
  providers: ProviderView[];
  initial: AccountView | null;
  initialBalanceMode?: "manual";
  defaultThreshold: number;
  onClose: () => void;
  onSaved: (view: AccountView) => void;
  onDeleted: (id: string) => void;
}) {
  const [providerId, setProviderId] = useState(initial?.provider ?? providers[0]?.id ?? "deepseek");
  const provider = useMemo(
    () => providers.find((p) => p.id === providerId),
    [providers, providerId],
  );

  const [label, setLabel] = useState(initial?.label ?? "");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.effectiveBaseUrl ?? "");
  const [rechargeUrl, setRechargeUrl] = useState(initial?.effectiveRechargeUrl ?? "");
  const [threshold, setThreshold] = useState(
    String(initial?.lowBalanceThreshold ?? defaultThreshold ?? 20),
  );
  const [manual, setManual] = useState(
    initial?.manualBalance !== null && initial?.manualBalance !== undefined
      ? String(initial.manualBalance)
      : "",
  );
  const [rechargeTotal,setRechargeTotal] = useState(initial?.manualRechargeTotal == null ? "" : String(initial.manualRechargeTotal));
  const [rechargeCurrency,setRechargeCurrency] = useState(initial?.manualRechargeCurrency ?? initial?.status.balance?.currency ?? "CNY");
  const [spendTotal,setSpendTotal] = useState(initial?.manualSpendTotal == null ? "" : String(initial.manualSpendTotal));
  const [spendCurrency,setSpendCurrency] = useState(initial?.manualSpendCurrency ?? initial?.status.balance?.currency ?? "CNY");
  const [manualCurrency, setManualCurrency] = useState(initial?.manualBalance != null
    ? initial.manualCurrency ?? "CNY" : ["custom", "mimo-plan"].includes(initial?.provider ?? "") ? "%" : "CNY");
  const [note, setNote] = useState(initial?.note ?? "");
  const [balanceMode, setBalanceMode] = useState(initialBalanceMode ?? (initial?.provider === "custom" && initial.balanceMode === "auto" ? "codex" : initial?.balanceMode ?? "auto"));
  const [customUrl, setCustomUrl] = useState(initial?.customUrl ?? "");
  const [customHeaders, setCustomHeaders] = useState(initial?.customHeaders ?? "");
  const [customJsonPath, setCustomJsonPath] = useState(initial?.customJsonPath ?? "");
  const [customCurrency, setCustomCurrency] = useState(initial?.customCurrency ?? "CNY");
  const [customMethod, setCustomMethod] = useState(initial?.customMethod ?? "GET");
  const [customBody, setCustomBody] = useState(initial?.customBody ?? "");
  const [quotaTotal, setQuotaTotal] = useState(
    initial?.quotaTotal !== null && initial?.quotaTotal !== undefined
      ? String(initial.quotaTotal)
      : "",
  );
  const [adminKey, setAdminKey] = useState("");
  const [accessKeyId, setAccessKeyId] = useState("");
  const [accessKeySecret, setAccessKeySecret] = useState("");
  const [consoleCookie, setConsoleCookie] = useState("");
  const [probe, setProbe] = useState<CustomProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connectionId, setConnectionId] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [loginOpened, setLoginOpened] = useState(false);
  const [mimoConnections, setMimoConnections] = useState<{id: string; label: string}[]>([]);
  const [mimoSource, setMimoSource] = useState("");
  const staged = useRef<string | null>(null);
  const isMimo = providerId === "mimo" || providerId === "mimo-plan";
  const isChatgpt = providerId === "custom";
  const isSubscription = isChatgpt || providerId === "mimo-plan";
  useEffect(() => {
    let active = true;
    if (isMimo) void api.listMimoConnections().then(list => {
      if (!active) return;
      const available = list.filter(item => item.id !== initial?.id);
      setMimoConnections(available);
      setMimoSource(available[0]?.id ?? "");
    }).catch(e => { if (active) toast(errText(e), "error"); });
    return () => { active = false; };
  }, [isMimo, initial?.id]);
  const manualUnits = isSubscription ? providerId === "mimo-plan" ? ["%", "Credits"] : ["%"] : ["CNY", "USD"];
  if (initial?.manualBalance != null && initial.manualCurrency && !manualUnits.includes(initial.manualCurrency)) manualUnits.push(initial.manualCurrency);
  const changeMode = (mode: string) => {
    setBalanceMode(mode);
    if (mode === "manual" && manual.trim() === "") setManualCurrency(isSubscription ? "%" : "CNY");
  };
  useEffect(() => () => {
    if (staged.current) void api.discardConnection(staged.current).catch(() => undefined);
    void api.cancelMimoLogin().catch(() => undefined);
  }, []);
  const connect = async (finish = false) => {
    setConnecting(true);
    try {
      if (isMimo && !finish) { await api.startMimoLogin(); setLoginOpened(true); return; }
      const id = isMimo ? await api.finishMimoLogin(providerId) : await api.connectChatgpt();
      if (staged.current) await api.discardConnection(staged.current);
      staged.current = id;
      setConnectionId(id);
      setLoginOpened(false);
      toast("连接成功");
    } catch (e) { toast(errText(e), "error"); }
    finally { setConnecting(false); }
  };
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const reuseMimo = async () => {
    if (!mimoSource) return;
    setConnecting(true);
    try {
      const id = await api.reuseMimoConnection(mimoSource, providerId);
      if (staged.current) await api.discardConnection(staged.current);
      staged.current = id; setConnectionId(id); setLoginOpened(false);
      await api.cancelMimoLogin();
      toast("已使用同一小米登录，无需再次扫码");
    } catch (e) { toast(errText(e), "error"); }
    finally { setConnecting(false); }
  };

  const onProviderChange = (id: string) => {
    if (staged.current) void api.discardConnection(staged.current).catch(() => undefined);
    staged.current = null; setConnectionId(null); setConsoleCookie(""); setLoginOpened(false);
    void api.cancelMimoLogin().catch(() => undefined);
    setProviderId(id);
    if (!initial) {
      const p = providers.find((x) => x.id === id);
      setBaseUrl(p?.defaultBaseUrl ?? "");
      setRechargeUrl(p?.rechargeUrl ?? "");
      setManualCurrency(["custom", "mimo-plan"].includes(id) ? "%" : "CNY");
      // 新平台默认挑第一个可用的余额方式（没有官方接口的平台会落到自定义/手动）
      setBalanceMode(p?.balanceModes[0]?.value ?? "auto");
      setProbe(null);
    }
  };

  // 余额方式选项由后端按平台能力给出（例如百炼多了「阿里云账单」）
  const modeOptions = useMemo(() => {
    const list = provider?.balanceModes ?? [];
    if (list.length > 0) return list.filter((m) => m.value !== "custom").map((m) => ({ value: m.value, label: m.label }));
    return [
      { value: "auto", label: "官方接口" },
      { value: "custom", label: "自定义接口" },
      { value: "manual", label: "手动余额" },
    ];
  }, [provider]);

  const runProbe = async () => {
    setProbing(true);
    setProbe(null);
    try {
      const result = await api.probeCustomBalance({
        customUrl: customUrl.trim(),
        customHeaders: customHeaders.trim(),
        customJsonPath: customJsonPath.trim(),
        customCurrency,
        customMethod,
        customBody: customBody.trim(),
      });
      setProbe(result);
      if (result.ok) {
        toast("连接成功，请选择余额字段");
      } else {
        toast(result.error ?? "测试未通过", "error");
      }
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setProbing(false);
    }
  };

  const submit = async () => {
    if (!provider) return;
    if (!Number.isFinite(Number(threshold)) || Number(threshold) < 0) { toast("提醒阈值须为有限非负数", "error"); return; }
    if (rechargeTotal.trim() !== "" && (!Number.isFinite(Number(rechargeTotal)) || Number(rechargeTotal) < 0)) { toast("累计充值须为非负金额", "error"); return; }
    if (spendTotal.trim() !== "" && (!Number.isFinite(Number(spendTotal)) || Number(spendTotal) < 0)) { toast("累计消费须为非负金额", "error"); return; }
    if (manual.trim() !== "" && (!Number.isFinite(Number(manual)) || (manualCurrency === "%" && (Number(manual) < 0 || Number(manual) > 100)))) {
      toast(manualCurrency === "%" ? "剩余百分比须在 0–100 之间" : "手动余额须为有限数值", "error"); return;
    }
    if (provider.custom && !baseUrl.trim()) {
      toast("自定义供应商必须填写 Base URL", "error");
      return;
    }
    if (balanceMode === "aliyun" && !initial?.hasAccessKey && !(accessKeyId.trim() && accessKeySecret.trim())) {
      toast("选择「阿里云账单」需要同时填写 AccessKey ID 与 Secret", "error");
      return;
    }
    if (balanceMode === "console" && !initial?.hasConsoleCookie && !consoleCookie.trim() && !connectionId) {
      toast("请先连接小米账户", "error");
      return;
    }
    if (isChatgpt && balanceMode !== "manual" && !initial && !connectionId) { toast("请先连接 ChatGPT", "error"); return; }
    setSaving(true);
    try {
      const view = await api.saveAccount({
        id: initial?.id ?? null,
        connectionId,
        provider: providerId,
        label: label.trim() || provider.name,
        apiKey: apiKey.trim() ? apiKey.trim() : null,
        baseUrl: baseUrl.trim(),
        rechargeUrl: rechargeUrl.trim(),
        lowBalanceThreshold: Number(threshold) || 0,
        manualBalance: manual.trim() === "" ? null : Number(manual),
        manualCurrency,
        manualRechargeTotal: rechargeTotal.trim() === "" ? null : Number(rechargeTotal),
        manualRechargeCurrency: rechargeCurrency,
        manualSpendTotal: spendTotal.trim() === "" ? null : Number(spendTotal),
        manualSpendCurrency: spendCurrency,
        note: note.trim(),
        balanceMode,
        customUrl: customUrl.trim(),
        customHeaders: customHeaders.trim(),
        customJsonPath: customJsonPath.trim(),
        customCurrency,
        customMethod,
        customBody: customBody.trim(),
        quotaTotal: quotaTotal.trim() === "" ? null : Number(quotaTotal),
        adminKey: adminKey.trim() ? adminKey.trim() : null,
        accessKeyId: accessKeyId.trim() ? accessKeyId.trim() : null,
        accessKeySecret: accessKeySecret.trim() ? accessKeySecret.trim() : null,
        consoleCookie: consoleCookie.trim() ? consoleCookie.trim() : null,
      });
      toast(`已保存「${view.label}」`);
      staged.current = null;
      onSaved(view);
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!initial) return;
    try {
      await api.deleteAccount(initial.id);
      toast(`已删除「${initial.label}」`);
      onDeleted(initial.id);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  /** 打开外链（文档 / 控制台） */
  const openLink = async (url: string) => {
    if (!url) return;
    try {
      await api.openExternal(url);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  return (
    <Modal
      title={initial ? `编辑账户 · ${initial.label}` : "添加模型账户"}
      onClose={onClose}
      wide
      footer={
        <>
          {initial ? (
            confirmingDelete ? (
              <>
                <span className="hint" style={{ marginRight: "auto", alignSelf: "center" }}>
                  删除账户及其登录信息
                </span>
                <Button onClick={() => setConfirmingDelete(false)}>取消</Button>
                <Button variant="danger" onClick={remove}>
                  <IconTrash size={14} />
                  确认删除
                </Button>
              </>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingDelete(true)}>
                <IconTrash size={14} />
                删除账户
              </Button>
            )
          ) : null}
          <div className="spacer" />
          <Button onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={submit} disabled={saving || !provider}>
            {saving ? "保存中…" : initial ? "保存" : "保存账户"}
          </Button>
        </>
      }
    >
      <Field label="模型供应商">
        <select
          className="select"
          value={providerId}
          onChange={(e) => onProviderChange(e.target.value)}
          disabled={!!initial}
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.custom ? "" : ` · ${p.region}`}
            </option>
          ))}
        </select>
      </Field>

      {provider ? (
        <div style={{ marginTop: -4 }}>
          <Notice
            tone="info"
            actions={
              provider.docsUrl || provider.pricingUrl ? (
                <Button
                  size="sm"
                  variant="quiet"
                  onClick={() => void openLink(provider.docsUrl || provider.pricingUrl)}
                >
                  {isMimo || isChatgpt ? "打开官网" : "API Key 在哪拿？"}
                </Button>
              ) : null
            }
          >
            <b>{isMimo || isChatgpt ? "① 选平台　② 连接账户　③ 保存" : "① 选平台　② 填写 API Key　③ 保存"}</b>
          </Notice>
        </div>
      ) : null}

      <div
        className="row-2"
        style={provider && !provider.needsApiKey ? { gridTemplateColumns: "1fr" } : undefined}
      >
        <Field label="账户名称" hint="可选，默认使用平台名">
          <input
            className="input"
            value={label}
            placeholder={provider?.name ?? "账户名称"}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        {provider?.needsApiKey !== false && !isMimo ? (
          <Field
            label={initial?.hasKey ? "API Key（已保存，留空不修改）" : "API Key"}
            hint={isMimo ? "可选，用于同步模型列表" : undefined}
          >
            <input
              className="input"
              type="password"
              value={apiKey}
              placeholder={initial?.hasKey ? "••••••••（留空保持不变）" : "粘贴 API Key"}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </Field>
        ) : null}
      </div>

      <Field label="同步方式">
        <Seg value={balanceMode} options={modeOptions} onChange={changeMode} />
      </Field>

      {balanceMode === "aliyun" ? (
        <>
          <Notice tone="info">
            百炼等平台本身没有余额接口，但费用从阿里云账户扣。填一对阿里云 AccessKey
            后即可读取阿里云账户可用额度，并参与低余额提醒。
          </Notice>
          <div className="row-2">
            <Field
              label={
                initial?.hasAccessKey ? "阿里云 AccessKey ID（已保存，留空不修改）" : "阿里云 AccessKey ID"
              }
              hint={provider?.accessKeyHint ?? undefined}
            >
              <input
                className="input"
                value={accessKeyId}
                placeholder={initial?.hasAccessKey ? "••••••（留空保持不变）" : "LTAI…"}
                onChange={(e) => setAccessKeyId(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
            <Field label="阿里云 AccessKey Secret">
              <input
                className="input"
                type="password"
                value={accessKeySecret}
                placeholder={initial?.hasAccessKey ? "••••••••（留空保持不变）" : "粘贴 Secret"}
                onChange={(e) => setAccessKeySecret(e.target.value)}
                autoComplete="off"
                spellCheck={false}
              />
            </Field>
          </div>
        </>
      ) : null}

      {(isMimo && balanceMode === "console") || (isChatgpt && balanceMode !== "manual") ? (
        <div className="connection-panel">
          <h3>{isMimo ? "连接小米账户" : "连接 ChatGPT"}</h3>
          <p>{connectionId ? "已连接，保存后开始同步" : isMimo ? "在官方窗口登录后，返回这里完成连接。" : "使用本机已登录的 Codex，查看订阅内的 Codex 额度。"}</p>
          {isMimo && mimoConnections.length > 0 ? <Field label="使用已连接的小米账户" hint="余额和订阅可共用一次登录；多个小米账号请按名称选择。">
            <div className="tag-row">
              <select className="select" aria-label="已连接的小米账户" value={mimoSource} onChange={e => setMimoSource(e.target.value)} disabled={connecting}>
                {mimoConnections.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
              </select>
              <Button onClick={() => void reuseMimo()} disabled={connecting || !mimoSource}>使用此账户</Button>
            </div>
          </Field> : null}
          <div className="tag-row">
            <Button variant="primary" onClick={() => void connect()} disabled={connecting}>
              {connecting ? "连接中…" : isMimo ? mimoConnections.length ? "登录另一个小米账户" : "登录小米" : "连接本机登录"}
            </Button>
            {isMimo && loginOpened ? <Button onClick={() => void connect(true)} disabled={connecting}>完成连接</Button> : null}
            {isChatgpt ? <Button onClick={() => void openLink("https://chatgpt.com/codex")}>打开 Codex</Button> : null}
          </div>
          {isMimo ? <details className="advanced"><summary>其他连接方式</summary>
            <Field label="登录 Cookie" hint="保存在系统凭据管理器">
              <textarea className="input" rows={2} value={consoleCookie} onChange={(e) => setConsoleCookie(e.target.value)} autoComplete="off" spellCheck={false} />
            </Field>
          </details> : null}
        </div>
      ) : null}

      {balanceMode === "manual" ? (          <Field
            label={isSubscription ? "手动剩余额度" : "手动余额"}
            hint={isSubscription ? "记录当前额度；百分比使用最紧张窗口的剩余值，提醒阈值使用同一单位。" : "填写当前余额"}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                type="number"
                step="0.01"
                value={manual}
                placeholder="留空表示不使用"
                onChange={(e) => setManual(e.target.value)}
              />
              <select
                className="select"
                aria-label={isSubscription ? "手动额度单位" : "手动余额币种"}
                style={{ width: 92 }}
                value={manualCurrency}
                onChange={(e) => setManualCurrency(e.target.value)}
              >
                {manualUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
          </Field>) : null}

      <details className="advanced">
        <summary>
          <span className="advanced-title">高级设置</span>
          <span className="advanced-hint">可选</span>
        </summary>
        {isMimo ? <Field label="API Key" hint="可选，用于同步模型列表"><input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" /></Field> : null}
        {provider?.balanceModes.some((m) => m.value === "custom") ? <Field label="自定义同步"><select className="select" value={balanceMode === "custom" ? "custom" : "default"} onChange={(e) => setBalanceMode(e.target.value === "custom" ? "custom" : provider.balanceModes[0]?.value ?? "auto")}><option value="default">使用平台同步方式</option><option value="custom">自定义接口</option></select></Field> : null}
      {balanceMode === "custom" ? (
        <>
          <div className="row-2">
            <Field label="自定义余额接口地址" hint="需以 http/https 开头，返回值是 JSON 即可">
              <input
                className="input"
                value={customUrl}
                placeholder="https://example.com/api/balance"
                onChange={(e) => setCustomUrl(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label="请求方法">
              <select
                className="select"
                value={customMethod}
                onChange={(e) => setCustomMethod(e.target.value)}
              >
                <option value="GET">GET</option>
                <option value="POST">POST</option>
              </select>
            </Field>
          </div>
          <Field
            label="请求头"
            hint="保存在配置文件，请勿填写密钥或 Cookie"
          >
            <textarea
              className="input"
              rows={2}
              value={customHeaders}
              placeholder="Accept: application/json"
              onChange={(e) => setCustomHeaders(e.target.value)}
              spellCheck={false}
            />
          </Field>
          {customMethod === "POST" ? (
            <Field label="请求体" hint="保存在配置文件，请勿填写密钥或 Cookie">
              <textarea
                className="input"
                rows={2}
                value={customBody}
                placeholder='{"page":1}'
                onChange={(e) => setCustomBody(e.target.value)}
                spellCheck={false}
              />
            </Field>
          ) : null}
          <div className="row-2">
            <Field label="金额的 JSON 路径" hint="留空则自动识别；如 data.balance、data.items[0].amount">
              <input
                className="input"
                value={customJsonPath}
                placeholder="留空自动识别"
                onChange={(e) => setCustomJsonPath(e.target.value)}
                spellCheck={false}
              />
            </Field>
            <Field label="币种">
              <select
                className="select"
                value={customCurrency}
                onChange={(e) => setCustomCurrency(e.target.value)}
              >
                <option value="CNY">CNY 人民币</option>
                <option value="USD">USD 美元</option>
              </select>
            </Field>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
            <Button size="sm" onClick={() => void runProbe()} disabled={probing || !customUrl.trim()}>
              {probing ? "测试中…" : "测试接口"}
            </Button>
            {probe?.ok && probe.value !== null ? (
              <span className="hint" style={{ margin: 0 }}>
                读到的金额：<b>{probe.value}</b> {probe.currency}
              </span>
            ) : null}
            {probe?.error ? (
              <span className="hint" style={{ margin: 0, color: "var(--red)" }}>
                {probe.error}
              </span>
            ) : null}
          </div>

          {probe && probe.discovered.length > 0 ? (
            <div className="field">
              <label>返回内容里可用的金额字段（点一下即可填入）</label>
              <div className="tag-row">
                {probe.discovered.slice(0, 12).map((d) => (
                  <button
                    key={d.path}
                    type="button"
                    className={`chip${customJsonPath === d.path ? " chip-active" : ""}`}
                    onClick={() => setCustomJsonPath(d.path)}
                    title="点击填入该路径"
                  >
                    {d.path} · {d.value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {probe && probe.rawPreview ? (
            <div className="field">
              <label>接口原始返回（截断）</label>
              <div className="mono">{probe.rawPreview}</div>
            </div>
          ) : null}
        </>
      ) : null}

      {provider?.adminKeyHint ? (
        <Field
          label={initial?.hasAdminKey ? "管理员密钥（已保存，留空不修改）" : "管理员密钥（可选）"}
          hint={provider.adminKeyHint}
        >
          <input
            className="input"
            type="password"
            value={adminKey}
            placeholder={initial?.hasAdminKey ? "••••••••（留空保持不变）" : "粘贴管理员密钥"}
            onChange={(e) => setAdminKey(e.target.value)}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
      ) : null}



        <Field
          label="Base URL"
          hint={
            provider?.custom
              ? "必填：OpenAI 兼容地址，通常以 /v1 结尾，例如 https://your-station.com/v1"
              : "默认使用官方地址，用中转/代理时再修改"
          }
        >
          <input
            className="input"
            value={baseUrl}
            placeholder={provider?.defaultBaseUrl || "https://example.com/v1"}
            onChange={(e) => setBaseUrl(e.target.value)}
            spellCheck={false}
          />
        </Field>

        <Field label="充值页链接" >
          <input
            className="input"
            value={rechargeUrl}
            placeholder={provider?.rechargeUrl || "https://…"}
            onChange={(e) => setRechargeUrl(e.target.value)}
            spellCheck={false}
          />
        </Field>

        <div className="row-2">
          <Field label={isChatgpt && balanceMode !== "manual" || isSubscription && manualCurrency === "%" ? "额度提醒阈值（%）" : "低余额提醒阈值"} hint="低于阈值时提醒，0 为关闭">
            <input
              className="input"
              type="number"
              min={0}
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
{balanceMode !== "manual" ? (          <Field
            label={isSubscription ? "备用手动额度" : "手动余额"}
            hint={isSubscription ? "同步失败时使用；百分比填写最紧张窗口的剩余值。" : "作为同步失败时的备用金额"}
          >
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="input"
                type="number"
                step="0.01"
                value={manual}
                placeholder="留空表示不使用"
                onChange={(e) => setManual(e.target.value)}
              />
              <select
                className="select"
                aria-label={isSubscription ? "备用手动额度单位" : "备用手动余额币种"}
                style={{ width: 92 }}
                value={manualCurrency}
                onChange={(e) => setManualCurrency(e.target.value)}
              >
                {manualUnits.map(unit => <option key={unit} value={unit}>{unit}</option>)}
              </select>
            </div>
          </Field>) : null}
        </div>

        {provider?.adminKeyHint ? (
          <Field
            label="已充值 / 预算总额"
            hint="用于估算剩余额度"
          >
            <input
              className="input"
              type="number"
              step="0.01"
              value={quotaTotal}
              placeholder="留空表示不推算"
              onChange={(e) => setQuotaTotal(e.target.value)}
            />
          </Field>
        ) : null}

        {!isSubscription && <Field label="累计充值（手动补全）" hint="官方接口未提供时可按账单填写；不会改变余额，接口有值时优先显示接口数据。"><div className="row-2"><input className="input" aria-label="手动累计充值" type="number" min="0" step="0.01" value={rechargeTotal} placeholder="未知请留空" onChange={e=>setRechargeTotal(e.target.value)}/><select className="select" aria-label="累计充值币种" value={rechargeCurrency} onChange={e=>setRechargeCurrency(e.target.value)}><option value="CNY">人民币</option><option value="USD">美元</option></select></div></Field>}
        {!isSubscription && <Field label="累计消费（手动补全）" hint="官方接口未提供时可按账单填写；不会改变余额，接口有值时优先显示接口数据。"><div className="row-2"><input className="input" aria-label="手动累计消费" type="number" min="0" step="0.01" value={spendTotal} placeholder="未知请留空" onChange={e=>setSpendTotal(e.target.value)}/><select className="select" aria-label="累计消费币种" value={spendCurrency} onChange={e=>setSpendCurrency(e.target.value)}><option value="CNY">人民币</option><option value="USD">美元</option></select></div></Field>}
        <Field label="备注" >
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="可选"
          />
        </Field>


      </details>
    </Modal>
  );
}
