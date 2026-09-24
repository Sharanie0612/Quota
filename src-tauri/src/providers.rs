//! 供应商元信息与余额/模型接口适配。
//!
//! 设计原则：任何一家的接口变动都不应让软件不可用 —— 适配器失败时返回可读的错误说明，
//! 界面会提示改用「手动余额」，并始终提供官网链接让用户自行核实。

use crate::model::{Balance, BalanceAmount, BalanceModeOption, RemoteModel};
use chrono::Local;
use serde_json::Value;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BalanceProbe {
    /// GET {base}/user/balance
    DeepSeek,
    /// GET {base}/users/me/balance
    Moonshot,
    /// GET {base}/user/info
    SiliconFlow,
    /// one-api / new-api 风格：/dashboard/billing/subscription + /usage
    OneApiBilling,
    /// 阿里云 BSS QueryAccountBalance（用 AccessKey 签名调用，读的是阿里云账户余额）
    AliyunBss,
    /// 智谱账户报表接口（官方文档未收录，实测可用；挂在 open.bigmodel.cn 的 /api/biz/ 下）
    ZhipuAccount,
    /// 小米 MiMo 控制台接口（用浏览器里的小米账号 Cookie 查询余额 / 本月用量 / 套餐余量）
    MimoConsole,
    /// 平台未提供可用的余额查询接口
    Unsupported(&'static str),
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum ModelsStyle {
    /// OpenAI 兼容：GET {base}/models，Bearer 鉴权
    OpenAi,
    /// Anthropic：GET {base}/models，x-api-key 鉴权
    Anthropic,
    /// Google：GET {base}/models?key=...
    Gemini,
}

/// 官方余额接口不可用时，可以走的「其他方式」
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AdminProbe {
    /// OpenAI 官方用量接口：GET {base}/organization/costs（需要组织管理员密钥）
    OpenAiCosts,
}

/// 该平台是否有管理员级接口可用
pub fn admin_probe(def: &ProviderDef) -> Option<AdminProbe> {
    match def.id {
        "openai" => Some(AdminProbe::OpenAiCosts),
        _ => None,
    }
}

/// 管理员密钥的填写提示（为空表示该平台没有管理员接口）
pub fn admin_key_hint(def: &ProviderDef) -> Option<&'static str> {
    match def.id {
        "openai" => Some("sk-admin-…（platform.openai.com → 组织设置 → Admin keys；用于读取近 30 天消费）"),
        _ => None,
    }
}

/// 云平台 AccessKey 的填写提示（为空表示该平台不适用）
pub fn access_key_hint(def: &ProviderDef) -> Option<&'static str> {
    match def.id {
        "dashscope" => Some(
            "阿里云 AccessKey ID + Secret（阿里云控制台 → 右上角头像 → AccessKey 管理，建议用 RAM 子账号并只授予 bss:DescribeAcccount 只读权限）",
        ),
        _ => None,
    }
}

/// 列出该平台「其他方式」拿到余额的途径，界面上作为提示展示
pub fn balance_alternatives(def: &ProviderDef) -> Vec<String> {
    match def.id {
        "deepseek" | "moonshot" | "siliconflow" => Vec::new(),
        "openai" => vec![
            "管理员密钥 + 官方用量接口：读取近 30 天消费，配合「已充值/预算总额」推算剩余额度".into(),
            "自定义余额接口".into(),
            "手动余额".into(),
        ],
        "anthropic" => vec![
            "自定义余额接口（Anthropic 的成本报表走 Console 管理员权限，接口路径未在本机核实，若失败请改用自定义方式）".into(),
            "手动余额".into(),
        ],
        "dashscope" => vec![
            "阿里云 AccessKey + 账单接口：读取阿里云账户可用额度（百炼的费用就从这里扣）".into(),
            "自定义余额接口".into(),
            "手动余额".into(),
        ],
        "zhipu" => vec![
            "自定义余额接口：填一个能返回余额 JSON 的地址（自己控制台的接口、中转站接口都行）并指定 JSON 路径".into(),
            "手动余额".into(),
        ],
        "mimo" | "mimo-plan" => vec![
            "控制台 Cookie：粘贴浏览器里的小米账号 Cookie，自动查余额、本月用量与套餐余量".into(),
            "自定义余额接口".into(),
            "手动余额".into(),
        ],        _ => vec![
            "自定义余额接口：填一个能返回余额 JSON 的地址（控制台 / 账单 / 中转站接口都行）并指定 JSON 路径".into(),
            "手动余额".into(),
        ],
    }
}

