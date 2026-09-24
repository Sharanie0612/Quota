use serde::{Deserialize, Serialize};

/// 全局设置
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// 是否开启后台自动刷新
    pub auto_refresh: bool,
    /// 自动刷新间隔（分钟）
    pub refresh_interval_minutes: u32,
    /// 低余额是否发送系统通知
    pub notify_low_balance: bool,
    /// 关闭主窗口时最小化到托盘
    pub close_to_tray: bool,
    /// 新增账户时的默认低余额提醒阈值
    pub default_low_threshold: f64,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            auto_refresh: true,
            refresh_interval_minutes: 30,
            notify_low_balance: true,
            close_to_tray: true,
            default_low_threshold: 20.0,
        }
    }
}

/// 一个模型供应商账户（API Key 单独保存在系统凭据管理器中，不写入本文件）
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    /// 供应商 id，见 providers.rs
    pub provider: String,
    /// 用户自定义的账户别名，例如「个人号」「团队号」
    pub label: String,
    /// 覆盖默认 Base URL（中转站必填）
    #[serde(default)]
    pub base_url: Option<String>,
    /// 覆盖默认充值页链接
    #[serde(default)]
    pub recharge_url: Option<String>,
    /// 低余额提醒阈值，0 表示不提醒
    #[serde(default)]
    pub low_balance_threshold: f64,
    /// 手动余额（平台不支持余额接口，或接口查询失败时使用）
    #[serde(default)]
    pub manual_balance: Option<f64>,
    #[serde(default)]
    pub manual_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    /// 余额获取方式：auto（按官方接口）/ custom（自定义余额接口）/ manual（手动余额）
    #[serde(default)]
    pub balance_mode: Option<String>,
    /// 自定义余额接口：完整 URL
    #[serde(default)]
    pub custom_url: Option<String>,
    /// 自定义余额接口请求头，每行一个「Key: Value」
    #[serde(default)]
    pub custom_headers: Option<String>,
    /// 从返回 JSON 中取金额的路径，如 data.balance 或 data.items[0].amount
    #[serde(default)]
    pub custom_json_path: Option<String>,
    /// 自定义余额的币种显示
    #[serde(default)]
    pub custom_currency: Option<String>,
    /// 已充值/预算总额，用于「总额 − 累计消费」推算剩余额度
    #[serde(default)]
    pub quota_total: Option<f64>,
    /// 自定义余额接口的请求方法：GET（默认）/ POST
    #[serde(default)]
    pub custom_method: Option<String>,
    /// 自定义余额接口的请求体（POST 时使用，JSON 字符串）
    #[serde(default)]
    pub custom_body: Option<String>,
    pub created_at: String,
}

/// 余额明细项（用于在卡片上展示分项，如「赠送余额」「充值余额」）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BalanceAmount {
    pub label: String,
    pub value: f64,
    /// total | cash | voucher | granted | topped_up | charge | credit | quota | spent
    pub kind: String,
}

/// 余额快照
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Balance {
    pub currency: String,
    pub total: Option<f64>,
    /// api = 官方接口；custom = 自定义余额接口；console = 控制台接口（浏览器 Cookie）；
    /// aliyun = 云厂商账单接口；costs = 管理员用量接口推算；manual = 用户手动填写
    pub source: String,
    pub amounts: Vec<BalanceAmount>,
    /// 账户是否处于「可正常调用」状态（部分平台会返回该字段）
    pub usable: Option<bool>,
    pub note: Option<String>,
    /// 接口原始返回，界面上可展开查看
    pub raw: Option<serde_json::Value>,
}

/// 从接口拉到的模型条目
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteModel {
    pub id: String,
    #[serde(default)]
    pub owned_by: Option<String>,
    #[serde(default)]
    pub created: Option<i64>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub input_limit: Option<i64>,
    #[serde(default)]
    pub output_limit: Option<i64>,
}

/// 账户运行时状态（查询结果，缓存在内存）
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct AccountStatus {
    pub balance: Option<Balance>,
    pub models: Vec<RemoteModel>,
    pub last_checked: Option<String>,
    pub balance_error: Option<String>,
    pub models_error: Option<String>,
}

