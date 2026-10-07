/** 与 Rust 端（serde camelCase）对应的类型定义 */

export interface BalanceAmount {
  label: string;
  value: number;
  kind: string;
  currency?: string;
}

export interface Balance {
  currency: string;
  total: number | null;
  /** api = 官方接口；custom = 自定义余额接口；console = MiMo 控制台（浏览器 Cookie）；aliyun = 云厂商账单接口；costs = 管理员用量接口推算；manual = 手动填写 */
  source: "api" | "manual" | "custom" | "costs" | "aliyun" | "console";
  amounts: BalanceAmount[];
  usable: boolean | null;
  note: string | null;
  raw: unknown;
}

/** 订阅 / 账单快捷入口（只做跳转） */
export interface ActionLink {
  label: string;
  url: string;
}

export interface RemoteModel {
  id: string;
  ownedBy: string | null;
  created: number | null;
  description: string | null;
  inputLimit: number | null;
  outputLimit: number | null;
}

export interface AccountStatus {
  subscription?: { plan: string; windows: { label: string; remaining: number; resetAt: number | null }[] } | null;
  balance: Balance | null;
  models: RemoteModel[];
  lastChecked: string | null;
  balanceError: string | null;
  modelsError: string | null;
}

export interface AccountView {
  id: string;
  provider: string;
  providerName: string;
  providerVendor: string;
  providerRegion: string;
  providerCustom: boolean;
  label: string;
  note: string | null;
  lowBalanceThreshold: number;
  manualBalance: number | null;
  manualCurrency: string | null;
  manualRechargeTotal?: number | null;
  manualRechargeCurrency?: string | null;
  manualSpendTotal?: number | null;
  manualSpendCurrency?: string | null;
  /** auto | custom | manual | aliyun */
  balanceMode: string;
  customUrl: string | null;
  customHeaders: string | null;
  customJsonPath: string | null;
  customCurrency: string | null;
  customMethod: string | null;
  customBody: string | null;
  quotaTotal: number | null;
  hasKey: boolean;
  /** 该平台是否需要 API Key（网页版订阅没有接口，不需要密钥） */
  needsApiKey: boolean;
  hasAdminKey: boolean;
  /** 是否已保存云平台 AccessKey 对（阿里云账单方式用） */
  hasAccessKey: boolean;
  /** 是否已保存 MiMo 控制台 Cookie */
  hasConsoleCookie: boolean;
  createdAt: string;
  balanceSupported: boolean;
  balanceNote: string | null;
  /** 云平台 AccessKey 的填写提示，为空表示该平台不适用 */
  accessKeyHint: string | null;
  /** 该平台还能用哪些方式拿余额 */
  balanceAlternatives: string[];
  /** 订阅 / 账单快捷入口（套餐管理、购买续订、查看用量等） */
  actionLinks: ActionLink[];
  effectiveBaseUrl: string;
  effectiveRechargeUrl: string;
  billingUrl: string;
  pricingUrl: string;
  docsUrl: string;
  low: boolean;
  status: AccountStatus;
}

export interface BalanceModeOption {
  value: string;
  label: string;
  desc: string;
}

export interface ProviderView {
  id: string;
  name: string;
  vendor: string;
  region: string;
  custom: boolean;
  defaultBaseUrl: string;
  baseUrlEditable: boolean;
  balanceSupported: boolean;
  balanceNote: string | null;
  rechargeUrl: string;
  billingUrl: string;
  pricingUrl: string;
  docsUrl: string;
  keyHint: string;
  /** 是否需要 API Key（网页版订阅没有接口，不需要密钥） */
  needsApiKey: boolean;
  /** 管理员密钥提示，为空表示无管理员接口 */
  adminKeyHint: string | null;
  /** 云平台 AccessKey 提示，为空表示该平台不适用 */
  accessKeyHint: string | null;
  /** 该平台可用的其他余额获取方式 */
  balanceAlternatives: string[];
  /** 该平台支持的余额获取方式选项 */
  balanceModes: BalanceModeOption[];
  /** 订阅 / 账单快捷入口 */
  actionLinks: ActionLink[];
}

export interface ImportSelection {
  accountIds: string[];
  credentials: boolean;
  settings: boolean;
  catalog: boolean;
  balanceHistory: boolean;
  activity: boolean;
}

export interface ImportPreview {
  fingerprint: string;
  encrypted: boolean;
  accounts: {id: string; label: string; provider: string; hasCredentials: boolean}[];
  credentials: boolean;
  settings: boolean;
  catalog: boolean;
  catalogCount: number;
  balanceHistory: boolean;
  historyCount: number;
  activity: boolean;
  activityCount: number;
}

export interface Settings {
  notifyRecharge: boolean;
  trayAlert: boolean;
  ladderAutoUpdate: boolean;
  autoRefresh: boolean;
  refreshIntervalMinutes: number;
  notifyLowBalance: boolean;
  closeToTray: boolean;
  defaultLowThreshold: number;
}

export interface ModelPrice {
  cachedInput?: number | null;
  cacheWrite?: number | null;
  cacheWriteLong?: number | null;
  currency: string;
  unit: string;
  input: number | null;
  output: number | null;
  note: string | null;
}