/// 该账户可选的「余额获取方式」，按平台能力裁剪
pub fn balance_modes(def: &ProviderDef) -> Vec<BalanceModeOption> {
    let mut out = Vec::new();
    match def.balance {
        BalanceProbe::Unsupported(_) => {}
        BalanceProbe::AliyunBss => {}
        BalanceProbe::MimoConsole => out.push(BalanceModeOption {
            value: "console".into(),
            label: "控制台 Cookie".into(),
            desc: "粘贴浏览器里的小米账号 Cookie，自动查余额、本月用量与套餐余量（官方没有查询 API，这是唯一能自动查的办法）。"
                .into(),
        }),
        _ => {
            let desc = if def.id == "zhipu" {
                "调用智谱账户报表接口读取可用余额（该接口未在官方文档收录，实测可用）。"
            } else {
                "使用该平台的官方余额接口自动查询。"
            };
            out.push(BalanceModeOption {
                value: "auto".into(),
                label: "官方接口".into(),
                desc: desc.into(),
            });
        }
    }
    if def.id == "dashscope" {
        out.push(BalanceModeOption {
            value: "aliyun".into(),
            label: "阿里云账单".into(),
            desc: "用阿里云 AccessKey 调用 BSS 账单接口，读取阿里云账户的可用额度。".into(),
        });
    }
    out.push(BalanceModeOption {
        value: "custom".into(),
        label: "自定义接口".into(),
        desc: "填一个能返回余额 JSON 的地址（自己控制台的接口、账单页接口、中转站接口都行），软件按刷新间隔自动取值。".into(),
    });
    out.push(BalanceModeOption {
        value: "manual".into(),
        label: "手动余额".into(),
        desc: "只用填写的手动余额，不发起任何余额请求。".into(),
    });
    out
}

pub struct ProviderDef {
    pub id: &'static str,
    pub name: &'static str,
    pub vendor: &'static str,
    pub region: &'static str,
    pub default_base_url: &'static str,
    pub base_url_editable: bool,
    pub custom: bool,
    pub models_path: &'static str,
    pub models_style: ModelsStyle,
    pub balance: BalanceProbe,
    pub balance_path: &'static str,
    pub recharge_url: &'static str,
    pub billing_url: &'static str,
    pub pricing_url: &'static str,
    pub docs_url: &'static str,
    pub key_hint: &'static str,
}

const UNSET: &str = "";