/// 传给前端的账户视图：账户配置 + 供应商元信息 + 实时状态
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountView {
    pub id: String,
    pub provider: String,
    pub provider_name: String,
    pub provider_vendor: String,
    pub provider_region: String,
    pub provider_custom: bool,
    pub label: String,
    pub note: Option<String>,
    pub low_balance_threshold: f64,
    pub manual_balance: Option<f64>,
    pub manual_currency: Option<String>,
    /// 余额获取方式：auto | custom | manual
    pub balance_mode: String,
    pub custom_url: Option<String>,
    pub custom_headers: Option<String>,
    pub custom_json_path: Option<String>,
    pub custom_currency: Option<String>,
    pub quota_total: Option<f64>,
    #[serde(default)]
    pub custom_method: Option<String>,
    #[serde(default)]
    pub custom_body: Option<String>,
    /// 云平台 AccessKey 的填写提示，为空表示该平台不适用
    pub access_key_hint: Option<String>,
    pub has_key: bool,
    /// 该平台是否需要 API Key（网页版订阅没有接口，不需要密钥）
    pub needs_api_key: bool,
    pub has_admin_key: bool,
    /// 是否已保存云平台 AccessKey 对（阿里云账户余额要用）
    pub has_access_key: bool,
    /// 是否已保存 MiMo 控制台 Cookie
    pub has_console_cookie: bool,
    pub created_at: String,
    /// 该供应商是否支持余额接口
    pub balance_supported: bool,
    /// 不支持时的原因说明
    pub balance_note: Option<String>,
    /// 该平台还能用哪些方式拿到余额（自定义接口 / 管理员接口 / 手动）
    pub balance_alternatives: Vec<String>,
    /// 订阅 / 账单快捷入口（套餐管理、购买续订、查看用量等）
    pub action_links: Vec<ActionLink>,
    pub effective_base_url: String,
    pub effective_recharge_url: String,
    pub billing_url: String,
    pub pricing_url: String,
    pub docs_url: String,
    /// 当前是否低于阈值
    pub low: bool,
    pub status: AccountStatus,
}

/// 新增/修改账户的入参
#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AccountInput {
    #[serde(default)]
    pub id: Option<String>,
    pub provider: String,
    pub label: String,
    #[serde(default)]
    pub api_key: Option<String>,
    #[serde(default)]
    pub base_url: Option<String>,
    #[serde(default)]
    pub recharge_url: Option<String>,
    #[serde(default)]
    pub low_balance_threshold: Option<f64>,
    #[serde(default)]
    pub manual_balance: Option<f64>,
    #[serde(default)]
    pub manual_currency: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
    // ---- 其他获取方式 ----
    #[serde(default)]
    pub balance_mode: Option<String>,
    #[serde(default)]
    pub custom_url: Option<String>,
    #[serde(default)]
    pub custom_headers: Option<String>,
    #[serde(default)]
    pub custom_json_path: Option<String>,
    #[serde(default)]
    pub custom_currency: Option<String>,
    #[serde(default)]
    pub custom_method: Option<String>,
    #[serde(default)]
    pub custom_body: Option<String>,
    #[serde(default)]
    pub quota_total: Option<f64>,
    /// 管理员密钥（如 OpenAI sk-admin-…），仅写入凭据管理器
    #[serde(default)]
    pub admin_key: Option<String>,
    /// 云平台 AccessKey 对（阿里云账单接口），仅写入凭据管理器
    #[serde(default)]
    pub access_key_id: Option<String>,
    #[serde(default)]
    pub access_key_secret: Option<String>,
    /// MiMo 控制台 Cookie（浏览器小米账号 SSO 会话），仅写入凭据管理器
    #[serde(default)]
    pub console_cookie: Option<String>,
}

/// 「订阅 / 账单」快捷入口（只做跳转，不代管支付）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ActionLink {
    pub label: String,
    pub url: String,
}

/// 供应商元信息（用于「添加账户」表单）
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ProviderView {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub region: String,
    pub custom: bool,
    pub default_base_url: String,
    pub base_url_editable: bool,
    pub balance_supported: bool,
    pub balance_note: Option<String>,
    pub recharge_url: String,
    pub billing_url: String,
    pub pricing_url: String,
    pub docs_url: String,
    pub key_hint: String,
    /// 是否需要 API Key（网页版订阅没有接口，不需要密钥）
    pub needs_api_key: bool,
    /// 管理员密钥用途说明（为空表示该平台没有管理员接口）
    pub admin_key_hint: Option<String>,
    /// 云平台 AccessKey 用途说明（为空表示该平台不适用）
    pub access_key_hint: Option<String>,
    /// 该平台可用的其他余额获取方式
    pub balance_alternatives: Vec<String>,
    /// 余额获取方式的可选项（value + label），由后端按平台能力给出
    pub balance_modes: Vec<BalanceModeOption>,
    /// 订阅 / 账单快捷入口（套餐管理、购买续订、查看用量等）
    pub action_links: Vec<ActionLink>,
}

