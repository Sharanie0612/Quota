// A single product version and a single NSIS installer per successful build.
const fs = require("node:fs");
const path = require("node:path");
const { run } = require("@tauri-apps/cli");
const root = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
async function main() {
  if (args[0] !== "build") return run(args, "tauri");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json")));
  const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json")));
  const config = JSON.parse(fs.readFileSync(path.join(root, "src-tauri/tauri.conf.json")));
  const cargo = fs.readFileSync(path.join(root, "src-tauri/Cargo.toml"), "utf8").match(/\[package\][\s\S]*?version = "([^"]+)"/)[1];
  const cargoLock = fs.readFileSync(path.join(root, "src-tauri/Cargo.lock"), "utf8").match(/name = "quota"\r?\nversion = "([^"]+)"/)[1];
  if (![lock.version, lock.packages[""].version, config.version, cargo, cargoLock].every(v => v === pkg.version)) throw Error("版本不一致，请同步 npm / Cargo / Tauri 的根包版本");
  const [a,b,patch] = pkg.version.split(".");
  if (!/^\d+\.\d+\.(0|[1-9]\d{0,3})$/.test(pkg.version)) throw Error("包版本无法映射为 A.B.FFBB");
  const display = `${a}.${b}.${patch.padStart(4, "0")}`;
  const bundle = path.join(root, "src-tauri/target/release/bundle/nsis");
  // Only the standard Windows release command is normalized; custom targets are left to Tauri.
  const standard = process.platform === "win32" && !args.some(a => ["--target", "--debug", "--no-bundle", "--config", "-c"].includes(a));
  const old = standard && fs.existsSync(bundle) ? fs.readdirSync(bundle).filter(n => /^Quota_.*-setup\.exe$/.test(n)) : [];
  if (old.length) {
    const archive = path.join(root, "src-tauri/target/installer-archive", new Date().toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(archive, { recursive: true });
    for (const name of old) fs.renameSync(path.join(bundle, name), path.join(archive, name));
  }
  await run(args, "tauri");
  if (standard && fs.existsSync(bundle)) {
    const installers = fs.readdirSync(bundle).filter(n => /^Quota_.*-setup\.exe$/.test(n));
    if (installers.length !== 1) throw Error(`预期一个安装包，实际 ${installers.length}`);
    const name = installers[0].replace(`_${pkg.version}_`, `_${display}_`);
    if (name === installers[0] && !name.includes(`_${display}_`)) throw Error("安装包版本与产品版本不一致");
    if (name !== installers[0]) fs.renameSync(path.join(bundle, installers[0]), path.join(bundle, name));
    console.log(`安装包：${path.join(bundle, name)}`);
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