static DEFS: &[ProviderDef] = &[
    ProviderDef {
        id: "deepseek",
        name: "DeepSeek 开放平台",
        vendor: "DeepSeek",
        region: "国内",
        default_base_url: "https://api.deepseek.com",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        balance: BalanceProbe::DeepSeek,
        balance_path: "/user/balance",
        recharge_url: "https://platform.deepseek.com/top_up",
        billing_url: "https://platform.deepseek.com/usage",
        pricing_url: "https://api-docs.deepseek.com/quick_start/pricing",
        docs_url: "https://api-docs.deepseek.com",
        key_hint: "sk-…（DeepSeek 控制台 → API keys）",
    },
    ProviderDef {
        id: "moonshot",
        name: "Kimi 开放平台（Moonshot）",
        vendor: "月之暗面 Kimi",
        region: "国内",
        default_base_url: "https://api.moonshot.cn/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        balance: BalanceProbe::Moonshot,
        balance_path: "/users/me/balance",
        recharge_url: "https://platform.moonshot.cn/console/account",
        billing_url: "https://platform.moonshot.cn/console/account",
        pricing_url: "https://platform.kimi.com/docs/pricing",
        docs_url: "https://platform.kimi.com/docs",
        key_hint: "sk-…（Kimi 开放平台 → API Key 管理）",
    },
    ProviderDef {
        id: "zhipu",
        name: "智谱 GLM（BigModel）",
        vendor: "智谱 GLM",
        region: "国内",
        default_base_url: "https://open.bigmodel.cn/api/paas/v4",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        // 官方文档没有收录余额接口，但 open.bigmodel.cn 的账户报表接口实测可用
        // （鉴权失败也返回 HTTP 200，解析时必须看 success 字段）
        balance: BalanceProbe::ZhipuAccount,
        balance_path: UNSET,
        recharge_url: "https://open.bigmodel.cn/finance/overview",
        billing_url: "https://open.bigmodel.cn/finance/overview",
        pricing_url: "https://docs.bigmodel.cn/cn/guide/start/pricing",
        docs_url: "https://docs.bigmodel.cn",
        key_hint: "形如 xxxx.xxxx 的 API Key（智谱开放平台 → API Keys）",
    },
    ProviderDef {
        id: "dashscope",
        name: "阿里云百炼（通义千问）",
        vendor: "阿里云 · 通义千问",
        region: "国内",
        default_base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        // 百炼没有用 API Key 查余额的接口，但费用出自阿里云账户，
        // 可用 AccessKey 调 BSS 账单接口读阿里云账户可用额度
        balance: BalanceProbe::AliyunBss,
        balance_path: UNSET,
        recharge_url: "https://bailian.console.aliyun.com/?expenseType=BILL",
        billing_url: "https://usercenter2.aliyun.com/finance/fund-management/recharge",
        pricing_url: "https://help.aliyun.com/zh/model-studio/models",
        docs_url: "https://help.aliyun.com/zh/model-studio/",
        key_hint: "sk-…（百炼控制台 → API-KEY 管理）",
    },
    ProviderDef {
        id: "siliconflow",
        name: "硅基流动 SiliconFlow",
        vendor: "硅基流动",
        region: "国内",
        default_base_url: "https://api.siliconflow.cn/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        balance: BalanceProbe::SiliconFlow,
        balance_path: "/user/info",
        recharge_url: "https://cloud.siliconflow.cn/account/finance",
        billing_url: "https://cloud.siliconflow.cn/account/finance",
        pricing_url: "https://cloud.siliconflow.cn/models",
        docs_url: "https://docs.siliconflow.cn",
        key_hint: "sk-…（硅基流动控制台 → API 密钥）",
    },
    ProviderDef {
        id: "openai",
        name: "OpenAI Platform",
        vendor: "OpenAI",
        region: "国际",
        default_base_url: "https://api.openai.com/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        balance: BalanceProbe::Unsupported("OpenAI 不提供用普通 API Key 查询余额的接口（成本报表需要组织管理员 Key）。请在账单页查看，或使用「手动余额」。"),
        balance_path: UNSET,
        recharge_url: "https://platform.openai.com/settings/organization/billing/overview",
        billing_url: "https://platform.openai.com/settings/organization/billing/overview",
        pricing_url: "https://openai.com/api/pricing/",
        docs_url: "https://platform.openai.com/docs",
        key_hint: "sk-…（platform.openai.com → API keys）",
    },
    ProviderDef {
        id: "anthropic",
        name: "Anthropic Claude",
        vendor: "Anthropic",
        region: "国际",
        default_base_url: "https://api.anthropic.com/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::Anthropic,
        balance: BalanceProbe::Unsupported("Anthropic 的余额与成本报表需要 Console 管理员权限查看，普通 API Key 无法查询。可用「手动余额」参与提醒。"),
        balance_path: UNSET,
        recharge_url: "https://console.anthropic.com/settings/billing",
        billing_url: "https://console.anthropic.com/settings/billing",
        pricing_url: "https://platform.claude.com/docs/en/about-claude/pricing",
        docs_url: "https://platform.claude.com/docs",
        key_hint: "sk-ant-…（console.anthropic.com → API keys）",
    },
    ProviderDef {
        id: "gemini",
        name: "Google Gemini",
        vendor: "Google",
        region: "国际",
        default_base_url: "https://generativelanguage.googleapis.com/v1beta",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::Gemini,
        balance: BalanceProbe::Unsupported("Gemini 按 Google Cloud 项目结算，没有账户余额接口。请在 Google Cloud 账单页查看，或使用「手动余额」。"),
        balance_path: UNSET,
        recharge_url: "https://console.cloud.google.com/billing",
        billing_url: "https://console.cloud.google.com/billing",
        pricing_url: "https://ai.google.dev/gemini-api/docs/pricing",
        docs_url: "https://ai.google.dev/gemini-api/docs",
        key_hint: "AIza…（Google AI Studio → Get API key）",
    },
    ProviderDef {
        id: "mimo",
        name: "小米 MiMo 开放平台",
        vendor: "小米",
        region: "国内",
        // 官方 OpenAI 兼容地址（小米 MiMo 开放平台 · 按量付费）
        default_base_url: "https://api.xiaomimimo.com/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        // 官方文档只提供控制台余额页，但控制台接口可用浏览器 Cookie 查询
        balance: BalanceProbe::MimoConsole,
        balance_path: UNSET,
        recharge_url: "https://platform.xiaomimimo.com/#/console/recharge",
        billing_url: "https://platform.xiaomimimo.com/#/console/balance",
        pricing_url: "https://mimo.mi.com/docs/price/pay-as-you-go",
        docs_url: "https://mimo.mi.com/docs",
        key_hint: "sk-…（小米 MiMo 开放平台 → API Keys；Token Plan 的 tp-… 密钥走另一套地址）",
    },
    ProviderDef {
        id: "mimo-plan",
        name: "小米 MiMo 订阅（Token Plan）",
        vendor: "小米",
        region: "国内",
        // Token Plan 用独立的地址与密钥（tp-… / tttp…），与按量付费的 sk- 不通用
        default_base_url: "https://token-plan-cn.xiaomimimo.com/v1",
        base_url_editable: true,
        custom: false,
        models_path: "/models",
        models_style: ModelsStyle::OpenAi,
        // 订阅额度与本月用量同样走控制台接口（Cookie）
        balance: BalanceProbe::MimoConsole,
        balance_path: UNSET,
        // 订阅的「充值」就是买/续订套餐；套餐管理页另有入口（卡片上的「套餐管理」按钮）
        recharge_url: "https://platform.xiaomimimo.com/#/token-plan",
        billing_url: "https://platform.xiaomimimo.com/#/console/usage",
        pricing_url: "https://platform.xiaomimimo.com/token-plan",
        docs_url: "https://mimo.mi.com/docs",
        key_hint: "tp-…（个人订阅）/ tttp…（团队订阅），在「套餐管理」页创建，创建时才能看到",
    },
    ProviderDef {
        // 官方 ChatGPT 订阅（Plus/Pro）：没有 API Key、没有 Base URL、没有余额，
        // 能做的是订阅操作入口；订阅状态与使用限额要靠 chatgpt.com 的登录 Cookie 查询
        id: "custom",
        name: "ChatGPT 订阅（OpenAI 官方）",
        vendor: "ChatGPT",
        region: "国际",
        default_base_url: "",
        base_url_editable: true,
        custom: false,
        // 网页订阅没有 /models 接口，留空表示不拉模型列表
        models_path: "",
        models_style: ModelsStyle::OpenAi,
        balance: BalanceProbe::Unsupported(
            "ChatGPT 订阅给的是使用额度（每周 / 每 5 小时窗口的用量上限），不是可充值余额。套餐状态与续费信息点卡片上的「订阅设置」查看；要在卡片上直接显示当前剩余额度，需要用登录 Cookie 查询。",
        ),
        balance_path: UNSET,
        recharge_url: "https://chatgpt.com/#/settings/subscription",
        billing_url: "https://chatgpt.com/#/settings/subscription",
        pricing_url: "https://openai.com/chatgpt/pricing/",
        docs_url: "https://chatgpt.com",
        key_hint: "官方 ChatGPT 订阅不需要填 API Key（它不是接口，没有密钥）",
    },
];

