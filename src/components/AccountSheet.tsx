import { useMemo, useState } from "react";
import { api, errText } from "../lib/api";
import { toast } from "../lib/store";
import type { AccountView, CustomProbe, ProviderView } from "../lib/types";
import { Button, Field, Modal, Notice, Seg } from "./ui";
import { IconTrash } from "./icons";

export function AccountSheet({
  providers,
  initial,
  defaultThreshold,
  onClose,
  onSaved,
  onDeleted,
}: {
  providers: ProviderView[];
  initial: AccountView | null;
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
  const [manualCurrency, setManualCurrency] = useState(initial?.manualCurrency ?? "CNY");
  const [note, setNote] = useState(initial?.note ?? "");
  const [balanceMode, setBalanceMode] = useState(initial?.balanceMode ?? "auto");
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
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const onProviderChange = (id: string) => {
    setProviderId(id);
    if (!initial) {
      const p = providers.find((x) => x.id === id);
      setBaseUrl(p?.defaultBaseUrl ?? "");
      setRechargeUrl(p?.rechargeUrl ?? "");
      // 新平台默认挑第一个可用的余额方式（没有官方接口的平台会落到自定义/手动）
      setBalanceMode(p?.balanceModes[0]?.value ?? "auto");
      setProbe(null);
    }
  };

  // 余额方式选项由后端按平台能力给出（例如百炼多了「阿里云账单」）
  const modeOptions = useMemo(() => {
    const list = provider?.balanceModes ?? [];
    if (list.length > 0) return list.map((m) => ({ value: m.value, label: m.label }));
    return [
      { value: "auto", label: "官方接口" },
      { value: "custom", label: "自定义接口" },
      { value: "manual", label: "手动余额" },
    ];
  }, [provider]);

  const modeDesc =
    provider?.balanceModes.find((m) => m.value === balanceMode)?.desc ??
    "选择该账户余额的获取方式。";

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
        toast("接口通了，可以从下方发现的字段里选一个作为余额");
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
    if (provider.custom && !baseUrl.trim()) {
      toast("自定义供应商必须填写 Base URL", "error");
      return;
    }
    if (balanceMode === "aliyun" && !initial?.hasAccessKey && !(accessKeyId.trim() && accessKeySecret.trim())) {
      toast("选择「阿里云账单」需要同时填写 AccessKey ID 与 Secret", "error");
      return;
    }
    if (balanceMode === "console" && !initial?.hasConsoleCookie && !consoleCookie.trim()) {
      toast("选择「控制台 Cookie」需要粘贴浏览器里的 Cookie", "error");
      return;
    }
    setSaving(true);
    try {
      const view = await api.saveAccount({
        id: initial?.id ?? null,
        provider: providerId,
        label: label.trim() || provider.name,
        apiKey: apiKey.trim() ? apiKey.trim() : null,
        baseUrl: baseUrl.trim(),
        rechargeUrl: rechargeUrl.trim(),
        lowBalanceThreshold: Number(threshold) || 0,
        manualBalance: manual.trim() === "" ? null : Number(manual),
        manualCurrency,
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
      toast(`已保存「${view.label}」，正在查询余额…`);
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
                  删除后该账户的 API Key 也会从凭据管理器移除
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
            {saving ? "保存中…" : initial ? "保存并测试" : "添加并测试"}
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
                  API Key 在哪拿？
                </Button>
              ) : null
            }
          >
            三步用起来：<b>① 选平台 ② 粘贴 API Key ③ 点下面的「添加并测试」</b>。
            余额和模型列表会自动查好，别的都不用填。
          </Notice>
        </div>
      ) : null}

      <div
        className="row-2"
        style={provider && !provider.needsApiKey ? { gridTemplateColumns: "1fr" } : undefined}
      >
        <Field label="账户名称" hint="留空就是平台名；同平台有多个账号时用它区分，如「个人号」">
          <input
            className="input"
            value={label}
            placeholder={provider?.name ?? "账户名称"}
            onChange={(e) => setLabel(e.target.value)}
          />
        </Field>
        {provider?.needsApiKey !== false ? (
          <Field
            label={initial?.hasKey ? "API Key（已保存，留空不修改）" : "API Key"}
            hint={provider?.keyHint}
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

      <div className="field">
        <label>余额获取方式</label>
        <Seg value={balanceMode} options={modeOptions} onChange={setBalanceMode} />
        <div className="hint">{modeDesc}</div>
        {provider && !provider.balanceSupported && balanceMode === "auto" && provider.balanceNote ? (
          <div className="hint" style={{ marginTop: 4 }}>
            {provider.balanceNote}
          </div>
        ) : null}
        {provider && provider.balanceAlternatives.length > 0 ? (
          <div className="hint" style={{ marginTop: 4 }}>
            其他可用方式：{provider.balanceAlternatives.join("；")}
          </div>
        ) : null}
      </div>

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

      {balanceMode === "console" ? (
        <>
          <Notice tone="info">
            MiMo 没有查询余额的公开接口，只能用浏览器里的<b>小米账号 Cookie</b> 查：
            登录 platform.xiaomimimo.com 后按 F12 → Network（网络）→ 随便点一个请求 →
            在请求头里复制整行 <b>Cookie: …</b> 粘到下面。保存后会自动查<b>余额、本月用量与套餐余量</b>；
            Cookie 过期时卡片会提示重新复制。
          </Notice>
          <Field
            label={initial?.hasConsoleCookie ? "控制台 Cookie（已保存，留空不修改）" : "控制台 Cookie"}
            hint="整串 Cookie 都粘进来；只存本机凭据管理器，不上传"
          >
            <textarea
              className="input"
              rows={3}
              value={consoleCookie}
              placeholder={
                initial?.hasConsoleCookie
                  ? "••••••（留空保持不变）"
                  : "serviceToken=…; userId=…;（或整行 Cookie: serviceToken=…）"
              }
              onChange={(e) => setConsoleCookie(e.target.value)}
              spellCheck={false}
            />
          </Field>
        </>
      ) : null}

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
            hint="每行一个。当前请求头保存在本机配置文件，请勿在此填写 API Key、Cookie 等秘密。"
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
            <Field label="请求体" hint="POST 时发送的内容，通常是 JSON；当前保存在本机配置文件，请勿填写秘密。">
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

      <details className="advanced">
        <summary>
          <span className="advanced-title">高级设置</span>
          <span className="advanced-hint">一般保持默认就好</span>
        </summary>

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

        <Field label="充值页链接" hint="点击卡片上的「充值」会打开这个链接，可改成该平台任意充值/账单页面">
          <input
            className="input"
            value={rechargeUrl}
            placeholder={provider?.rechargeUrl || "https://…"}
            onChange={(e) => setRechargeUrl(e.target.value)}
            spellCheck={false}
          />
        </Field>

        <div className="row-2">
          <Field label="低余额提醒阈值" hint="余额低于该值时发系统通知；填 0 表示不提醒">
            <input
              className="input"
              type="number"
              min={0}
              step="1"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
            />
          </Field>
          <Field
            label="手动余额"
            hint="平台不支持查询接口时可手动填写，同样参与低余额提醒"
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
                style={{ width: 92 }}
                value={manualCurrency}
                onChange={(e) => setManualCurrency(e.target.value)}
              >
                <option value="CNY">CNY</option>
                <option value="USD">USD</option>
              </select>
            </div>
          </Field>
        </div>

        {provider?.adminKeyHint ? (
          <Field
            label="已充值 / 预算总额"
            hint="成本型来源（管理员用量接口只能读到消费额）用「总额 − 累计消费」推算剩余额度并参与低余额提醒"
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

        <Field label="备注" hint="可选，例如「公司报销」「仅用于测试」">
          <input
            className="input"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="可选"
          />
        </Field>

        <div className="hint" style={{ marginBottom: 8 }}>
          API Key 保存在 Windows 凭据管理器（服务名 Quota），配置文件里只记录账户信息，不含密钥。
        </div>
      </details>
    </Modal>
  );
}
