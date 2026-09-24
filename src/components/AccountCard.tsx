import { useState } from "react";
import { api, errText } from "../lib/api";
import {
  balanceSourceLabel,
  money,
  timeAgo,
} from "../lib/format";
import { toast } from "../lib/store";
import type { AccountView } from "../lib/types";
import { ProviderLogo } from "./logos";
import {
  IconAlert,
  IconExternal,
  IconLayers,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconWallet,
} from "./icons";
import { Badge, Button, IconButton, Notice } from "./ui";

export function AccountCard({
  account,
  busy,
  onRefresh,
  onEdit,
  onShowModels,
}: {
  account: AccountView;
  busy: boolean;
  onRefresh: () => void;
  onEdit: () => void;
  onShowModels: () => void;
}) {
  const balance = account.status.balance;
  const [showDetail, setShowDetail] = useState(false);

  const openUrl = async (url: string, label: string) => {
    if (!url) {
      toast(`该供应商还没有配置${label}链接，可在「编辑」里自定义`, "error");
      return;
    }
    try {
      await api.openExternal(url);
    } catch (e) {
      toast(errText(e), "error");
    }
  };

  const statusBadge = account.low ? (
    <Badge tone="red">余额不足</Badge>
  ) : balance ? (
    <Badge tone="green">正常</Badge>
  ) : (
    <Badge>待查询</Badge>
  );

  return (
    <div className="card account-card">
      <div className="acct-head">
        <ProviderLogo provider={account.provider} size={34} />
        <div className="acct-title">
          <div className="acct-label">
            {account.label}
            {statusBadge}
          </div>
          <div className="acct-provider" title={account.effectiveBaseUrl}>
            {account.providerName}
            {account.providerRegion && account.providerRegion !== "自定义"
              ? ` · ${account.providerRegion}`
              : ""}
          </div>
        </div>
      </div>

      <div>
        {balance && balance.total !== null ? (
          <>
            <div className="balance-row">
              <span className="balance-value">{money(balance.total, balance.currency)}</span>
              {(() => {
                const label = balanceSourceLabel(balance.source);
                if (!label) return null;
                return (
                  <Badge tone={balance.source === "manual" ? "amber" : "blue"}>{label}</Badge>
                );
              })()}
              {balance.usable === false ? <Badge tone="red">不可调用</Badge> : null}
            </div>
            {balance.source !== "api" && balance.note ? (
              <div className="price-note" style={{ marginTop: 6 }}>
                {balance.note}
              </div>
            ) : null}
            {balance.amounts.length > 0 ? (
              <div className="sub-amounts" style={{ marginTop: 6 }}>
                {balance.amounts.map((a) => (
                  <span key={a.kind + a.label}>
                    {a.label} <b>{money(a.value, balance.currency)}</b>
                  </span>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="balance-row">
            <span className="balance-unknown">
              {account.balanceSupported ||
              account.balanceMode === "aliyun" ||
              account.balanceMode === "console" ||
              account.balanceMode === "custom"
                ? "暂无数据"
                : "不支持自动查询"}
            </span>
          </div>
        )}
      </div>

      {!account.hasKey && account.needsApiKey ? (
        <Notice tone="warn" actions={<Button size="sm" onClick={onEdit}>填写 API Key</Button>}>
          还没有保存 API Key，无法查询余额与模型。
        </Notice>
      ) : null}

      {account.balanceMode !== "manual" &&
      (account.balanceSupported ||
        account.balanceMode === "custom" ||
        account.balanceMode === "aliyun" ||
        account.balanceMode === "console" ||
        (!!account.accessKeyHint && account.balanceMode === "auto")) &&
      account.status.balanceError ? (
        <Notice
          tone="error"
          actions={
            <>
              <Button size="sm" onClick={onRefresh}>
                重试
              </Button>
              <Button size="sm" onClick={onEdit}>
                改用手动余额
              </Button>
              <Button size="sm" onClick={() => openUrl(account.billingUrl, "账单")}>
                打开官网
              </Button>
              {account.status.balanceError.length > 60 ? (
                <Button size="sm" variant="quiet" onClick={() => setShowDetail((v) => !v)}>
                  {showDetail ? "收起详情" : "查看详情"}
                </Button>
              ) : null}
            </>
          }
        >
          {showDetail || account.status.balanceError.length <= 60
            ? account.status.balanceError
            : `${account.status.balanceError.slice(0, 60)}…`}
        </Notice>
      ) : null}

      {!account.balanceSupported &&
      !account.status.balance &&
      !account.status.balanceError &&
      (account.balanceMode === "auto" || account.balanceMode === "manual") ? (
        <Notice
          tone="info"
          actions={
            <>
              <Button size="sm" variant="quiet" onClick={onEdit}>
                设置其他获取方式
              </Button>
              <Button
                size="sm"
                variant="quiet"
                onClick={() => openUrl(account.billingUrl || account.docsUrl, "官网")}
              >
                去官网查看
              </Button>
            </>
          }
        >
          {account.balanceNote ?? "该平台不提供余额查询接口。"}
          {account.balanceAlternatives.length > 0 ? (
            <div style={{ marginTop: 4 }}>
              可用方式：{account.balanceAlternatives.join("；")}
            </div>
          ) : null}
        </Notice>
      ) : null}

      {account.status.modelsError ? (
        <Notice tone="info" actions={<Button size="sm" variant="quiet" onClick={onShowModels}>查看模型说明</Button>}>
          模型列表拉取失败：{account.status.modelsError.slice(0, 80)}
        </Notice>
      ) : null}

      {account.actionLinks.length > 0 ? (
        <div className="tag-row" title="只做跳转，充值与订阅都在官方页面完成">
          {account.actionLinks.map((l) => (
            <button
              key={l.label}
              type="button"
              className="chip"
              onClick={() => void openUrl(l.url, l.label)}
            >
              {l.label}
            </button>
          ))}
        </div>
      ) : null}

      <div className="card-foot">
        <span className="meta">
          更新于 {timeAgo(account.status.lastChecked)}
          {account.status.models.length > 0 ? ` · ${account.status.models.length} 个模型` : ""}
        </span>
        <div className="spacer" />
        <Button size="sm" variant="quiet" onClick={onShowModels} title="查看该账户可用模型">
          <IconLayers size={13} />
          模型
        </Button>
        <IconButton
          title="刷新该账户"
          onClick={onRefresh}
          busy={busy}
          className="btn-sm"
          disabled={busy}
        >
          <IconRefresh size={14} />
        </IconButton>
        <IconButton title="编辑账户" onClick={onEdit} className="btn-sm">
          <IconPencil size={14} />
        </IconButton>
        <Button
          size="sm"
          variant="primary"
          onClick={() => openUrl(account.effectiveRechargeUrl, "充值")}
        >
          <IconExternal size={13} />
          充值
        </Button>
      </div>
    </div>
  );
}

export function EmptyAccounts({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <IconWallet size={26} />
      </div>
      <h3>还没有添加模型账户</h3>
      <p>
        添加 DeepSeek、Kimi、智谱 GLM、小米 MiMo、MiMo 订阅或 GPT 订阅站的 API Key 后，
        这里会显示每个账户的余额、可用模型和官方充值入口。API Key
        保存在 Windows 凭据管理器里，不会上传到任何服务器。
      </p>
      <Button variant="primary" onClick={onAdd}>
        <IconPlus size={14} />
        添加第一个账户
      </Button>
    </div>
  );
}

export function LowBalanceBanner({ accounts }: { accounts: AccountView[] }) {
  const low = accounts.filter((a) => a.low);
  if (low.length === 0) return null;
  return (
    <div className="notice notice-warn" style={{ marginBottom: 16 }}>
      <IconAlert size={14} />
      <div className="notice-text">
        有 {low.length} 个账户余额低于提醒阈值：
        {low.map((a) => {
          const b = a.status.balance;
          return ` ${a.label}（${b && b.total !== null ? money(b.total, b.currency) : "—"}）`;
        })}
        。点击卡片上的「充值」可直接跳转官方充值页。
      </div>
    </div>
  );
}