pub fn provider_defs() -> &'static [ProviderDef] {
    DEFS
}

/// 暂时不在界面上出现的供应商（代码路径保留，想加回来把这个数组里的 id 删掉即可）。
/// 界面只保留 DeepSeek / Kimi / 智谱 GLM / 小米 MiMo / 小米 MiMo 订阅 / GPT 订阅。
const HIDDEN: [&str; 5] = ["dashscope", "siliconflow", "openai", "anthropic", "gemini"];

/// 「添加账户」下拉里能看到的供应商
pub fn visible_defs() -> impl Iterator<Item = &'static ProviderDef> {
    provider_defs().iter().filter(|d| !HIDDEN.contains(&d.id))
}

pub fn find(id: &str) -> Option<&'static ProviderDef> {
    DEFS.iter().find(|d| d.id == id)
}

/// 该平台能否用「API Key」直接查余额。阿里云账单方式用的是 AccessKey，不算在内。
pub fn api_key_balance_supported(def: &ProviderDef) -> bool {
    matches!(
        def.balance,
        BalanceProbe::DeepSeek
            | BalanceProbe::Moonshot
            | BalanceProbe::SiliconFlow
            | BalanceProbe::OneApiBilling
            | BalanceProbe::ZhipuAccount
    )
}

/// 该平台是否需要 API Key（`models_path` 为空表示是网页版订阅，没有接口也就没有密钥）
pub fn needs_api_key(def: &ProviderDef) -> bool {
    !def.models_path.is_empty()
}

/// 界面上展示的余额能力说明（不支持时为原因，支持阿里云账单时为提示）
pub fn balance_note(def: &ProviderDef) -> Option<String> {
    match def.balance {
        BalanceProbe::Unsupported(reason) => Some(reason.to_string()),
        BalanceProbe::AliyunBss => Some(
            "百炼本身没有余额接口，但它从阿里云账户扣费：填一对阿里云 AccessKey 后，可用账单接口读取阿里云账户的可用额度。"
                .to_string(),
        ),
        BalanceProbe::MimoConsole => Some(
            "MiMo 的余额、本月用量与套餐余量要靠浏览器里的小米账号 Cookie 查询（官方没有查询 API）：在「控制台 Cookie」方式里粘贴一次即可自动查，Cookie 失效时会提示重新复制。"
                .to_string(),
        ),
        _ => None,
    }
}

/// 订阅/账单相关的快捷入口（只做跳转，不代管支付）
pub fn action_links(def: &ProviderDef) -> Vec<crate::model::ActionLink> {
    let link = |label: &str, url: &str| crate::model::ActionLink {
        label: label.to_string(),
        url: url.to_string(),
    };
    match def.id {
        "mimo" => vec![
            link("充值", "https://platform.xiaomimimo.com/#/console/recharge"),
            link("余额明细", "https://platform.xiaomimimo.com/#/console/balance"),
            link("本月用量", "https://platform.xiaomimimo.com/#/console/usage"),
        ],
        "mimo-plan" => vec![
            link("套餐管理", "https://platform.xiaomimimo.com/#/console/plan-manage"),
            link("购买 / 续订", "https://platform.xiaomimimo.com/#/token-plan"),
            link("本月用量", "https://platform.xiaomimimo.com/#/console/usage"),
            link("余额明细", "https://platform.xiaomimimo.com/#/console/balance"),
        ],
        "custom" => vec![
            link("订阅设置", "https://chatgpt.com/#/settings/subscription"),
            link("定价 / 升级", "https://openai.com/chatgpt/pricing/"),
            link("OpenAI 帮助中心", "https://help.openai.com/"),
        ],
        _ => Vec::new(),
    }
}

/// 智谱账户报表接口：挂在 open.bigmodel.cn 的 /api/biz/ 前缀下，
/// 不在推理用的 /api/paas/v4 里，所以不跟随账户配置的 Base URL（中转站没有这个接口）。
pub const ZHIPU_ACCOUNT_REPORT_URL: &str =
    "https://open.bigmodel.cn/api/biz/account/query-customer-account-report";