/// 「余额获取方式」下拉里的一个选项
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BalanceModeOption {
    pub value: String,
    pub label: String,
    pub desc: String,
}

/// 本地配置文件结构
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    #[serde(default = "default_config_version")]
    pub version: u32,
    #[serde(default)]
    pub settings: Settings,
    #[serde(default)]
    pub accounts: Vec<Account>,
}

fn default_config_version() -> u32 {
    1
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            version: 1,
            settings: Settings::default(),
            accounts: Vec::new(),
        }
    }
}

/// 模型资料库条目
#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct ModelPrice {
    #[serde(default)]
    pub currency: String,
    #[serde(default)]
    pub unit: String,
    #[serde(default)]
    pub input: Option<f64>,
    #[serde(default)]
    pub output: Option<f64>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogEntry {
    /// 用于匹配 API 返回的 model id，可写多个变体
    #[serde(default)]
    pub r#match: Vec<String>,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub vendor: String,
    /// 适用的供应商 id，空表示通用
    #[serde(default)]
    pub providers: Vec<String>,
    #[serde(default)]
    pub summary: String,
    #[serde(default)]
    pub context: Option<i64>,
    #[serde(default)]
    pub max_output: Option<i64>,
    #[serde(default)]
    pub price: Option<ModelPrice>,
    #[serde(default)]
    pub abilities: Vec<String>,
    /// 是否已对照官网核实过
    #[serde(default)]
    pub verified: bool,
    /// 最近一次核实的时间（RFC3339），用于展示资料新鲜度
    #[serde(default)]
    pub verified_at: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
    /// 用户是否在本地编辑过
    #[serde(default)]
    pub edited: bool,
    /// 过时/已下线：命中的模型不进模型库列表；其 match 键仍用于识别历史 id
    #[serde(default)]
    pub hidden: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CatalogFile {
    #[serde(default)]
    pub updated_at: String,
    #[serde(default)]
    pub disclaimer: String,
    #[serde(default)]
    pub entries: Vec<CatalogEntry>,
}

/// 资料库匹配结果
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelCard {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub summary: String,
    pub context: Option<i64>,
    pub max_output: Option<i64>,
    pub price: Option<ModelPrice>,
    pub abilities: Vec<String>,
    pub verified: bool,
    pub verified_at: Option<String>,
    pub source: Option<String>,
    pub edited: bool,
    /// 价格可信度：high（已核实）/ medium（有价未核实）/ none（无价格）
    pub price_confidence: String,
    /// exact | fuzzy | none
    pub match_quality: String,
    pub owned_by: Option<String>,
    pub created: Option<i64>,
    /// 该模型来自哪些已添加的账户
    pub account_ids: Vec<String>,
    /// 用户在模型库里手动隐藏（本机 hidden_models.json），前端默认不展示
    pub hidden: bool,
}

/// 一个价格来源（用于「价格比对」）
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PriceSource {
    /// 展示名，如「内置资料库」「官方定价页」
    pub name: String,
    /// catalog | official_page | reference
    pub kind: String,
    pub url: String,
    pub currency: String,
    pub unit: String,
    pub input: Option<f64>,
    pub output: Option<f64>,
    pub note: Option<String>,
    /// 抓取/记录时间（RFC3339）
    pub fetched_at: Option<String>,
    /// 是否是本项目核实过的可信来源
    pub trusted: bool,
}

/// 价格比对结果
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PriceComparison {
    pub model_id: String,
    pub model_name: String,
    pub provider: String,
    pub sources: Vec<PriceSource>,
    /// high | medium | low | none
    pub confidence: String,
    pub confidence_reason: String,
    /// 从官方定价页抓到的原文片段，供人工核对
    pub excerpts: Vec<String>,
    /// 各来源给出的建议采用价（优先官方页 → 参考源 → 本地）
    pub suggested: Option<ModelPrice>,
    /// 抓取过程中的问题（非致命），例如第三方参考源不可达
    pub warnings: Vec<String>,
}

/// 自定义余额接口探测出的一个可用金额字段
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredPath {
    pub path: String,
    pub value: f64,
}

/// 自定义余额接口的测试结果
#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct CustomProbe {
    pub ok: bool,
    /// 按配置的路径取到的金额
    pub value: Option<f64>,
    pub currency: String,
    /// 从返回 JSON 里自动发现的所有数值字段（可一键选用）
    pub discovered: Vec<DiscoveredPath>,
    pub raw_preview: String,
    pub error: Option<String>,
}
