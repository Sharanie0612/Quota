import type { AccountView, Balance, BalanceAmount } from "./types";

export const isSubscriptionAccount = (account: Pick<AccountView, "provider" | "balanceMode">) =>
  account.provider === "mimo-plan" || account.provider === "custom" || account.balanceMode === "codex";

export function balanceBreakdown(balance: Balance | null, record?: { manualRechargeTotal?: number | null; manualRechargeCurrency?: string | null; manualSpendTotal?: number | null; manualSpendCurrency?: string | null }) {
  const amounts = (balance?.amounts ?? []).filter((item) => Number.isFinite(item.value));
  const fields: { label: string; item: BalanceAmount | undefined }[] = [
    { label: "充值余额", item: amounts.find((item) => ["cash", "charge", "topped_up"].includes(item.kind)) },
    { label: "赠送余额", item: amounts.find((item) => ["granted", "voucher"].includes(item.kind)) },
    { label: "累计充值", item: amounts.find((item) => ["cumulativerecharge", "totalrecharge", "totalrechargeamount"].includes(item.kind.replace(/[_\s-]/g, "").toLowerCase()) || /^(累计充值|累计充值金额|充值总额|总充值金额)$/.test(item.label.trim())) },
  ];
  if (!fields[2].item && record?.manualRechargeTotal != null && Number.isFinite(record.manualRechargeTotal) && record.manualRechargeTotal >= 0 && ["CNY","USD"].includes(record.manualRechargeCurrency ?? "")) fields[2].item = { label:"累计充值（手动记录）", kind:"manual_cumulative_recharge", value:record.manualRechargeTotal, currency:record.manualRechargeCurrency! };
  let spend = amounts.find(item => ["cumulativespend", "totalspendamount", "cumulativeconsumption", "totalconsumption"].includes(item.kind.replace(/[_\s-]/g, "").toLowerCase()) || /^(累计消费|累计消费金额|累计消耗金额|总消费金额)$/.test(item.label.trim()));
  if (!spend && record?.manualSpendTotal != null && Number.isFinite(record.manualSpendTotal) && record.manualSpendTotal >= 0 && ["CNY", "USD"].includes(record.manualSpendCurrency ?? "")) spend = { label: "累计消费（手动记录）", kind: "manual_cumulative_spend", value: record.manualSpendTotal, currency: record.manualSpendCurrency! };
  const primary = new Set([...fields.map((field) => field.item), spend]);
  return { fields, spend, extra: amounts.filter((item) => !primary.has(item)) };
}

export function overviewState(accounts: AccountView[]) {
  const low = accounts.filter((account) => account.low || account.status.balance?.usable === false).length;
  const failed = accounts.filter((account) => account.balanceMode !== "manual" && !!account.status.balanceError).length;
  const pending = accounts.filter((account) => !account.status.subscription && !account.status.balanceError && (
    !account.status.balance || account.status.balance.source === "manual" && account.balanceMode !== "manual" && !account.status.lastChecked
  )).length;
  return { low, failed, pending };
}