pub fn base_url_of(def: &ProviderDef, account_base: &Option<String>) -> String {
    let b = account_base
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .unwrap_or(def.default_base_url);
    b.trim_end_matches('/').to_string()
}

fn join(base: &str, path: &str) -> String {
    format!("{}/{}", base.trim_end_matches('/'), path.trim_start_matches('/'))
}

fn num(v: &Value) -> Option<f64> {
    match v {
        Value::Number(n) => n.as_f64(),
        Value::String(s) => s.trim().trim_start_matches('$').parse::<f64>().ok(),
        _ => None,
    }
}

fn get<'a>(v: &'a Value, path: &[&str]) -> Option<&'a Value> {
    let mut cur = v;
    for key in path {
        cur = cur.get(*key)?;
    }
    Some(cur)
}

fn num_at(v: &Value, path: &[&str]) -> Option<f64> {
    get(v, path).and_then(num)
}

fn explain_status(status: u16, body: &str, provider: &str) -> String {
    let snippet: String = body.chars().take(220).collect();
    let snippet = snippet.trim();
    let tail = if snippet.is_empty() {
        String::new()
    } else {
        format!(" 返回内容：{snippet}")
    };
    match status {
        400 => format!("请求被 {provider} 拒绝（400），请检查 Base URL 与参数。{tail}"),
        401 => format!("{provider} 返回 401：API Key 无效、已过期或填写有误。{tail}"),
        403 => format!("{provider} 返回 403：该 Key 无权访问此接口（部分平台需管理员权限）。{tail}"),
        404 => format!("{provider} 返回 404：接口不存在，通常是 Base URL 写错（中转站一般以 /v1 结尾）。{tail}"),
        429 => format!("{provider} 返回 429：请求过于频繁，请稍后重试。{tail}"),
        _ => format!("{provider} 返回 HTTP {status}。{tail}"),
    }
}

fn explain_net(err: reqwest::Error, provider: &str) -> String {
    if err.is_timeout() {
        format!("连接 {provider} 超时。国内访问国际平台通常需要系统代理，请检查网络后重试。")
    } else if err.is_connect() {
        format!("无法连接 {provider}：请检查网络、代理或 Base URL 是否正确。")
    } else {
        format!("请求 {provider} 失败：{err}")
    }
}

