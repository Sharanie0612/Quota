// Reuse release artifacts and run independent checks concurrently; never clean target.
const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const started = Date.now();
const npmCli = process.env.npm_execpath;
const env = { ...process.env, RUSTUP_TOOLCHAIN: 'stable-x86_64-pc-windows-gnu' };
function run(label, command, args, cwd = root) {
  const start = Date.now();
  console.log(`[开始] ${label}`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => {
      console.log(`[${code === 0 ? '通过' : '失败'}] ${label} (${((Date.now() - start) / 1000).toFixed(1)}s)`);
      code === 0 ? resolve() : reject(Error(`${label} 退出码 ${code}`));
    });
  });
}
function dependenciesMatch() {
  try {
    const expected = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))).packages;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
    for (const group of ['dependencies', 'devDependencies', 'optionalDependencies']) {
      const declared = manifest[group] || {};
      const locked = expected[''][group] || {};
      if (Object.keys(declared).length !== Object.keys(locked).length ||
          Object.keys(declared).some(name => declared[name] !== locked[name])) return false;
    }
    const installed = JSON.parse(fs.readFileSync(path.join(root, 'node_modules/.package-lock.json'))).packages;
    for (const [name, pkg] of Object.entries(expected)) {
      if (!name) continue;
      const actual = installed[name];
      if (!actual && pkg.optional) continue;
      if (!actual || actual.version !== pkg.version || actual.integrity !== pkg.integrity ||
          !fs.existsSync(path.join(root, name, 'package.json'))) return false;
    }
    return true;
  } catch { return false; }
}
async function main() {
  if (process.platform !== 'win32') throw Error('此入口仅用于 Windows GNU + NSIS 打包');
  if (!npmCli) throw Error('请双击 build-installer.cmd 或运行 npm run package:windows');
  if (env.CARGO_TARGET_DIR) throw Error('请清除 CARGO_TARGET_DIR 后重试，以使用项目内的标准安装包路径');
  let rustc;
  try { rustc = execFileSync('rustup', ['which', '--toolchain', env.RUSTUP_TOOLCHAIN, 'rustc'], { encoding: 'utf8', windowsHide: true }).trim(); }
  catch { throw Error('需要 rustup 和 Windows GNU 工具链；请运行 rustup toolchain install stable-x86_64-pc-windows-gnu'); }
  const toolchain = path.dirname(path.dirname(rustc));
  const gnuBin = path.join(toolchain, 'lib/rustlib/x86_64-pc-windows-gnu/bin');
  env.PATH = [path.join(toolchain, 'bin'), gnuBin, process.env.PATH].join(path.delimiter);
  // Keep Rust's linker explicit; self-contained/dlltool has no companion assembler.
  env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = path.join(gnuBin, 'self-contained/x86_64-w64-mingw32-gcc.exe');
  for (const key of Object.keys(env)) if (key !== 'PATH' && key.toUpperCase() === 'PATH') delete env[key];
  if (!fs.existsSync(env.CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER)) throw Error('缺少 rustup 自带的 GNU 链接器');
  try { execFileSync('dlltool', ['--version'], { env, stdio: 'ignore', windowsHide: true }); }
  catch { throw Error('需要 PATH 中可用的 MinGW binutils（dlltool）；链接器仍固定使用 rustup 自带版本'); }
  const running = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command', 'ConvertTo-Json -InputObject @((Get-Process quota -ErrorAction SilentlyContinue).Path) -Compress'], { encoding: 'utf8', windowsHide: true }).trim());
  const releaseExe = path.join(root, 'src-tauri/target/release/quota.exe').toLowerCase();
  if (running.some(file => file && path.resolve(file).toLowerCase() === releaseExe)) throw Error('请先退出构建产物位置正在运行的 Quota，再打包');
  const config = JSON.parse(fs.readFileSync(path.join(root, 'src-tauri/tauri.conf.json')));
  if (!fs.existsSync(path.join(root, 'src-tauri/WebView2Loader.dll')) || config.bundle?.resources?.['WebView2Loader.dll'] !== '.') throw Error('缺少 WebView2Loader.dll 或安装包资源配置');
  if (!dependenciesMatch()) await run('同步前端锁定依赖', process.execPath, [npmCli, 'ci', '--no-audit', '--no-fund']);
  else console.log('[复用] 前端依赖与 lockfile 一致');
  const checks = await Promise.allSettled([
    run('TypeScript', process.execPath, [npmCli, 'run', 'typecheck']),
    run('Rust 类型检查', 'cargo', ['check', '--locked'], path.join(root, 'src-tauri')),
    run('纯逻辑', process.execPath, ['scripts/verify-logic.cjs']),
    run('官方模型目录与比价', process.execPath, ['scripts/verify-model-registry.cjs']),
    run('SSH 来源与同步客户端分类', process.execPath, ['scripts/verify-sync-devices.cjs']),
    run('组件渲染', process.execPath, ['scripts/verify-ui-render.cjs']),
    run('悬浮窗过渡', process.execPath, ['scripts/verify-widget-motion.cjs']),
  ]);
  const failures = checks.filter(check => check.status === 'rejected');
  if (failures.length) throw Error(failures.map(check => check.reason.message).join('\n'));
  // Tauri's beforeBuildCommand builds the frontend exactly once.
  await run('Release 编译与 NSIS 打包', process.execPath, [npmCli, 'run', 'tauri', '--', 'build', '--bundles', 'nsis', '--ci']);
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json')));
  const [a, b, patch] = pkg.version.split('.');
  const installer = path.join(root, `src-tauri/target/release/bundle/nsis/Quota_${a}.${b}.${patch.padStart(4, '0')}_x64-setup.exe`);
  if (!fs.existsSync(installer)) throw Error(`未找到预期安装包：${installer}`);
  console.log(`\n[完成] 总耗时 ${((Date.now() - started) / 1000).toFixed(1)}s`);
  console.log(`安装包：${installer}`);
  console.log(`便携版：${path.join(root, 'src-tauri/target/release/quota.exe')}`);
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
