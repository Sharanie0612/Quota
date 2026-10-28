/* 浏览器内预览用的 Tauri API 桩：让前端在普通浏览器里渲染出真实界面，便于校验结构、样式与交互。
   仅用于开发期自检，不参与打包产物。
   数据仅用于界面自检。 */
(function () {
  let seq = 1;
  const callbacks = {};
  const eventHandlers = {};
  const emit = (event,payload) => {for(const [id,handler] of Object.entries(eventHandlers))if(handler.event===event)callbacks[handler.handler]?.cb({event,id:Number(id),payload});};
  let setupProgress={phase:'idle',message:'',done:false,error:null};
  let setupAttempts=0;
  let windowMaximized = false;
  let widgetOptions = {enabled:true,side:'right',heightPercent:50};
  function widgetState(expanded){for(const [id,handler] of Object.entries(eventHandlers))if(handler.event==='widget-state')callbacks[handler.handler]?.cb({event:handler.event,id:Number(id),payload:{expanded,side:widgetOptions.side}});}
  const activityCase = new URLSearchParams(location.search).get("activityCase");
  const catalogCase = new URLSearchParams(location.search).get("catalogCase");
  const modelsCase = new URLSearchParams(location.search).get("modelsCase");
  const accountCase = new URLSearchParams(location.search).get("accountCase");
  const demoSshDevices = new URLSearchParams(location.search).get("sshCase") === "multi" ? [
    {deviceId:"22222222-2222-5222-8222-222222222222",host:"ubuntu-vm",aliases:["ubuntu-vm","vm-alias"],home:"/home/work/.codex",name:"ubuntu-work",included:true},
    {deviceId:"11111111-1111-5111-8111-111111111111",host:"devbox",aliases:["devbox"],home:"/home/dev/.codex",name:"ubuntu-dev",included:true}
  ] : [];
  let activityReads = 0;
  let modelReads = 0;
  // 仅在预览中强制应用现有深色 CSS；不修改系统设置，也不参与产品构建。
  if (new URLSearchParams(location.search).get("theme") === "dark") {
    document.addEventListener("DOMContentLoaded", () => {
      const css = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules))
        .filter(rule => rule.media?.mediaText === "(prefers-color-scheme: dark)")
        .flatMap(rule => Array.from(rule.cssRules).map(child => child.cssText)).join("\n");
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
      document.documentElement.dataset.previewTheme = "dark";
    }, { once: true });
  }
  const WINDOW_LABEL =
    new URLSearchParams(location.search).get("window") ||
    (location.hash.replace("#", "") === "tray" ? "tray" : "main");

  const mode = (value, label, desc) => ({ value, label, desc });
  const STD_MODES = [
    mode("auto", "官方接口", "使用该平台的官方余额接口自动查询。"),
    mode("custom", "自定义接口", "填一个能返回余额 JSON 的地址，按刷新间隔自动取值。"),
    mode("manual", "手动余额", "只用填写的手动余额，不发起任何余额请求。"),
  ];
  const NOAPI_MODES = [
    mode("custom", "自定义接口", "填一个能返回余额 JSON 的地址，按刷新间隔自动取值。"),
    mode("manual", "手动余额", "只用填写的手动余额，不发起任何余额请求。"),
  ];
  // MiMo / MiMo 订阅：官方无查询 API，走浏览器里的小米账号 Cookie
  const CONSOLE_MODES = [
    mode(
      "console",
      "登录同步",
      "粘贴浏览器里的小米账号 Cookie，自动查余额、本月用量与套餐余量（官方没有查询 API，这是唯一能自动查的办法）。",
    ),
    ...NOAPI_MODES,
  ];

  const PROVIDERS = [
    {
      id: "deepseek",
      name: "DeepSeek 开放平台",
      vendor: "DeepSeek",
      region: "国内",
      custom: false,
      defaultBaseUrl: "https://api.deepseek.com",
      baseUrlEditable: true,
      balanceSupported: true,
      balanceNote: null,
      rechargeUrl: "https://platform.deepseek.com/top_up",
      billingUrl: "https://platform.deepseek.com/usage",
      pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
      docsUrl: "https://api-docs.deepseek.com",
      keyHint: "sk-…（DeepSeek 控制台 → API keys）",
      adminKeyHint: null,
      accessKeyHint: null,
      balanceAlternatives: [],
      balanceModes: STD_MODES,
    },
    {
      id: "moonshot",
      name: "Kimi 开放平台（Moonshot）",
      vendor: "月之暗面 Kimi",
      region: "国内",
      custom: false,
      defaultBaseUrl: "https://api.moonshot.cn/v1",
      baseUrlEditable: true,
      balanceSupported: true,
      balanceNote: null,
      rechargeUrl: "https://platform.moonshot.cn/console/account",
      billingUrl: "https://platform.moonshot.cn/console/account",
      pricingUrl: "https://platform.kimi.com/docs/pricing",
      docsUrl: "https://platform.kimi.com/docs",
      keyHint: "sk-…（Kimi 开放平台 → API Key 管理）",
      adminKeyHint: null,
      accessKeyHint: null,
      balanceAlternatives: [],
      balanceModes: STD_MODES,
    },
    {
      id: "zhipu",
      name: "智谱 GLM（BigModel）",
      vendor: "智谱 GLM",
      region: "国内",
      custom: false,
      defaultBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      baseUrlEditable: true,
      balanceSupported: true,
      balanceNote: null,
      rechargeUrl: "https://open.bigmodel.cn/finance/overview",
      billingUrl: "https://open.bigmodel.cn/finance/overview",
      pricingUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing",
      docsUrl: "https://docs.bigmodel.cn",
      keyHint: "形如 xxxx.xxxx 的 API Key",
      adminKeyHint: null,
      accessKeyHint: null,
      balanceAlternatives: ["自定义余额接口", "手动余额"],
      balanceModes: [
        mode(
          "auto",
          "官方接口",
          "调用智谱账户报表接口读取可用余额（该接口未在官方文档收录，实测可用）。",
        ),
        ...STD_MODES.slice(1),
      ],
    },
    {
      id: "mimo",
      name: "小米 MiMo 开放平台",
      vendor: "小米",
      region: "国内",
      custom: false,
      defaultBaseUrl: "https://api.xiaomimimo.com/v1",
      baseUrlEditable: true,
      balanceSupported: false,
      balanceNote:
        "小米 MiMo 开放平台没有用 API Key 查询余额的接口，余额与用量只在控制台可见。可用「自定义余额接口」接入控制台接口，或直接用「手动余额」参与低余额提醒。",
      rechargeUrl: "https://platform.xiaomimimo.com/#/console/recharge",
      billingUrl: "https://platform.xiaomimimo.com/#/console/balance",
      pricingUrl: "https://mimo.mi.com/docs/price/pay-as-you-go",
      docsUrl: "https://mimo.mi.com/docs",
      keyHint: "sk-…（小米 MiMo 开放平台 → API Keys）",
      adminKeyHint: null,
      accessKeyHint: null,
      balanceAlternatives: ["自定义余额接口", "手动余额"],
      balanceModes: CONSOLE_MODES,
    },
    {
      id: "mimo-plan",
      name: "小米 MiMo 订阅（Token Plan）",
      vendor: "小米",
      region: "国内",
      custom: false,
      defaultBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      baseUrlEditable: true,
      balanceSupported: false,
      balanceNote:
        "MiMo 订阅（Token Plan）的额度与用量只在控制台可见，没有查询接口。可用「自定义余额接口」或「手动余额」参与低余额提醒。",
      rechargeUrl: "https://platform.xiaomimimo.com/#/token-plan",
      billingUrl: "https://platform.xiaomimimo.com/#/console/usage",
      pricingUrl: "https://platform.xiaomimimo.com/token-plan",
      docsUrl: "https://mimo.mi.com/docs",
      keyHint: "tp-…（个人订阅）/ tttp…（团队订阅），在「套餐管理」页创建",
      adminKeyHint: null,
      accessKeyHint: null,
      balanceAlternatives: ["自定义余额接口", "手动余额"],
      balanceModes: CONSOLE_MODES,
    },
    {
      id: "custom",
      name: "ChatGPT 订阅（OpenAI 官方）",
      vendor: "ChatGPT",
      region: "国际",
      custom: false,
      defaultBaseUrl: "",
      baseUrlEditable: true,
      needsApiKey: false,
      balanceSupported: false,
      balanceNote:
        "ChatGPT 订阅给的是使用额度（每周 / 每 5 小时窗口的用量上限），不是可充值余额。套餐状态与续费信息点卡片上的「订阅设置」查看；要在卡片上直接显示当前剩余额度，需要用登录 Cookie 查询。",
      rechargeUrl: "https://chatgpt.com/#/settings/subscription",
      billingUrl: "https://chatgpt.com/#/settings/subscription",
      pricingUrl: "https://openai.com/chatgpt/pricing/",
      docsUrl: "https://chatgpt.com",
      keyHint: "官方 ChatGPT 订阅不需要填 API Key（它不是接口，没有密钥）",
      adminKeyHint: null,
      accessKeyHint: null,
      actionLinks: [
        { label: "订阅设置", url: "https://chatgpt.com/#/settings/subscription" },
        { label: "定价 / 升级", url: "https://openai.com/chatgpt/pricing/" },
        { label: "OpenAI 帮助中心", url: "https://help.openai.com/" },
      ],
      balanceAlternatives: ["自定义余额接口", "手动余额"],
      balanceModes: NOAPI_MODES,
    },
  ];

  const baseAccount = {
    note: null,
    lowBalanceThreshold: 20,
    manualBalance: null,
    manualCurrency: "CNY",
    customUrl: null,
    customHeaders: null,
    customJsonPath: null,
    customCurrency: null,
    customMethod: null,
    customBody: null,
    quotaTotal: null,
    hasAdminKey: false,
    hasAccessKey: false,
    needsApiKey: true,
    hasConsoleCookie: false,
    accessKeyHint: null,
    providerCustom: false,
    balanceAlternatives: [],
    actionLinks: [],
  };

  const balance = (currency, total, source, amounts, note) => ({
    currency,
    total,
    source,
    amounts,
    usable: true,
    note,
    raw: null,
  });

  const ACCOUNTS = [
    {
      ...baseAccount,
      id: "a1",
      provider: "deepseek",
      providerName: "DeepSeek 开放平台",
      providerVendor: "DeepSeek",
      providerRegion: "国内",
      label: "DeepSeek 个人号",
      balanceMode: "auto",
      hasKey: true,
      createdAt: "2026-09-01T10:00:00+08:00",
      balanceSupported: true,
      effectiveBaseUrl: "https://api.deepseek.com",
      effectiveRechargeUrl: "https://platform.deepseek.com/top_up",
      billingUrl: "https://platform.deepseek.com/usage",
      pricingUrl: "https://api-docs.deepseek.com/quick_start/pricing",
      docsUrl: "https://api-docs.deepseek.com",
      low: false,
      status: {
        balance: balance("CNY", 128.5, "api", [
          { label: "充值余额", value: 120.0, kind: "topped_up" },
          { label: "赠送余额", value: 8.5, kind: "granted" },
        ], "数据来自 DeepSeek 官方余额接口"),
        models: [{ id: "deepseek-flash" }, { id: "deepseek-v4-pro" }],
        lastChecked: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
        balanceError: null,
        modelsError: null,
      },
    },
    {
      ...baseAccount,
      id: "a2",
      provider: "moonshot",
      providerName: "Kimi 开放平台（Moonshot）",
      providerVendor: "月之暗面 Kimi",
      providerRegion: "国内",
      label: "Kimi 测试号",
      balanceMode: "auto",
      hasKey: true,
      createdAt: "2026-09-02T10:00:00+08:00",
      balanceSupported: true,
      effectiveBaseUrl: "https://api.moonshot.cn/v1",
      effectiveRechargeUrl: "https://platform.moonshot.cn/console/account",
      billingUrl: "https://platform.moonshot.cn/console/account",
      pricingUrl: "https://platform.kimi.com/docs/pricing",
      docsUrl: "https://platform.kimi.com/docs",
      low: true,
      status: {
        balance: balance("CNY", 8.2, "api", [
          { label: "现金余额", value: 3.0, kind: "cash" },
          { label: "代金券", value: 5.2, kind: "voucher" },
        ], "数据来自 Kimi 开放平台余额接口"),
        models: [{ id: "kimi-k3" }],
        lastChecked: new Date(Date.now() - 3 * 3600 * 1000).toISOString(),
        balanceError: null,
        modelsError: null,
      },
    },
    {
      ...baseAccount,
      id: "a3",
      provider: "zhipu",
      providerName: "智谱 GLM（BigModel）",
      providerVendor: "智谱 GLM",
      providerRegion: "国内",
      label: "智谱团队号",
      balanceMode: "auto",
      hasKey: true,
      createdAt: "2026-09-05T10:00:00+08:00",
      balanceSupported: true,
      effectiveBaseUrl: "https://open.bigmodel.cn/api/paas/v4",
      effectiveRechargeUrl: "https://open.bigmodel.cn/finance/overview",
      billingUrl: "https://open.bigmodel.cn/finance/overview",
      pricingUrl: "https://docs.bigmodel.cn/cn/guide/start/pricing",
      docsUrl: "https://docs.bigmodel.cn",
      low: false,
      status: {
        balance: balance("CNY", 11.6, "api", [
          { label: "累计充值", value: 40.0, kind: "total" },
          { label: "累计消费", value: 28.4, kind: "used" },
        ], "来自智谱账户报表接口（open.bigmodel.cn，官方文档未收录、实测可用）"),
        models: [{ id: "glm-5.3" }, { id: "glm-4.7-flash" }],
        lastChecked: new Date(Date.now() - 12 * 60 * 1000).toISOString(),
        balanceError: null,
        modelsError: null,
      },
    },
    {
      ...baseAccount,
      id: "a4",
      provider: "mimo",
      providerName: "小米 MiMo 开放平台",
      providerVendor: "小米",
      providerRegion: "国内",
      label: "小米 MiMo 个人号",
      balanceMode: "console",
      hasKey: true,
      hasConsoleCookie: true,
      createdAt: "2026-09-20T10:00:00+08:00",
      balanceSupported: false,
      balanceNote:
        "MiMo 的余额、本月用量与套餐余量要靠浏览器里的小米账号 Cookie 查询（官方没有查询 API）。",
      balanceAlternatives: ["控制台 Cookie：粘贴浏览器 Cookie 自动查余额/用量", "自定义余额接口", "手动余额"],
      actionLinks: [
        { label: "充值", url: "https://platform.xiaomimimo.com/#/console/recharge" },
        { label: "余额明细", url: "https://platform.xiaomimimo.com/#/console/balance" },
        { label: "本月用量", url: "https://platform.xiaomimimo.com/#/console/usage" },
      ],
      effectiveBaseUrl: "https://api.xiaomimimo.com/v1",
      effectiveRechargeUrl: "https://platform.xiaomimimo.com/#/console/recharge",
      billingUrl: "https://platform.xiaomimimo.com/#/console/balance",
      pricingUrl: "https://mimo.mi.com/docs/price/pay-as-you-go",
      docsUrl: "https://mimo.mi.com/docs",
      low: true,
      status: {
        balance: {
          currency: "CNY",
          total: -0.15,
          source: "console",
          amounts: [{ label: "充值余额", value: 0, kind: "cash" }, { label: "赠送余额", value: 0, kind: "granted" }],
          usable: false,
          note: "本月已用 5.30 亿 / 41 亿 Credits（12.9%） · Lite 套餐 · 当前期至 2026-10-23 · 自动续费已开 · 来自 MiMo 控制台接口",
          raw: null,
        },
        models: [{ id: "mimo-v2.6-pro" }, { id: "mimo-v2.6-flash" }],
        lastChecked: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        balanceError: null,
        modelsError: null,
      },
    },
    {
      ...baseAccount,
      id: "a5",
      provider: "mimo-plan",
      providerName: "小米 MiMo 订阅（Token Plan）",
      providerVendor: "小米",
      providerRegion: "国内",
      label: "MiMo 订阅",
      note: "团队订阅，月底结",
      balanceMode: "console",
      hasKey: true,
      hasConsoleCookie: true,
      createdAt: "2026-09-21T10:00:00+08:00",
      balanceSupported: false,
      balanceNote:
        "MiMo 的余额、本月用量与套餐余量要靠浏览器里的小米账号 Cookie 查询（官方没有查询 API）。",
      balanceAlternatives: ["控制台 Cookie：粘贴浏览器 Cookie 自动查余额/用量", "自定义余额接口", "手动余额"],
      actionLinks: [
        { label: "套餐管理", url: "https://platform.xiaomimimo.com/#/console/plan-manage" },
        { label: "购买 / 续订", url: "https://platform.xiaomimimo.com/#/token-plan" },
        { label: "本月用量", url: "https://platform.xiaomimimo.com/#/console/usage" },
        { label: "余额明细", url: "https://platform.xiaomimimo.com/#/console/balance" },
      ],
      effectiveBaseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
      effectiveRechargeUrl: "https://platform.xiaomimimo.com/#/token-plan",
      billingUrl: "https://platform.xiaomimimo.com/#/console/usage",
      pricingUrl: "https://platform.xiaomimimo.com/token-plan",
      docsUrl: "https://mimo.mi.com/docs",
      low: false,
      status: {
        balance: {
          currency: "CREDITS",
          total: 3569917184,
          source: "console",
          amounts: [
            { label: "套餐已用", value: 530082816, kind: "used" },
            { label: "套餐总额度", value: 4100000000, kind: "total" },
            { label: "本月已用", value: 530082816, kind: "month_used" },
            { label: "本月额度", value: 4100000000, kind: "month_limit" },
          ],
          usable: true,
          note: "Lite 套餐 · 当前期至 2026-10-23 · 自动续费已开 · 余额 CNY-0.15 · 来自 MiMo 控制台接口",
          raw: null,
        },
        models: [{ id: "mimo-v2.6-pro" }],
        lastChecked: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
        balanceError: null,
        modelsError: null,
      },
    },
    {
      ...baseAccount,
      id: "a6",
      provider: "custom",
      providerName: "ChatGPT 订阅（OpenAI 官方）",
      providerVendor: "ChatGPT",
      providerRegion: "国际",
      providerCustom: false,
      label: "ChatGPT 订阅",
      balanceMode: "manual",
      hasKey: false,
      needsApiKey: false,
      createdAt: "2026-09-22T10:00:00+08:00",
      balanceSupported: false,
      balanceNote:
        "ChatGPT 订阅给的是使用额度（每周 / 每 5 小时窗口的用量上限），不是可充值余额。套餐状态与续费信息点卡片上的「订阅设置」查看；要在卡片上直接显示当前剩余额度，需要用登录 Cookie 查询。",
      balanceAlternatives: ["自定义余额接口", "手动余额"],
      actionLinks: [
        { label: "订阅设置", url: "https://chatgpt.com/#/settings/subscription" },
        { label: "定价 / 升级", url: "https://openai.com/chatgpt/pricing/" },
        { label: "OpenAI 帮助中心", url: "https://help.openai.com/" },
      ],
      effectiveBaseUrl: "",
      effectiveRechargeUrl: "https://chatgpt.com/#/settings/subscription",
      billingUrl: "https://chatgpt.com/#/settings/subscription",
      pricingUrl: "https://openai.com/chatgpt/pricing/",
      docsUrl: "https://chatgpt.com",
      low: false,
      status: {
        balance: null,
        models: [],
        lastChecked: null,
        balanceError: null,
        modelsError: null,
      },
    },
  ];

  const price = (currency, input, output, note) => ({
    currency,
    unit: "每 1M tokens",
    input,
    output,
    note: note || null,
  });

  const CARDS = [
    {
      id: "deepseek-flash",
      name: "DeepSeek V4.1 Flash",
      vendor: "DeepSeek",
      summary: "",
      context: 1000000,
      maxOutput: 384000,
      price: price("USD", 0.3, 1.2),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
      source: "https://api-docs.deepseek.com/quick_start/pricing",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "deepseek",
      created: null,
      accountIds: ["a1"],
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek V4 Pro",
      vendor: "DeepSeek",
      summary: "",
      context: 1000000,
      maxOutput: 384000,
      price: price("USD", 1.32, 3.96),
      abilities: [],
      verified: false,
      verifiedAt: null,
      source: null,
      edited: false,
      priceConfidence: "medium",
      matchQuality: "exact",
      ownedBy: "deepseek",
      created: null,
      accountIds: ["a1"],
    },
    {
      id: "kimi-k3",
      name: "Kimi K3",
      vendor: "月之暗面 Kimi",
      summary: "",
      context: 1048576,
      maxOutput: null,
      price: price("CNY", 20, 100),
      abilities: [],
      verified: true,
      verifiedAt: "2026-03-01T00:00:00+08:00",
      source: "https://platform.kimi.com/docs/pricing",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "moonshot",
      created: null,
      accountIds: ["a2"],
    },
    {
      id: "glm-5.3",
      name: "GLM-5.3",
      vendor: "智谱 GLM",
      summary: "",
      context: 1000000,
      maxOutput: 128000,
      price: price("CNY", 8, 28),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
      source: "https://docs.bigmodel.cn/cn/guide/start/pricing",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "zhipu",
      created: null,
      accountIds: ["a3"],
    },
    {
      id: "glm-4.7-flash",
      name: "GLM-4.7-Flash",
      vendor: "智谱 GLM",
      summary: "",
      context: 200000,
      maxOutput: 128000,
      price: price("CNY", 0, 0, "官方标注免费，价格随时可能调整，以官网为准"),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
      source: "https://docs.bigmodel.cn/cn/guide/start/pricing",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "zhipu",
      created: null,
      accountIds: ["a3"],
    },
    {
      id: "mimo-v2.6-pro",
      name: "小米 MiMo V2.6 Pro",
      vendor: "小米",
      summary: "",
      context: 1000000,
      maxOutput: 131072,
      price: price("CNY", 3, 6),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
      source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "xiaomi",
      created: null,
      accountIds: ["a4", "a5"],
    },
    {
      id: "mimo-v2.6-flash",
      name: "小米 MiMo V2.6 Flash",
      vendor: "小米",
      summary: "",
      context: 1000000,
      maxOutput: 131072,
      price: price("CNY", 1, 2),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
      source: "https://mimo.mi.com/docs/price/pay-as-you-go",
      edited: false,
      priceConfidence: "high",
      matchQuality: "exact",
      ownedBy: "xiaomi",
      created: null,
      accountIds: ["a4"],
    },
  ];

  const COMPARISON = {
    modelId: "glm-4.7-flash",
    modelName: "智谱 GLM-4.7-Flash",
    provider: "zhipu",
    sources: [
      {
        name: "官方定价页（抓取）",
        kind: "official_page",
        url: "https://docs.bigmodel.cn/cn/guide/start/pricing",
        currency: "CNY",
        unit: "每 1M tokens",
        input: 0.5,
        output: 3,
        note: "页面原文：glm-4.7-flash 输入 0.5 元/百万 tokens，输出 3 元/百万 tokens",
        fetchedAt: new Date().toISOString(),
        trusted: false,
      },
    ],
    confidence: "low",
    confidenceReason: "价格来自非核实来源（页面抓取或本地手填），请对照官方定价页确认。",
    excerpts: ["glm-4.7-flash 输入 0.5 元/百万 tokens，输出 3 元/百万 tokens"],
    suggested: price("CNY", 0.5, 3, "来自「官方定价页（抓取）」"),
    warnings: [],
  };

  // 使用真实内置价格检查缓存字段，避免演示数据掩盖资料库缺失。
  let catalogPromise;
  let legacyCatalogSeeded = false;
  const catalogOverrides = new Map();
  async function modelCards() {
    catalogPromise ||= fetch("/model_catalog.json").then(r => r.json());
    const catalog = (await catalogPromise).entries;
    if (catalogCase === "legacy" && !legacyCatalogSeeded) {
      const entry = catalog.find(e => e.match.includes("kimi-k3"));
      catalogOverrides.set("kimi-k3", {...entry,name:"Kimi K3（本机资料）",summary:"本机保留的简介",edited:true,verifiedAt:"2026-03-01T00:00:00+08:00",price:{...entry.price,cachedInput:null,cacheWrite:null,cacheWriteLong:null}});
      legacyCatalogSeeded = true;
    }
    const ids = ["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6", "mimo-v2.6-pro-ultraspeed"];
    if (modelsCase === "glm-prices") ids.push("glm-5.3-flash", "glm-5.3-flashx", "glm-5-turbo", "glm-4.7", "glm-4.6", "glm-ocr");
    const cards = [...CARDS, ...ids.map(id => ({...CARDS.find(c => c.id === "kimi-k3"), id, accountIds: [id.startsWith("glm") ? "a3" : id.startsWith("kimi") ? "a2" : "a4"]}))];
    return cards.map(card => {
      const entry = catalogOverrides.get(card.id) || catalog.find(e => e.match.includes(card.id));
      return entry ? {...card, ...Object.fromEntries(["name","vendor","summary","context","maxOutput","price","abilities","verified","verifiedAt","source","edited"].map(k => [k, entry[k]]))} : card;
    });
  }

  const SETTINGS = {
    notifyRecharge: true, trayAlert: true, ladderAutoUpdate: true,
    autoRefresh: true,
    refreshIntervalMinutes: 30,
    notifyLowBalance: true,
    closeToTray: true,
    defaultLowThreshold: 20,
  };

  /** 余额历史演示数据：一个月的缓降曲线 + 一次充值反弹（t = Unix 秒） */
  const historyPoint = (daysAgo, v) => ({
    t: Math.floor(Date.now() / 1000) - Math.round(daysAgo * 86400),
    v,
  });
  const downTrend = (from, to) => {
    const points = [];
    for (let i = 0; i <= 24; i++) {
      const day = 28 - i * (28 / 24);
      let v = from + ((to - from) * i) / 24;
      if (i === 18) v += 60; // 中途充了一次值
      points.push(historyPoint(Math.max(day, 0.05), v));
    }
    return points;
  };
  const BALANCE_HISTORY = {
    a1: { points: downTrend(220, 88.4), dailyBurn: 6.4, daysLeft: 13.8 },
    a2: { points: downTrend(140, 22.7), dailyBurn: 4.1, daysLeft: 5.5 },
    a3: { points: downTrend(300, 260.2), dailyBurn: 1.4, daysLeft: 186 },
  };

  for (const p of PROVIDERS) {
    if (p.id === "custom") p.balanceModes = [mode("codex", "自动同步", "连接本机登录"), mode("manual", "手动记录", "")];
  }
  ACCOUNTS.push({ ...ACCOUNTS[0], id: "demo-chatgpt", provider: "custom", providerName: "ChatGPT 订阅", label: "ChatGPT Plus", providerVendor: "ChatGPT", needsApiKey: false, hasKey: false, balanceMode: "codex", low: false,
    actionLinks: [{label:"管理订阅",url:"https://chatgpt.com/#/settings/subscription"}],
    effectiveRechargeUrl: "https://chatgpt.com/#/settings/subscription", billingUrl: "https://chatgpt.com", status: { balance: null, subscription: { plan: "plus", windows: [{label:"5 小时额度",remaining:65,resetAt:Math.floor(Date.now()/1000)+7200},{label:"每周额度",remaining:82,resetAt:Math.floor(Date.now()/1000)+172800}] }, models: [], lastChecked: new Date().toISOString(), balanceError: null, modelsError: null }
  });
  let ladder;
  let syncCandidates = new URLSearchParams(location.search).get('accountCase') === 'sync-duplicates'
    ? [{id:'duplicate-pending',provider:'deepseek',label:'另一台设备的 DeepSeek',createdAt:'2026-10-01T00:00:00Z',pending:true}] : [];
  let syncStatus = {lastSynced:null,error:new URLSearchParams(location.search).get('syncCase') === 'error' ? '账户同步格式无效，未覆盖本机数据' : null};
  const emitAccountsUpdated = () => {
    for (const [id, handler] of Object.entries(eventHandlers)) if (handler.event === 'accounts-updated') callbacks[handler.handler]?.cb({event:handler.event,id:Number(id),payload:null});
  };
  window.demoCompleteAccountSync = () => { syncStatus = {lastSynced:new Date().toISOString(),error:null}; emitAccountsUpdated(); };
  if (["balance-error", "retry-error", "save-error"].includes(accountCase)) {
    for (const a of ACCOUNTS.filter(a => ["a1", "a5", "demo-chatgpt"].includes(a.id))) {
      a.status.balanceError = "演示：余额接口暂时不可用，请重试或使用手动记录。";
    }
  }

  // Tauri 2 unlisten calls this hook before invoking the backend stub.
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: WINDOW_LABEL },
      currentWebview: { label: WINDOW_LABEL, windowLabel: WINDOW_LABEL },
    },
    transformCallback(cb, once) {
      const id = seq++;
      callbacks[id] = { cb, once };
      return id;
    },
    unregisterCallback(id) {
      delete callbacks[id];
    },
    convertFileSrc(p) {
      return p;
    },
    async invoke(cmd, args) {
      await new Promise((r) => setTimeout(r, 60));
      switch (cmd) {
        case 'get_appearance': return window.demoAppearance ?? null;
        case 'get_output_speed': {
          if(window.demoSpeedReport)return window.demoSpeedReport;
          const models=['gpt-6.1-sol','gpt-6-astra'];
          const empty=new URLSearchParams(location.search).get('speedCase')==='empty';
          const points=empty?[]:Array.from({length:32},(_,i)=>models.map((model,j)=>({timestamp:Date.now()-((31-i)*3600000),model,outputTokens:Math.round((72+j*18+Math.sin(i/3+j)*12)*4000),durationMs:4000000,samples:20+i%7}))).flat().filter(p=>!args.model||p.model===args.model);
          return {devices:[{id:'demo-a',name:'工作电脑'},{id:'demo-b',name:'笔记本'}],models,points,summary:{average:empty?null:83.2,median:empty?null:80.4,p95:empty?null:112.7,samples:empty?0:824,outputTokens:empty?0:281303},updatedAt:Date.now()};
        }
        case 'save_appearance': window.demoAppearance=args.preferences;emit('appearance-updated',args.preferences);return null;
        case 'get_benchmarks':
        case 'refresh_benchmarks': {
          const board=await fetch('/benchmark-board.json').then(r=>r.json());
          const test=new URLSearchParams(location.search).get('benchmarkCase');
          if(test==='offline')board.sources[0].error='演示：来源暂不可用';
          if(test==='empty'){board.models=[];board.profiles=[];board.referenceCohort=[];board.rankings.forEach(r=>r.entries=[]);}
          return board;
        }
        case 'get_ai_models':
        case 'refresh_ai_models': {
          const result=await fetch('/ai-models.json').then(r=>r.json());
          if(new URLSearchParams(location.search).get('registryCase')==='offline'){
            result.sources[0].error='演示：官网暂不可用，保留上次核实价格';
            result.models.filter(m=>m.vendor===result.sources[0].vendor).forEach(m=>m.issue=result.sources[0].error);
          }
          return result;
        }
        case 'setup_info': return {version:'1.0.3001',target:'D:\\Quota',previousVersion:new URLSearchParams(location.search).get('setupCase')==='upgrade'?'1.0.2801':null,payloadBytes:16*1024*1024};
        case 'setup_status': return setupProgress;
        case 'setup_ready': return null;
        case 'setup_install': {
          window.demoSetupRequest=args.request;setupAttempts++;
          if(new URLSearchParams(location.search).get('setupCase')==='retry'&&setupAttempts===1)throw Error('Quota 正在运行。请从系统托盘退出 Quota，再点击重试安装。');
          if(!/^[A-Za-z]:[\\/].+/.test(args.request.target))throw Error('请选择本机磁盘中的完整安装文件夹');
          setupProgress={phase:'preparing',message:'正在检查安装环境',done:false,error:null};emit('setup-progress',setupProgress);
          setTimeout(()=>{setupProgress={phase:'copying',message:'正在解压并复制 Quota 文件',done:false,error:null};emit('setup-progress',setupProgress);},250);
          setTimeout(()=>{setupProgress={phase:'done',message:'Quota 已安装完成',done:true,error:null};emit('setup-progress',setupProgress);},1400);
          return null;
        }
        case 'setup_finish': window.demoSetupFinished=args.launch;return null;
        case 'get_widget_options': return {...widgetOptions};
        case 'save_widget_options': widgetOptions={...args.options};return {...widgetOptions};
        case 'get_widget_usage': {
          const test=new URLSearchParams(location.search).get('widgetCase');
          if(test==='error')throw Error('演示：统计暂不可读');
          return {today:test==='empty'?0:1234567,total:test==='empty'?0:98765432,date:'2026-10-16',updatedAt:test==='empty'?null:Date.now(),partial:test==='partial'};
        }
        case 'widget_ready': widgetState(false);return null;
        case 'set_widget_expanded': widgetState(args.expanded);return null;
        case 'move_widget': return null;
        case 'get_sync_overview': return {devices:[{id:'demo-a',name:'工作电脑'},{id:'demo-b',name:'笔记本'},...demoSshDevices.map(d=>({id:d.deviceId,name:'SSH · '+d.name}))],updatedAt:Date.now(),syncErrors:[]};
        case 'get_main_window_state': return {maximized:windowMaximized,fullscreen:false,square:windowMaximized||new URLSearchParams(location.search).get('windowCase')==='tiled'};
        case 'sync_activity_now':
        case 'sync_usage_now': return null;
        case "plugin:window|is_maximized": return windowMaximized;
        case "plugin:window|toggle_maximize": {
          windowMaximized=!windowMaximized;
          for(const [id,handler] of Object.entries(eventHandlers))if(handler.event==='main-window-state')callbacks[handler.handler]?.cb({event:handler.event,id:Number(id),payload:{maximized:windowMaximized,fullscreen:false,square:windowMaximized}});
          for(const [id,handler] of Object.entries(eventHandlers))if(handler.event==='tauri://resize')callbacks[handler.handler]?.cb({event:handler.event,id:Number(id),payload:{width:1280,height:800}});
          return null;
        }
        case "plugin:window|minimize":
        case "plugin:window|close":
        case "plugin:window|start_dragging": return null;
        case "get_vendor_costs": {
          const activity=await window.__TAURI_INTERNALS__.invoke("get_activity",{device:"",source:"without-trae",days:0,model:"",from:args.from,to:args.to});
          const expenses=window.demoVendorExpenses || [];
          const modelVendor=key=>key.startsWith("gpt")?"custom":key.toLowerCase().startsWith("glm")?"zhipu":"deepseek";
          const coveredModels={};
          for(const e of expenses.filter(e=>e.from<=args.to&&e.to>=args.from)){const models=activity.models.filter(m=>modelVendor(m.key)===e.vendor);coveredModels[e.vendor]=models;coveredModels[`${e.vendor}:${e.currency}`]=models;}
          return {expenses,coveredModels,lifetimeTokens:{input:2400000,output:320000,total:2720000,cached:1700000,cacheWrite:50000,reasoning:90000},lifetimeSessions:38,firstDate:new Date(Date.now()-29*86400000).toLocaleDateString('sv-SE'),lastDate:new Date().toLocaleDateString('sv-SE'),accounts:ACCOUNTS.map(a=>({id:a.id,vendor:a.provider==="mimo-plan"?"mimo":a.provider,label:a.label,currency:a.provider==="custom"?"USD":"CNY",cumulativeRecharge:a.provider==="zhipu"?40:null,cumulativeSpend:a.provider==="zhipu"?28.4:null,observedRecharge:null,observedSpend:null,observedFrom:null,observedTo:null,balanceRises:a.provider==="zhipu"?10:0,balanceDrops:a.provider==="zhipu"?2:0,historyFrom:1791072000,historyTo:1791849600,plan:a.provider==="custom"?"plus":null,issues:[]})),plans:[
            {id:"plus",vendor:"custom",name:"ChatGPT Plus",currency:"USD",amount:20,months:1,source:"https://learn.chatgpt.com/docs/pricing",verifiedAt:"2026-10-14",condition:"公开月费；不含税费或额外额度购买"},
            {id:"mimo-lite-cn",vendor:"mimo",name:"MiMo Lite 月付",currency:"CNY",amount:39,months:1,source:"https://mimo.mi.com/docs/zh-CN/tokenplan",verifiedAt:"2026-10-14",condition:"中国区公开月费；优惠请按实付填写"},
            {id:"glm-lite",vendor:"zhipu",name:"GLM Coding Lite",currency:"CNY",amount:118,months:1,source:"https://zcode.z.ai/cn",verifiedAt:"2026-10-14",condition:"官网月付标价；优惠请按实付填写"}
          ]};
        }
        case "save_vendor_expense": {
          const input=args.input;window.demoVendorExpenses ||= [];
          const same=(a,b)=>a.vendor===b.vendor&&a.from===b.from&&a.to===b.to&&a.currency===b.currency;
          const previous=args.previous;
          if(previous&&!window.demoVendorExpenses.some(e=>same(e,previous)&&e.subscription===previous.subscription&&e.usage===previous.usage&&e.planId===previous.planId))throw new Error('此账期已更新或删除，请重新读取');
          if(previous&&!same(previous,input)&&window.demoVendorExpenses.some(e=>same(e,input)))throw new Error('目标账期已有支出记录');
          const next=window.demoVendorExpenses.filter(e=>!same(e,previous||input));
          if(input.subscription!=null||input.usage!=null){
            if(next.some(e=>e.vendor===input.vendor&&e.currency===input.currency&&e.from<=input.to&&e.to>=input.from))throw new Error('该厂商已有重叠支出周期');
            next.push(input);
          }
          window.demoVendorExpenses=next;return null;
        }
        case "get_monthly_usage_fx": return {rates:args.months.map(month=>window.demoMonthlyRates?.[month]||{month,cnyPerUsd:7,date:'2026-09-30',source:'manual'}),error:null};
        case "save_monthly_usage_fx": window.demoMonthlyRates ||= {}; if(args.rate==null)delete window.demoMonthlyRates[args.month];else window.demoMonthlyRates[args.month]={month:args.month,cnyPerUsd:args.rate,date:new Date().toLocaleDateString('sv-SE'),source:'manual'};return null;
        case "get_activity_storage": return {bytes:51692437, files:430, legacyFiles:430, ownLegacyFiles:218,legacyCompatibility:new URLSearchParams(location.search).get("storageCase")==="legacy"};
        case "get_activity_readers": return new URLSearchParams(location.search).get("storageCase")==="legacy"?[{device:"demo-b",version:null,compressed:null}]:[{device:"demo-b",version:"1.0.1700",compressed:true}];
        case "rebuild_activity_sync": return 0;
        case "optimize_activity_storage": return {before:{bytes:51692437,files:430,legacyFiles:430,ownLegacyFiles:218},after:{bytes:28124820,files:430,legacyFiles:212,ownLegacyFiles:0},converted:218};
        case "get_usage_prices": return [[
          {aliases:["gpt-6.1-sol"],price:{currency:"USD",unit:"每百万 tokens",input:2,output:10,cachedInput:.1,cacheWrite:2.5},source:"https://openai.com/api/pricing/",verifiedAt:"2026-10-05T00:00:00Z"},
          {aliases:["glm-5.3"],price:{currency:"CNY",unit:"每百万 tokens",input:2,output:8,cachedInput:.4,cacheWrite:0},source:"https://open.bigmodel.cn/",verifiedAt:"2026-10-05T00:00:00Z"},
        ], window.demoUsageRates || {}];
        case "save_usage_calculation": {
          window.demoUsageRates ||= {}; if(args.rate)window.demoUsageRates[args.model]=args.rate;else delete window.demoUsageRates[args.model];
          window.demoUsageBills ||= {}; const scope=JSON.stringify(args.scope); window.demoUsageBills[scope] ||= {};
          if(args.bill)window.demoUsageBills[scope][args.model]=args.bill;else delete window.demoUsageBills[scope][args.model];return null;
        }
        case "get_usage_bills": return window.demoUsageBills?.[JSON.stringify(args.scope)] || {};
        case "poll_mimo_login": {
          if(accountCase === "mimo-network")throw new Error("小米登录验证超时，请检查网络后重试");
          if(accountCase === "mimo-waiting")return {state:"waiting",message:"正在等待小米登录完成…",connectionId:null};
          return {state:"connected",message:"已自动连接，保存后开始同步",connectionId:"demo-connection"};
        }
        case "get_activity": {
          const read = ++activityReads;
          if (activityCase === "loading" || (activityCase === "race" && args.source === "codex")) {
            await new Promise(resolve => setTimeout(resolve, 1800));
            document.documentElement.dataset.activityDelayedRead = "done";
          }
          if (activityCase === "error" && read === 1) throw new Error("演示：统计文件暂时不可读，请重试。");
          const tokens={input:2400000,cached:1700000,cacheWrite:50000,output:320000,reasoning:90000,total:2720000};
          const sourceFactor = ({codex:.5,zcode:.25,harness:.15,trae:.1})[args.source] ?? 1;
          const deviceWeights = demoSshDevices.length ? {"demo-a":.35,"demo-b":.25,"22222222-2222-5222-8222-222222222222":.25,"11111111-1111-5111-8111-111111111111":.15} : {"demo-a":.6,"demo-b":.4};
          const deviceFactor = deviceWeights[args.device] ?? 1;
          const factor = sourceFactor * deviceFactor * (activityCase === "empty" ? 0 : 1);
          const row=(key,f=1)=>({key,tokens:Object.fromEntries(Object.entries(tokens).map(([k,v])=>[k,Math.round(v*f*factor)])),calls:Math.round(326*f*factor),sessions:Math.round(38*f*factor)});
          const availableModels = args.source === "trae" ? [row("DeepSeek-V4-Pro-Official\u001ftrae",.5),row("glm-5.3\u001ftrae",.3),row("deepseek-v4-pro\u001fapi",.2)] : args.source && args.source!=="without-trae" ? [row(({codex:"gpt-6.1-sol",zcode:"GLM-5.3",harness:"deepseek-flash"})[args.source])] : [row("gpt-6.1-sol",.5),row("GLM-5.3",.25),row("deepseek-flash",.15),row("DeepSeek-V4-Pro-Official\u001ftrae",.05),row("glm-5.3\u001ftrae",.03),row("deepseek-v4-pro\u001fapi",.02)];
          const vendorOf={"gpt-6.1-sol":"vendor:custom","GLM-5.3":"vendor:zhipu","deepseek-flash":"vendor:deepseek","kimi-k2.6":"vendor:moonshot"};
          const models = args.model ? availableModels.filter(model => (args.model === "vendor:trae" && model.key.includes("\u001f")) || model.key === args.model || vendorOf[model.key] === args.model || (args.model === "channel:api" && model.key.endsWith("\u001fapi")) || (args.model === "channel:trae" && model.key.endsWith("\u001ftrae"))) : availableModels;
          const selectedFactor = !args.model ? 1 : tokens.total*factor ? models.reduce((sum,row)=>sum+row.tokens.total,0)/(tokens.total*factor) : 0;
          const selectedRow=(key,f=1)=>row(key,f*selectedFactor);
          let totals=selectedRow("全部");
          const count=args.days===7?7:30;
          const weights=Array.from({length:count},(_,i)=>i%6===0?0:((i*7)%13+1));
          const weightTotal=weights.reduce((a,b)=>a+b,0); const used={};
          const daily=weights.map((weight,i)=>{
            const date=new Date();date.setDate(date.getDate()-(count-1-i));
            const key=date.toLocaleDateString("sv-SE");
            const values=Object.fromEntries(Object.entries(totals.tokens).map(([name,value])=>{const amount=i===count-1?value-(used[name]||0):Math.floor(value*weight/weightTotal);used[name]=(used[name]||0)+amount;return [name,amount];}));
            return {...selectedRow(key,weight/weightTotal),tokens:values};
          });
          const selectedDays = daily.filter(row => (!args.from || row.key >= args.from) && (!args.to || row.key <= args.to));
          const rangeFactor = totals.tokens.total ? selectedDays.reduce((sum,row)=>sum+row.tokens.total,0)/totals.tokens.total : 0;
          if(args.from || args.to) { totals = selectedRow("全部",rangeFactor); for(const key of Object.keys(tokens))totals.tokens[key]=selectedDays.reduce((sum,row)=>sum+row.tokens[key],0); }
          document.documentElement.dataset.activityRead = String(read);
          return {options:window.demoActivityOptions||{deviceId:"demo-a",deviceName:"工作电脑",autoCollect:true,codexHome:"C:\\Users\\demo\\.codex",zcodeHome:"C:\\Users\\demo\\.zcode",harnessHome:"",traeHome:"",traeEnabled:false,collectIntervalSeconds:30,syncAccounts:true,codexSshDevices:demoSshDevices,syncDir:new URLSearchParams(location.search).has("storageCase") ? "D:\\demo\\QuotaSync" : ""},devices:[{id:"demo-a",name:"工作电脑"},{id:"demo-b",name:"笔记本"},...demoSshDevices.map(d=>({id:d.deviceId,name:"远程采集设备"}))],totals,models:(args.from||args.to)?models.map(row=>({...row,tokens:Object.fromEntries(Object.entries(row.tokens).map(([k,v])=>[k,Math.round(v*rangeFactor)]))})):models,availableModels,tools:[selectedRow("exec_command",.6*((args.from||args.to)?rangeFactor:1)),selectedRow("read",.4*((args.from||args.to)?rangeFactor:1))],agents:[selectedRow("主 Agent",.7*((args.from||args.to)?rangeFactor:1)),selectedRow("build",.3*((args.from||args.to)?rangeFactor:1))],byDevice:args.device?[selectedRow(args.device,(args.from||args.to)?rangeFactor:1)]:Object.entries(deviceWeights).map(([id,weight])=>selectedRow(id,weight*((args.from||args.to)?rangeFactor:1))),sources:args.source?[selectedRow(args.source,(args.from||args.to)?rangeFactor:1)]:[selectedRow("codex",.5*((args.from||args.to)?rangeFactor:1)),selectedRow("zcode",.25*((args.from||args.to)?rangeFactor:1)),selectedRow("harness",.15*((args.from||args.to)?rangeFactor:1)),selectedRow("trae",.1*((args.from||args.to)?rangeFactor:1))],channels:["trae","api"].filter(channel=>models.some(m=>m.key.endsWith("\u001f"+channel))).map(channel=>{const members=models.filter(m=>m.key.endsWith("\u001f"+channel));return {key:channel,tokens:Object.fromEntries(Object.keys(tokens).map(key=>[key,Math.round(members.reduce((sum,m)=>sum+m.tokens[key],0)*((args.from||args.to)?rangeFactor:1))])),sessions:members.reduce((sum,m)=>sum+m.sessions,0),calls:members.reduce((sum,m)=>sum+m.calls,0)};}),hourly:selectedDays.flatMap(day=>{const weights=[0,0,0,0,0,0,1,2,4,6,9,7,5,3,4,8,12,11,8,5,3,2,1,1];const sum=weights.reduce((a,b)=>a+b,0);let previous=0;return weights.map((weight,hour)=>{const next=previous+weight;const result={...day,key:day.key+"T"+String(hour).padStart(2,"0"),tokens:Object.fromEntries(Object.entries(day.tokens).map(([k,v])=>[k,Math.floor(v*next/sum)-Math.floor(v*previous/sum)]))};previous=next;return result;});}),daily:selectedDays,updatedAt:Date.now(),syncErrors:new URLSearchParams(location.search).has("usageSyncConflict")?["我的使用：custom USD 的账期 2026-10-01–2026-10-31 与 2026-10-15–2026-11-14 重叠；请在原设备调整或删除其中一条后同步，当前账期已保留"]:[],errors:activityCase==="partial"?["Harness 会话 v5 尚未适配（支持 v0–v4），未回退到旧会话；请更新 Quota"]:[]};
        }
        case "refresh_activity":
          if (activityCase === "save-error") throw new Error("演示：共享目录暂时离线。");
          return 0;
        case "discover_codex_ssh_hosts": {
          const test = new URLSearchParams(location.search).get("sshCase");
          if (test === "slow") await new Promise(resolve => setTimeout(resolve, 1200));
          if (test === "error") throw new Error("示例：SSH 配置暂时无法读取");
          return {hosts: test === "empty" ? [] : test === "multi" ? ["ubuntu-vm", "vm-alias", "devbox", "offline"] : ["ubuntu-vm"], warnings:[]};
        }
        case "identify_codex_ssh_devices": {
          const test=new URLSearchParams(location.search).get("sshCase");
          if(test==="slow")await new Promise(resolve=>setTimeout(resolve,1200));
          return args.targets.map(t=>({...t,deviceId:t.host==="offline"?"":t.host==="devbox"?"11111111-1111-5111-8111-111111111111":"22222222-2222-5222-8222-222222222222",name:t.host==="offline"?"":t.host==="devbox"?"ubuntu-dev":"ubuntu-work",error:t.host==="offline"?"SSH 连接失败：设备离线，请检查连接后重新识别。":null}));
        }
        case "get_activity_options": return window.demoActivityOptions||{deviceId:"demo-a",deviceName:"工作电脑",autoCollect:true,collectIntervalSeconds:30,syncAccounts:true,codexHome:"/demo/.codex",zcodeHome:"/demo/.zcode",harnessHome:"",traeHome:"",traeEnabled:false,codexSshDevices:demoSshDevices,syncDir:new URLSearchParams(location.search).has("storageCase") ? "D:\\demo\\QuotaSync" : ""};
        case "get_account_sync_candidates": return structuredClone(syncCandidates);
        case "resolve_account_sync": {
          const source = syncCandidates.find(row => row.id === args.sourceId);
          syncCandidates = syncCandidates.filter(row => row.id !== args.sourceId);
          if (args.targetId) { window.demoLastAssociation={sourceId:args.sourceId,targetId:args.targetId}; }
          if (source && !args.targetId && !ACCOUNTS.some(a => a.id === source.id)) ACCOUNTS.push({...structuredClone(ACCOUNTS.find(a => a.provider === source.provider)),...source});
          emitAccountsUpdated(); return null;
        }
        case "get_account_sync_status": return structuredClone(syncStatus);
        case "sync_accounts": window.demoCompleteAccountSync(); return null;
        case "save_activity_options": window.demoActivityOptions=args.input;return null;
        case "get_exchange_rate": return { cnyPerUsd: 7, date: "2026-10-02", checkedAt: new Date().toISOString(), source: "synthetic UI demo", error: "演示汇率，非实际行情" };
        case "get_ladder":
        case "refresh_ladder":
          ladder = ladder || await fetch("/ladder.json").then(r => r.json());
          return ladder;
        case "check_ladder_price": return { prices: [], excerpts: ["示例：请打开官网核对标准档价格"], checkedAt: new Date().toISOString(), error: null };
        case "adopt_ladder_price": {
          const e = ladder.entries.find(e => e.id === args.id);
          Object.assign(e.price, {input:args.input,output:args.output,currency:args.currency,cachedInput:args.cachedInput,cacheWrite:args.cacheWrite,cacheWriteLong:args.cacheWriteLong});e.verifiedAt=new Date().toISOString();return null;
        }
        case "start_mimo_login": case "cancel_mimo_login": case "discard_connection": return null;
        case "list_mimo_connections": return ACCOUNTS.filter(a => ["mimo", "mimo-plan"].includes(a.provider)).map(a => ({id:a.id,label:a.label}));
        case "reuse_mimo_connection": return "demo-connection";
        case "finish_mimo_login": case "connect_chatgpt": return "demo-connection";
        case "save_account": {
          if (accountCase === "save-error") throw new Error("演示：配置保存失败，原账户保留。");
          const p=PROVIDERS.find(p=>p.id===args.input.provider);
          const existing=ACCOUNTS.find(a=>a.id===args.input.id);
          const fields=Object.fromEntries(Object.entries(args.input).filter(([k])=>!["apiKey","consoleCookie","adminKey","accessKeyId","accessKeySecret","connectionId"].includes(k)));
          const v={...(existing||ACCOUNTS[0]),...fields,id:args.input.id||"demo-added",providerName:p.name,providerRegion:p.region,providerVendor:p.vendor,needsApiKey:p.needsApiKey,status:structuredClone(existing?.status||{balance:null,subscription:null,models:[],balanceError:null,modelsError:null})};
          if(v.balanceMode==="manual") {
            v.status.subscription=null;v.status.balanceError=null;
            v.status.balance=v.manualBalance==null?null:{total:v.manualBalance,currency:v.manualCurrency||"CNY",source:"manual",amounts:[],usable:v.manualBalance>0,note:"手动记录"};
            v.low=v.lowBalanceThreshold>0&&v.manualBalance!=null&&v.manualBalance<v.lowBalanceThreshold;
          }
          v.status.lastChecked=new Date().toISOString();
          if(existing) ACCOUNTS.splice(ACCOUNTS.indexOf(existing),1,v); else ACCOUNTS.push(v);
          return structuredClone(v);
        }
        case "list_providers":
          return PROVIDERS;
        case "list_accounts":
          return structuredClone(ACCOUNTS);
        case "refresh_all":
          if (modelsCase === "refresh-error") throw new Error("演示：账户刷新失败，保留原有数据。");
          return ACCOUNTS;
        case "refresh_account": {
          if (accountCase === "retry-error") throw new Error("演示：重试失败，保留上次余额。");
          const a=ACCOUNTS.find(a=>a.id===args.id)||ACCOUNTS[0]; a.status.balanceError=null;
          return structuredClone(a);
        }
        case "get_settings": return {...SETTINGS};
        case "save_settings": Object.assign(SETTINGS,args.settings); return {...SETTINGS};
        case "get_balance_history":
          return Object.fromEntries(Object.entries(BALANCE_HISTORY).map(([id,t])=>{
            const total=ACCOUNTS.find(a=>a.id===id)?.status.balance?.total;
            return [id,{...t,daysLeft:total!=null&&t.dailyBurn>0?Math.max(0,total/t.dailyBurn):null}];
          }));
        case "export_data":
        case "export_activity_sync":
        case "import_activity_sync":
            throw new Error("浏览器演示无法写入本机导出文件，请在 Quota 桌面应用中导出。");
        case "preview_import": return {fingerprint:"synthetic",encrypted:!!args.password,accounts:ACCOUNTS.slice(0,3).map(a=>({id:a.id,label:a.label,provider:a.provider,hasCredentials:!!args.password})),credentials:!!args.password,settings:true,catalog:true,catalogCount:2,balanceHistory:true,historyCount:12,activity:true,activityCount:42};
        case "import_data": return "演示：已导入所选内容，未选内容保留";
        case "export_backup":
            return null;
        case "model_cards": {
          const read = ++modelReads;
          if ((modelsCase === "race" || modelsCase === "race-error") && args.provider === "moonshot") {
            await new Promise(resolve => setTimeout(resolve, 1800));
            document.documentElement.dataset.modelsDelayedRead = "done";
            if (modelsCase === "race-error") throw new Error("演示：上一次 Kimi 列表读取失败。");
          }
          document.documentElement.dataset.modelsRead = String(read);
          if ((modelsCase === "error" && read === 1) || (modelsCase === "background-error" && read > 1)) throw new Error("演示：模型资料暂时不可读，请重试。");
          let cards = await modelCards();
          if (modelsCase === "compare-groups") cards = cards.map((card, index) => index < 2 ? {
            ...card, name: index ? "美元计价样本（仅验收）" : "每千 Token 计价样本（仅验收）",
            price: {...card.price, currency: index ? "USD" : "CNY", unit: index ? "每 1M tokens" : "每 1K tokens"},
            verified:false, verifiedAt:null, source:null,
          } : card);
          return modelsCase === "empty" ? [] : args.provider ? cards.filter(card => card.accountIds.some(id => ACCOUNTS.find(a => a.id === id)?.provider === args.provider)) : cards;
        }
        case "compare_prices": {
          const card = (await modelCards()).find(c => c.id === args.modelId);
          if (!card?.price) return COMPARISON;
          const source = {name:card.verified?"当前价格（已核实）":"当前价格（待核实）",kind:"catalog",url:card.source,...card.price,fetchedAt:card.verifiedAt,trusted:card.verified};
          const entry = catalogOverrides.has(card.id) ? (await catalogPromise).entries.find(e => e.match.includes(card.id)) : null;
          const builtin = entry ? {name:"内置官方资料（已核实）",kind:"builtin",url:entry.source,...entry.price,fetchedAt:entry.verifiedAt,trusted:entry.verified} : null;
          const sources = builtin ? [source,builtin] : [source];
          const priceFields = ["input","output","cachedInput","cacheWrite","cacheWriteLong"];
          const hasPrice = value => priceFields.some(key => value[key] != null);
          const suggestedSource = sources.filter(value => value.trusted && hasPrice(value)).sort((a,b) =>
            Date.parse(b.fetchedAt) - Date.parse(a.fetchedAt) || priceFields.filter(key => b[key] != null).length - priceFields.filter(key => a[key] != null).length)[0]
            || sources.find(hasPrice) || null;
          return {...COMPARISON,modelId:card.id,modelName:card.name,sources,suggested:suggestedSource,suggestedSource,excerpts:[],confidence:suggestedSource?.trusted?"medium":suggestedSource?"low":"none",confidenceReason:!suggestedSource?"当前资料没有价格字段，请打开官网核对。":!suggestedSource.trusted?"只有未核实的参考价格，请对照官网确认。":builtin?"已有官网核实记录；当前记录来自同一出处，不能算独立的交叉验证。":"只有 1 份已对照官网核实的价格记录，请注意核实日期。"};
        }
        case "save_catalog_entry":
          if (catalogCase === "write-error") throw new Error("演示：本机资料写入失败，原有资料保留。");
          for (const id of args.entry.match) catalogOverrides.set(id, {...args.entry,verifiedAt:new Date().toISOString()});
          return null;
        case "api_snippet":
          return (
            "curl https://api.deepseek.com/chat/completions \\\n" +
            '  -H "Content-Type: application/json" \\\n' +
            '  -H "Authorization: Bearer sk-示例密钥" \\\n' +
            "  -d '{\"model\":\"" + (args && args.modelId) + "\",\"messages\":[{\"role\":\"user\",\"content\":\"你好\"}],\"stream\":false}'"
          );
        case "probe_custom_balance":
          return {
            ok: true,
            value: 88.5,
            currency: "CNY",
            discovered: [
              { path: "data.available_balance", value: 88.5 },
              { path: "data.user.quota", value: 500 },
              { path: "code", value: 200 },
            ],
            rawPreview: '{\n  "code": 200,\n  "data": { "available_balance": 88.5 }\n}',
            error: null,
          };
        case "reset_catalog_overrides":
        case "open_external":
        case "show_main_window":
          return null;
        case "app_info":
          return {
            version: "1.0.3001",
            configDir: "C:\\Users\\demo\\AppData\\Roaming\\Quota",
          };
        case "plugin:event|listen": { const id = seq++; eventHandlers[id] = args; return id; }
        case "plugin:dialog|message":
          return new URLSearchParams(location.search).get("traeConnect") === "cancel" ? "Cancel" : "Ok";
        case "plugin:dialog|open":
          return new URLSearchParams(location.search).has("migrationCase") ? "D:\\demo\\Quota-migration.json" : null;
        case "plugin:event|unlisten": delete eventHandlers[args.eventId]; return null;
        default:
          return null;
      }
    },
  };
})();