/// 查询余额。仅在 def.balance 不是 Unsupported 时调用。
pub async fn fetch_balance(
    client: &reqwest::Client,
    def: &ProviderDef,
    base: &str,
    key: &str,
) -> Result<Balance, String> {
    match def.balance {
        BalanceProbe::DeepSeek => {
            let url = join(base, def.balance_path);
            let resp = client
                .get(&url)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| explain_net(e, def.name))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(explain_status(status.as_u16(), &text, def.name));
            }
            let v: Value = serde_json::from_str(&text)
                .map_err(|e| format!("解析 {} 返回内容失败：{e}", def.name))?;
            let first = get(&v, &["balance_infos"])
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .cloned()
                .unwrap_or(Value::Null);
            let currency = get(&first, &["currency"])
                .and_then(|c| c.as_str())
                .unwrap_or("CNY")
                .to_string();
            let total = num_at(&first, &["total_balance"]);
            let mut amounts = Vec::new();
            if let Some(v) = num_at(&first, &["topped_up_balance"]) {
                amounts.push(BalanceAmount { label: "充值余额".into(), value: v, kind: "topped_up".into() });
            }
            if let Some(v) = num_at(&first, &["granted_balance"]) {
                amounts.push(BalanceAmount { label: "赠送余额".into(), value: v, kind: "granted".into() });
            }
            Ok(Balance {
                currency,
                total,
                source: "api".into(),
                amounts,
                usable: get(&v, &["is_available"]).and_then(|b| b.as_bool()),
                note: Some("数据来自 DeepSeek 官方余额接口".into()),
                raw: Some(v),
            })
        }
        BalanceProbe::Moonshot => {
            let url = join(base, def.balance_path);
            let resp = client
                .get(&url)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| explain_net(e, def.name))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(explain_status(status.as_u16(), &text, def.name));
            }
            let v: Value = serde_json::from_str(&text)
                .map_err(|e| format!("解析 {} 返回内容失败：{e}", def.name))?;
            let data = get(&v, &["data"])
                .ok_or_else(|| format!("{} 返回结构异常：缺少 data 字段", def.name))?;
            let mut amounts = Vec::new();
            if let Some(x) = num_at(data, &["cash_balance"]) {
                amounts.push(BalanceAmount { label: "现金余额".into(), value: x, kind: "cash".into() });
            }
            if let Some(x) = num_at(data, &["voucher_balance"]) {
                amounts.push(BalanceAmount { label: "代金券".into(), value: x, kind: "voucher".into() });
            }
            Ok(Balance {
                currency: "CNY".into(),
                total: num_at(data, &["available_balance"]),
                source: "api".into(),
                amounts,
                usable: num_at(data, &["available_balance"]).map(|b| b > 0.0),
                note: Some("数据来自 Kimi 开放平台余额接口".into()),
                raw: Some(v),
            })
        }
        BalanceProbe::SiliconFlow => {
            let url = join(base, def.balance_path);
            let resp = client
                .get(&url)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| explain_net(e, def.name))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(explain_status(status.as_u16(), &text, def.name));
            }
            let v: Value = serde_json::from_str(&text)
                .map_err(|e| format!("解析 {} 返回内容失败：{e}", def.name))?;
            let data = get(&v, &["data"]).unwrap_or(&v);
            let mut amounts = Vec::new();
            if let Some(x) = num_at(data, &["chargeBalance"]) {
                amounts.push(BalanceAmount { label: "充值余额".into(), value: x, kind: "charge".into() });
            }
            if let Some(x) = num_at(data, &["balance"]) {
                amounts.push(BalanceAmount { label: "赠送余额".into(), value: x, kind: "granted".into() });
            }
            let total = num_at(data, &["totalBalance"])
                .or_else(|| num_at(data, &["balance"]));
            Ok(Balance {
                currency: "CNY".into(),
                total,
                source: "api".into(),
                amounts,
                usable: total.map(|t| t > 0.0),
                note: Some("数据来自硅基流动账户接口".into()),
                raw: Some(v),
            })
        }
        BalanceProbe::OneApiBilling => {
            let sub_url = join(base, def.balance_path);
            let resp = client
                .get(&sub_url)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| explain_net(e, def.name))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(format!(
                    "{}：该站点未开放 one-api 风格账单接口，无法自动查询余额，建议使用「手动余额」。{}",
                    explain_status(status.as_u16(), &text, def.name),
                    ""
                ));
            }
            let sub: Value = serde_json::from_str(&text)
                .map_err(|e| format!("解析账单接口返回失败：{e}"))?;
            let hard_limit = num_at(&sub, &["hard_limit_usd"])
                .or_else(|| num_at(&sub, &["system_hard_limit_usd"]))
                .ok_or_else(|| "账单接口返回中没有 hard_limit_usd 字段，无法计算余额".to_string())?;

            let today = Local::now().format("%Y-%m-%d").to_string();
            let usage_url = format!(
                "{}?start_date={}&end_date={}",
                join(base, "/dashboard/billing/usage"),
                today,
                today
            );
            let mut total = hard_limit;
            let mut amounts = Vec::new();
            let mut usage_ok = false;
            if let Ok(r2) = client.get(&usage_url).bearer_auth(key).send().await {
                if r2.status().is_success() {
                    if let Ok(v2) = r2.json::<Value>().await {
                        if let Some(cents) = num_at(&v2, &["total_usage"]) {
                            total = hard_limit - cents / 100.0;
                            usage_ok = true;
                        }
                    }
                }
            }
            amounts.push(BalanceAmount { label: "额度上限".into(), value: hard_limit, kind: "total".into() });
            if usage_ok {
                amounts.push(BalanceAmount {
                    label: "已用额度".into(),
                    value: hard_limit - total,
                    kind: "used".into(),
                });
            }
            Ok(Balance {
                currency: "USD".into(),
                total: Some(total),
                source: "api".into(),
                amounts,
                usable: Some(total > 0.0),
                note: Some(if usage_ok {
                    "按 one-api 账单接口估算：额度上限 − 已用额度".into()
                } else {
                    "仅取到额度上限，未能读取已用额度（用量接口不可用）".into()
                }),
                raw: Some(sub),
            })
        }
        BalanceProbe::ZhipuAccount => {
            // 智谱的账户报表接口在 open.bigmodel.cn 的 /api/biz/ 前缀下，不在推理用的
            // /api/paas/v4 里，中转站也没有这个接口，所以固定打官方地址、不走账户 Base URL。
            let resp = client
                .get(ZHIPU_ACCOUNT_REPORT_URL)
                .bearer_auth(key)
                .send()
                .await
                .map_err(|e| explain_net(e, def.name))?;
            let status = resp.status();
            let text = resp.text().await.unwrap_or_default();
            if !status.is_success() {
                return Err(explain_status(status.as_u16(), &text, def.name));
            }
            parse_zhipu_report(&text, def.name)
        }
        BalanceProbe::MimoConsole => Err(
            "该平台走 MiMo 控制台接口（浏览器 Cookie 查询），请在「编辑」里粘贴控制台 Cookie。".into(),
        ),
        BalanceProbe::AliyunBss => Err(
            "该平台走阿里云账单接口，需要 AccessKey，请在「编辑」里填写阿里云 AccessKey ID 与 Secret。"
                .into(),
        ),
        BalanceProbe::Unsupported(reason) => Err(reason.to_string()),
    }
}