export interface ModelCard {
  id: string;
  name: string;
  vendor: string;
  summary: string;
  context: number | null;
  maxOutput: number | null;
  price: ModelPrice | null;
  abilities: string[];
  verified: boolean;
  /** 最近一次核实时间（RFC3339） */
  verifiedAt: string | null;
  source: string | null;
  edited: boolean;
  /** high（已核实）/ medium（有价未核实）/ none（无价格） */
  priceConfidence: "high" | "medium" | "none";
  matchQuality: "exact" | "fuzzy" | "none";
  ownedBy: string | null;
  created: number | null;
  accountIds: string[];
  /** 用户在模型库里手动隐藏（本机 hidden_models.json），列表默认不展示 */
  hidden: boolean;
}

export interface CatalogEntry {
  match: string[];
  name: string;
  vendor: string;
  providers: string[];
  summary: string;
  context: number | null;
  maxOutput: number | null;
  price: ModelPrice | null;
  abilities: string[];
  verified: boolean;
  verifiedAt: string | null;
  source: string | null;
  edited: boolean;
  /** 过时/已下线：命中的模型不出现在模型库列表（仅 Rust 端读取） */
  hidden?: boolean;
}

/** 「价格比对」里的一个来源 */
export interface PriceSource {
  name: string;
  kind: "catalog" | "builtin" | "official_page" | "reference";
  url: string;
  currency: string;
  unit: string;
  input: number | null;
  output: number | null;
  cachedInput?: number | null;
  cacheWrite?: number | null;
  cacheWriteLong?: number | null;
  note: string | null;
  fetchedAt: string | null;
  trusted: boolean;
}

export interface PriceComparison {
  suggestedSource?: PriceSource | null;
  modelId: string;
  modelName: string;
  provider: string;
  sources: PriceSource[];
  confidence: "high" | "medium" | "low" | "none";
  confidenceReason: string;
  excerpts: string[];
  suggested: ModelPrice | null;
  warnings: string[];
}

export interface DiscoveredPath {
  path: string;
  value: number;
}

export interface CustomProbe {
  ok: boolean;
  value: number | null;
  currency: string;
  discovered: DiscoveredPath[];
  rawPreview: string;
  error: string | null;
}

export interface AccountInput {
  connectionId?: string | null;
  id?: string | null;
  provider: string;
  label: string;
  apiKey?: string | null;
  baseUrl?: string | null;
  rechargeUrl?: string | null;
  lowBalanceThreshold?: number | null;
  manualBalance?: number | null;
  manualCurrency?: string | null;
  manualRechargeTotal?: number | null;
  manualRechargeCurrency?: string | null;
  manualSpendTotal?: number | null;
  manualSpendCurrency?: string | null;
  note?: string | null;
  balanceMode?: string | null;
  customUrl?: string | null;
  customHeaders?: string | null;
  customJsonPath?: string | null;
  customCurrency?: string | null;
  customMethod?: string | null;
  customBody?: string | null;
  quotaTotal?: number | null;
  adminKey?: string | null;
  accessKeyId?: string | null;
  accessKeySecret?: string | null;
  /** MiMo 控制台 Cookie（浏览器小米账号 SSO 会话） */
  consoleCookie?: string | null;
}

export interface AppInfo {
  version: string;
  configDir: string;
  storageIssues?: string[];
}

export interface LadderEntry {
  releasedAt?: string | null;
  candidate?: LadderPriceCheck | null;
  id: string;
  name: string;
  vendor: string;
  provider: string;
  rankings: Record<string, { rank: number; score: number; source: string; updatedAt: string }>;
  price: ModelPrice;
  priceSource: string;
  verifiedAt: string | null;
}

export interface LadderSnapshot {
  entries: LadderEntry[];
  source: string;
  updatedAt: string;
  checkedAt: string | null;
  error: string | null;
}

export interface LadderPriceCheck {
  prices: ModelPrice[];
  excerpts: string[];
  checkedAt: string;
  error: string | null;
}

/** 余额历史采样点（t = Unix 秒，v = 余额） */
export interface HistoryPoint {
  t: number;
  v: number;
}

/** 单账户的余额趋势（Rust 端 history.rs 计算） */
export interface AccountTrend {
  points: HistoryPoint[];
  /** 最近 7 天拟合的日均消耗（正数 = 在消耗；null = 样本不足） */
  dailyBurn: number | null;
  /** 按当前速度估算的可用天数 */
  daysLeft: number | null;
}

/** 刷新时检测到的疑似充值事件（Rust 端通过 recharge-detected 事件广播） */
export type RechargeEvent = {
  accountId: string;
  label: string;
  currency: string;
  /** 相对上一条记录的涨幅 */
  amount: number;
  total: number;
};
export interface ActivityTokens { input: number; cached: number; cacheWrite: number; output: number; reasoning: number; total: number }
export interface ActivityGroup { key: string; tokens: ActivityTokens; calls: number; sessions: number }
export interface ActivityOptions { deviceId: string; deviceName: string; autoCollect: boolean; collectIntervalSeconds: number; syncAccounts: boolean; codexHome: string; zcodeHome: string; harnessHome: string; syncDir: string }
export interface ActivityReport { options: ActivityOptions; devices: {id: string; name: string}[]; totals: ActivityGroup; models: ActivityGroup[]; availableModels: ActivityGroup[]; tools: ActivityGroup[]; agents: ActivityGroup[]; daily: ActivityGroup[]; hourly: ActivityGroup[]; sources: ActivityGroup[]; byDevice: ActivityGroup[]; updatedAt: number | null; errors: string[] }
