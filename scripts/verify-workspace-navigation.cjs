// Exercise the production frontend with the preview bridge and controllable IPC delays.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.QUOTA_PLAYWRIGHT_MODULE || 'playwright');
const base = process.env.QUOTA_PREVIEW_URL || 'http://127.0.0.1:4187/';
const out = path.resolve(process.env.QUOTA_UI_OUTPUT || 'target/workspace-navigation');

function instrumentBridge() {
  const ipc = window.__TAURI_INTERNALS__;
  const invoke = ipc.invoke.bind(ipc);
  const stats = {};
  const gates = {};
  const failures = {};
  window.probe = {
    stats, gates, failures,
    hold(command) { gates[command] = Promise.withResolvers(); },
  };
  ipc.invoke = async (command, args) => {
    const row = stats[command] ??= { count: 0, active: 0, peak: 0 };
    row.count++;
    row.peak = Math.max(row.peak, ++row.active);
    try {
      if (gates[command]) await gates[command].promise;
      if (failures[command]) { delete failures[command]; throw Error('合成读取或保存故障'); }
      const result = await invoke(command, args);
      return command === 'app_info' ? { ...result, storageIssues: ['合成配置目录提示'] } : result;
    } finally { row.active--; }
  };
}

async function main() {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ executablePath: process.env.QUOTA_BROWSER_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  const checks = [], errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 }, locale: 'zh-CN' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(url => url.pathname === '/', async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('</head>', '<script>(' + instrumentBridge.toString() + ')()</script></head>');
      await route.fulfill({ response, body: html });
    });
    const go = name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click();
    const section = name => page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name, exact: true });
    const button = name => page.getByRole('button', { name, exact: true });
    const emit = (count = 1) => page.evaluate(count => Promise.all(Array.from({ length: count }, () =>
      window.__TAURI_INTERNALS__.invoke('plugin:event|emit', { event: 'activity-updated' }))), count);
    const count = cmd => page.evaluate(cmd => window.probe.stats[cmd]?.count ?? 0, cmd);
    const hold = cmd => page.evaluate(cmd => window.probe.hold(cmd), cmd);
    const release = cmd => page.evaluate(cmd => { window.probe.gates[cmd].resolve(); delete window.probe.gates[cmd]; }, cmd);
    const idle = cmd => page.waitForFunction(cmd => window.probe.stats[cmd]?.active === 0, cmd);

    await page.goto(new URL('?activityCase=workspace', base).href);
    await go('设置');
    await page.locator('.appearance-settings').waitFor();
    for (const cmd of ['get_activity_workspace', 'get_sync_overview', 'get_account_sync_status', 'get_activity_readers']) assert.equal(await count(cmd), 0, cmd);
    await page.locator('.workspace-sync').click();
    await page.locator('.cross-device-sync').waitFor();
    assert.equal(await section('同步与备份').getAttribute('aria-current'), 'page');
    await idle('get_sync_overview');
    await section('采集来源').click();
    await button('＋ 添加环境').click();
    await page.getByLabel('环境连接目标', { exact: true }).fill('draft-machine');
    await page.locator('.workspace-sync').click();
    await section('采集来源').click();
    assert.equal(await page.getByLabel('环境连接目标', { exact: true }).inputValue(), 'draft-machine');
    await button('查看配置目录').click();
    assert.equal(await section('关于与安全').getAttribute('aria-current'), 'page');
    await go('输出速度');
    await button('统计说明').click();
    await button('采集设置').click();
    await page.locator('.activity-source-workspace').waitFor();
    assert.equal(await section('采集来源').getAttribute('aria-current'), 'page');
    checks.push('首次进入外观跳过四项隐藏读取，快捷入口定位分类，切换分类保留草稿');

    await section('外观与窗口').click();
    const tray = button('关闭到托盘'), badge = button('托盘角标');
    const oldTray = await tray.getAttribute('aria-pressed'), oldBadge = await badge.getAttribute('aria-pressed');
    await hold('save_settings');
    await page.evaluate(() => { window.probe.failures.save_settings = true; });
    await tray.click();
    await badge.click();
    assert.notEqual(await tray.getAttribute('aria-pressed'), oldTray);
    assert.notEqual(await badge.getAttribute('aria-pressed'), oldBadge);
    assert.equal(await count('save_settings'), 1);
    await release('save_settings');
    await page.waitForFunction(() => window.probe.stats.save_settings.count === 2 && window.probe.stats.save_settings.active === 0);
    const saved = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_settings'));
    assert.equal(String(saved.closeToTray), oldTray);
    assert.notEqual(String(saved.trayAlert), oldBadge);
    assert.equal(await tray.getAttribute('aria-pressed'), oldTray);
    assert.equal(await page.evaluate(() => window.probe.stats.save_settings.peak), 1);
    checks.push('快速连改两项设置，第一项写入失败后第二项仍正确保存');

    await go('Token 活动');
    const total = page.locator('.activity-summary-primary b');
    await page.waitForFunction(() => document.querySelector('.activity-summary-primary b')?.getAttribute('title') === '76,000');
    const initial = await count('get_activity');
    await hold('get_activity');
    await emit();
    await page.waitForFunction(() => window.probe.stats.get_activity.active === 1);
    await emit(8);
    assert.equal(await count('get_activity'), initial + 1);
    await release('get_activity');
    await page.waitForFunction(n => window.probe.stats.get_activity.count === n && window.probe.stats.get_activity.active === 0, initial + 2);
    await hold('get_activity');
    await emit();
    const software = page.getByLabel('统计软件', { exact: true });
    await software.selectOption('codex');
    await software.selectOption('claude');
    await emit();
    assert.equal(await count('get_activity'), initial + 3);
    await release('get_activity');
    await page.waitForFunction(() => document.querySelector('.activity-summary-primary b')?.getAttribute('title') === '1,000');
    assert.equal(await count('get_activity'), initial + 4);
    assert.equal(await page.evaluate(() => window.probe.stats.get_activity.peak), 1);
    await page.evaluate(() => { window.probe.failures.get_activity = true; });
    await emit();
    await page.getByText('统计读取未完成', { exact: true }).waitFor();
    assert.equal(await total.getAttribute('title'), '1,000');
    await button('重试读取').click();
    await page.getByText('统计读取未完成', { exact: true }).waitFor({ state: 'detached' });
    const beforeHide = await count('get_activity');
    await page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await emit(3);
    assert.equal(await count('get_activity'), beforeHide);
    await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(n => window.probe.stats.get_activity.count === n && window.probe.stats.get_activity.active === 0, beforeHide + 1);
    checks.push('事件连发只补读一次，连续筛选最多一个在途读取，失败保留同范围结果，恢复显示时补读');
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(out, 'checks.json'), JSON.stringify({ checks, errors }, null, 2));
    console.log(checks.map(value => 'PASS ' + value).join('\n'));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