/// 解析智谱账户报表接口的返回。
///
/// 注意两个坑（都是实测得来）：
/// 1. 鉴权失败也返回 HTTP 200，必须看 `success` 字段判断成败；
/// 2. 金额字段可能以 `0E-9` 这种科学计数法数字出现，serde_json 能正常解析成 0.0。
pub fn parse_zhipu_report(text: &str, provider: &str) -> Result<Balance, String> {
    let v: Value =
        serde_json::from_str(text).map_err(|e| format!("解析 {provider} 账户接口返回失败：{e}"))?;

    let success = v.get("success").and_then(|s| s.as_bool()).unwrap_or(false);
    if !success {
        let code = match v.get("code") {
            Some(Value::Number(n)) => n.to_string(),
            Some(Value::String(s)) => s.clone(),
            _ => String::new(),
        };
        let msg = v
            .get("msg")
            .or_else(|| v.get("message"))
            .and_then(|m| m.as_str())
            .unwrap_or("");
        return Err(match code.as_str() {
            "1001" => format!(
                "{provider} 返回 {code}：API Key 无效或未通过鉴权，请检查 Key 是否填写正确、是否被删除。{msg}"
            ),
            other => format!("{provider} 返回 {other}{msg}"),
        });
    }

    let data = v
        .get("data")
        .ok_or_else(|| format!("{provider} 账户接口返回缺少 data 字段"))?;

    let available = num_at(data, &["availableBalance"]).or_else(|| num_at(data, &["balance"]));
    if available.is_none() {
        return Err(format!(
            "{provider} 账户接口返回里没有 availableBalance 字段，接口可能已改版"
        ));
    }

    let mut amounts = Vec::new();
    if let Some(x) = num_at(data, &["rechargeAmount"]) {
        amounts.push(BalanceAmount {
            label: "累计充值".into(),
            value: x,
            kind: "total".into(),
        });
    }
    if let Some(x) = num_at(data, &["totalSpendAmount"]) {
        amounts.push(BalanceAmount {
            label: "累计消费".into(),
            value: x,
            kind: "used".into(),
        });
    }
    if let Some(x) = num_at(data, &["giveAmount"]).filter(|x| *x > 0.0) {
        amounts.push(BalanceAmount {
            label: "赠送余额".into(),
            value: x,
            kind: "granted".into(),
        });
    }
    if let Some(x) = num_at(data, &["frozenBalance"]).filter(|x| *x > 0.0) {
        amounts.push(BalanceAmount {
            label: "冻结".into(),
            value: x,
            kind: "frozen".into(),
        });
    }

    Ok(Balance {
        currency: "CNY".into(),
        total: available,
        source: "api".into(),
        amounts,
        usable: available.map(|a| a > 0.0),
        note: Some(
            "来自智谱账户报表接口（open.bigmodel.cn，官方文档未收录、实测可用）".into(),
        ),
        raw: Some(v),
    })
}

/// OpenAI 官方用量接口：读取近 30 天消费额（需要组织管理员密钥）。
/// 平台没有余额接口时，这是「其他方式」之一：拿到消费额后配合
/// 账户里的「已充值/预算总额」即可推算剩余额度。
pub async fn fetch_admin_costs(
    client: &reqwest::Client,
    def: &ProviderDef,
    base: &str,
    admin_key: &str,
) -> Result<Balance, String> {
    let start = (Local::now() - chrono::Duration::days(30)).timestamp();
    let url = format!(
        "{}?start_time={}&bucket_width=1d&limit=31",
        join(base, "/organization/costs"),
        start
    );
    let resp = client
        .get(&url)
        .bearer_auth(admin_key)
        .send()
        .await
        .map_err(|e| explain_net(e, def.name))?;
    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!(
            "{}（该用量接口需要组织管理员密钥，普通 API Key 会返回 401/403）",
            explain_status(status.as_u16(), &text, "OpenAI 用量接口")
        ));
    }
    let v: Value =
        serde_json::from_str(&text).map_err(|e| format!("解析 OpenAI 用量接口返回失败：{e}"))?;

    let mut spent = 0.0f64;
    let mut currency = "USD".to_string();
    let mut days = 0usize;
    if let Some(buckets) = get(&v, &["data"]).and_then(|d| d.as_array()) {
        for bucket in buckets {
            days += 1;
            if let Some(results) = get(bucket, &["results"]).and_then(|r| r.as_array()) {
                for item in results {
                    if let Some(amount) = item.get("amount") {
                        spent += num_at(amount, &["value"]).unwrap_or(0.0);
                        if let Some(c) = get(amount, &["currency"]).and_then(|c| c.as_str()) {
                            currency = c.to_uppercase();
                        }
                    }
                }
            }
        }
    }

    Ok(Balance {
        currency,
        // 余额本身由上层用「已充值/预算总额 − 累计消费」推算
        total: None,
        source: "costs".into(),
        amounts: vec![BalanceAmount {
            label: "近 30 天消费".into(),
            value: spent,
            kind: "spent".into(),
        }],
        usable: None,
        note: Some(format!(
            "来自 OpenAI 官方用量接口（{days} 天数据）；填写「已充值/预算总额」后可推算剩余额度"
        )),
        raw: Some(v),
    })
}

