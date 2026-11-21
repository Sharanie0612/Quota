import { invoke } from "@tauri-apps/api/core";
import type {
  AccountInput, AccountSyncCandidate, AccountTrend, AccountView, CustomProbe,
  MimoLoginStatus, ProviderView,
} from "../types";

export const accountsApi = {
  listProviders: () => invoke<ProviderView[]>("list_providers"),
  listAccounts: () => invoke<AccountView[]>("list_accounts"),
  saveAccount: (input: AccountInput) => invoke<AccountView>("save_account", { input }),
  deleteAccount: (id: string) => invoke<void>("delete_account", { id }),
  refreshAccount: (id: string) => invoke<AccountView>("refresh_account", { id }),
  refreshAll: () => invoke<AccountView[]>("refresh_all"),
  getBalanceHistory: () => invoke<Record<string, AccountTrend>>("get_balance_history"),
  probeCustomBalance: (input: Pick<AccountInput,
    "customUrl" | "customHeaders" | "customJsonPath" | "customCurrency" | "customMethod" | "customBody"
  >) => invoke<CustomProbe>("probe_custom_balance", { input }),
  /** 生成包含该账户 API Key 的调用示例。 */
  apiSnippet: (accountId: string, modelId: string) =>
    invoke<string>("api_snippet", { accountId, modelId }),

  startMimoLogin: (accountId?: string) => invoke<void>("start_mimo_login", { accountId: accountId ?? null }),
  pollMimoLogin: (provider: string) => invoke<MimoLoginStatus>("poll_mimo_login", { provider }),
  listMimoConnections: () => invoke<{ id: string; label: string }[]>("list_mimo_connections"),
  reuseMimoConnection: (accountId: string, provider: string) =>
    invoke<string>("reuse_mimo_connection", { accountId, provider }),
  finishMimoLogin: (provider: string) => invoke<string>("finish_mimo_login", { provider }),
  cancelMimoLogin: () => invoke<void>("cancel_mimo_login"),
  connectChatgpt: () => invoke<string>("connect_chatgpt"),
  discardConnection: (id: string) => invoke<void>("discard_connection", { id }),

  getAccountSyncStatus: () => invoke<{ lastSynced: string | null; error: string | null }>("get_account_sync_status"),
  syncAccounts: () => invoke<void>("sync_accounts"),
  getAccountSyncCandidates: () => invoke<AccountSyncCandidate[]>("get_account_sync_candidates"),
  resolveAccountSync: (sourceId: string, targetId: string | null) =>
    invoke<void>("resolve_account_sync", { sourceId, targetId }),
};
