import { invoke } from "@tauri-apps/api/core";
import type { MonthlyUsageRate, UsageBill, UsagePriceReference, UsageRate, UsageScope, VendorCostReport, VendorExpense } from "../types";

export const usageApi = {
  getVendorCosts: (from: string, to: string) => invoke<VendorCostReport>("get_vendor_costs", { from, to }),
  saveVendorExpense: (input: VendorExpense, previous: VendorExpense | null = null) =>
    invoke<void>("save_vendor_expense", { input, previous }),
  getUsagePrices: () => invoke<[UsagePriceReference[], Record<string, UsageRate>]>("get_usage_prices"),
  saveUsageCalculation: (model: string, rate: UsageRate | null, scope: UsageScope, bill: UsageBill | null) =>
    invoke<void>("save_usage_calculation", { model, rate, scope, bill }),
  getUsageBills: (scope: UsageScope) => invoke<Record<string, UsageBill>>("get_usage_bills", { scope }),
  syncUsageNow: () => invoke<void>("sync_usage_now"),

  getExchangeRate: () =>
    invoke<{ cnyPerUsd: number; date: string; checkedAt: string; source: string; error: string | null }>("get_exchange_rate"),
  getMonthlyUsageFx: (months: string[]) =>
    invoke<{ rates: MonthlyUsageRate[]; error: string | null }>("get_monthly_usage_fx", { months, average: true }),
  saveMonthlyUsageFx: (month: string, rate: number | null) => invoke<void>("save_monthly_usage_fx", { month, rate }),
};