/// 拉取供应商可用模型列表
pub async fn fetch_models(
    client: &reqwest::Client,
    def: &ProviderDef,
    base: &str,
    key: &str,
) -> Result<Vec<RemoteModel>, String> {
    let url = join(base, def.models_path);
    let resp = match def.models_style {
        ModelsStyle::OpenAi => client.get(&url).bearer_auth(key).send().await,
        ModelsStyle::Anthropic => client
            .get(&url)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send()
            .await,
        ModelsStyle::Gemini => {
            client.get(format!("{url}?key={key}")).send().await
        }
    }
    .map_err(|e| explain_net(e, def.name))?;

    let status = resp.status();
    let text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(explain_status(status.as_u16(), &text, def.name));
    }
    let v: Value = serde_json::from_str(&text)
        .map_err(|e| format!("解析 {} 模型列表失败：{e}", def.name))?;

    let mut out = Vec::new();
    match def.models_style {
        ModelsStyle::OpenAi => {
            let arr = get(&v, &["data"])
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            for item in arr {
                if let Some(id) = get(&item, &["id"]).and_then(|x| x.as_str()) {
                    out.push(RemoteModel {
                        id: id.to_string(),
                        owned_by: get(&item, &["owned_by"])
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        created: get(&item, &["created"]).and_then(|x| x.as_i64()),
                        ..Default::default()
                    });
                }
            }
        }
        ModelsStyle::Anthropic => {
            let arr = get(&v, &["data"])
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            for item in arr {
                if let Some(id) = get(&item, &["id"]).and_then(|x| x.as_str()) {
                    out.push(RemoteModel {
                        id: id.to_string(),
                        owned_by: Some("anthropic".into()),
                        created: get(&item, &["created_at"]).and_then(|x| x.as_i64()),
                        description: get(&item, &["display_name"])
                            .and_then(|x| x.as_str())
                            .map(str::to_string),
                        ..Default::default()
                    });
                }
            }
        }
        ModelsStyle::Gemini => {
            let arr = get(&v, &["models"])
                .and_then(|a| a.as_array())
                .cloned()
                .unwrap_or_default();
            for item in arr {
                let name = get(&item, &["name"]).and_then(|x| x.as_str()).unwrap_or("");
                let id = name.trim_start_matches("models/").to_string();
                if id.is_empty() {
                    continue;
                }
                out.push(RemoteModel {
                    id,
                    owned_by: Some("google".into()),
                    created: None,
                    description: get(&item, &["displayName"])
                        .and_then(|x| x.as_str())
                        .map(str::to_string),
                    input_limit: get(&item, &["inputTokenLimit"]).and_then(|x| x.as_i64()),
                    output_limit: get(&item, &["outputTokenLimit"]).and_then(|x| x.as_i64()),
                });
            }
        }
    }

    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 按实测返回结构构造的样例（数字为合成值，字段名与真实接口一致）
    const REPORT_OK: &str = r#"{"code":200,"msg":"操作成功","data":{"balance":11.596398650,
        "rechargeAmount":40.000000,"giveAmount":0.000000,"totalSpendAmount":28.403601350,
        "todaySpendAmount":null,"availableBalance":11.596398650,"frozenBalance":0E-9,
        "creditBalance":null,"availableCreditBalance":null,"creditStatus":"NOT_OPEN",
        "modelSpendAmountList":null,"isKA":false},"success":true}"#;

    #[test]
    fn zhipu_report_parses_available_balance_and_breakdown() {
        let b = parse_zhipu_report(REPORT_OK, "智谱 AI（BigModel）").expect("应解析成功");
        assert_eq!(b.currency, "CNY");
        assert_eq!(b.total, Some(11.596398650));
        assert_eq!(b.source, "api");
        assert_eq!(b.usable, Some(true));
        // 冻结为 0 时不应出现在明细里，累计充值/消费应在
        let labels: Vec<&str> = b.amounts.iter().map(|a| a.label.as_str()).collect();
        assert!(labels.contains(&"累计充值"));
        assert!(labels.contains(&"累计消费"));
        assert!(!labels.contains(&"冻结"));
        assert!(!labels.contains(&"赠送余额"));
    }

    #[test]
    fn zhipu_report_auth_failure_returns_readable_error() {
        // 实测：鉴权失败也是 HTTP 200，靠 success 字段判断
        let body = r#"{"code":1001,"msg":"Header中未收到Authorization参数，无法进行身份验证。","success":false}"#;
        let err = parse_zhipu_report(body, "智谱 AI（BigModel）").unwrap_err();
        assert!(err.contains("1001"), "错误里应带状态码：{err}");
        assert!(err.contains("API Key 无效"), "错误应可读：{err}");
    }

    #[test]
    fn zhipu_report_missing_field_is_reported() {
        let body = r#"{"code":200,"msg":"ok","data":{"foo":1},"success":true}"#;
        let err = parse_zhipu_report(body, "智谱").unwrap_err();
        assert!(err.contains("availableBalance"), "{err}");
    }

    #[test]
    fn zhipu_report_non_json_is_reported() {
        assert!(parse_zhipu_report("<html>登录页</html>", "智谱").is_err());
    }
}
