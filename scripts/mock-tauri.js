/* 浏览器内预览用的 Tauri API 桩：让前端在普通浏览器里渲染出真实界面，便于校验结构、样式与交互。
   仅用于开发期自检，不参与打包产物。
   预览悬浮卡：在 URL 上加 ?window=tray（例如 http://127.0.0.1:4174/?window=tray）。 */
(function () {
  let seq = 1;
  const callbacks = {};
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
      "控制台 Cookie",
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
      low: false,
      status: {
        balance: {
          currency: "CNY",
          total: -0.15,
          source: "console",
          amounts: [{ label: "现金余额", value: 0, kind: "cash" }],
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
      id: "kimi-k3",
      name: "Kimi K3",
      vendor: "月之暗面 Kimi",
      summary: "",
      context: 1048576,
      maxOutput: null,
      price: price("CNY", 20, 100),
      abilities: [],
      verified: true,
      verifiedAt: "2026-09-23T00:00:00+08:00",
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

  const SETTINGS = {
    autoRefresh: true,
    refreshIntervalMinutes: 30,
    notifyLowBalance: true,
    closeToTray: true,
    defaultLowThreshold: 20,
  };

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
        case "list_providers":
          return PROVIDERS;
        case "list_accounts":
        case "refresh_all":
          return ACCOUNTS;
        case "refresh_account":
          return ACCOUNTS.find((a) => a.id === (args && args.id)) || ACCOUNTS[0];
        case "get_settings":
        case "save_settings":
          return SETTINGS;
        case "model_cards":
          return CARDS;
        case "compare_prices":
          return COMPARISON;
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
        case "save_catalog_entry":
        case "reset_catalog_overrides":
        case "open_external":
        case "show_main_window":
        case "hide_popup":
          return null;
        case "resize_popup":
          (window.__resizeCalls = window.__resizeCalls || []).push(args && args.height);
          return null;
        case "app_info":
          return {
            version: "0.1.0",
            configDir: "C:\\Users\\demo\\AppData\\Roaming\\Quota",
          };
        case "plugin:event|listen":
          return 1;
        case "plugin:event|unlisten":
          return null;
        default:
          return null;
      }
    },
  };
})();
