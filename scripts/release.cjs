// Promote an existing, validated two-platform draft. Never replace published assets.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const windowsAlias = 'Quota-Windows-x64-setup.exe';
const macAlias = 'Quota-macOS-AppleSilicon.dmg';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function versionInfo(directory = root) {
  const read = name => fs.readFileSync(path.join(directory, name), 'utf8');
  const pkg = JSON.parse(read('package.json')).version;
  const lock = JSON.parse(read('package-lock.json'));
  const versions = [lock.version, lock.packages[''].version,
    JSON.parse(read('src-tauri/tauri.conf.json')).version,
    read('src-tauri/Cargo.toml').match(/\[package\][\s\S]*?version = "([^"]+)"/)[1],
    read('src-tauri/Cargo.lock').match(/name = "quota"\r?\nversion = "([^"]+)"/)[1]];
  if (!/^\d+\.\d+\.(0|[1-9]\d{0,3})$/.test(pkg) || versions.some(value => value !== pkg)) throw Error('npm / Cargo / Tauri versions do not match');
  const [major, minor, patch] = pkg.split('.');
  return { package: pkg, display: `${major}.${minor}.${patch.padStart(4, '0')}` };
}
function validateBinary(name, bytes) {
  if (bytes.length < 1024) throw Error(`Installer too small: ${name}`);
  if (name.endsWith('.exe') && bytes.subarray(0, 2).toString() !== 'MZ') throw Error(`Not a Windows executable: ${name}`);
  if (name.endsWith('.dmg') && bytes.subarray(bytes.length - 512, bytes.length - 508).toString() !== 'koly') throw Error(`Not a UDIF disk image: ${name}`);
}
function stage({ directory, version, sourceCommit, releaseId, windows, macos }) {
  if (!/^\d+\.\d+\.\d{4}$/.test(version) || !/^[a-f0-9]{40}$/.test(sourceCommit)) throw Error('Invalid release version or source commit');
  if (fs.existsSync(directory) && fs.readdirSync(directory).length) throw Error('Output directory must be empty');
  validateBinary('windows.exe', windows); validateBinary('macos.dmg', macos);
  const entries = [[`Quota_${version}_x64-setup.exe`, windows], [`Quota_${version}_aarch64.dmg`, macos], [windowsAlias, windows], [macAlias, macos]];
  const files = entries.map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: digest(bytes) }));
  fs.mkdirSync(directory, { recursive: true });
  for (const [name, bytes] of entries) fs.writeFileSync(path.join(directory, name), bytes);
  const manifest = { schema: 1, version, sourceCommit, releaseId, files };
  const manifestBytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  fs.writeFileSync(path.join(directory, 'release-manifest.json'), manifestBytes);
  const checks = [...files, { name: 'release-manifest.json', sha256: digest(manifestBytes) }];
  fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), checks.map(file => `${file.sha256}  ${file.name}\n`).join(''));
  return manifest;
}
function verify(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'release-manifest.json'), 'utf8'));
  const expectedNames = [`Quota_${manifest.version}_x64-setup.exe`, `Quota_${manifest.version}_aarch64.dmg`, windowsAlias, macAlias];
  if (manifest.schema !== 1 || !/^\d+\.\d+\.\d{4}$/.test(manifest.version) || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
    || !Number.isSafeInteger(manifest.releaseId) || manifest.files.length !== 4
    || expectedNames.some(name => manifest.files.filter(file => file.name === name).length !== 1)) throw Error('Invalid release manifest');
  const checks = [];
  for (const file of manifest.files) {
    const bytes = fs.readFileSync(path.join(directory, file.name));
    validateBinary(file.name, bytes);
    if (bytes.length !== file.bytes || digest(bytes) !== file.sha256) throw Error(`Artifact changed: ${file.name}`);
    checks.push(`${file.sha256}  ${file.name}\n`);
  }
  for (const [original, alias] of [[expectedNames[0], windowsAlias], [expectedNames[1], macAlias]]) {
    if (manifest.files.find(file => file.name === original).sha256 !== manifest.files.find(file => file.name === alias).sha256) throw Error('Download alias differs from versioned file');
  }
  checks.push(`${digest(fs.readFileSync(path.join(directory, 'release-manifest.json')))}  release-manifest.json\n`);
  if (fs.readFileSync(path.join(directory, 'SHA256SUMS.txt'), 'utf8') !== checks.join('')) throw Error('Checksum list differs from manifest');
  const expected = [...expectedNames, 'release-manifest.json', 'SHA256SUMS.txt'].sort();
  if (JSON.stringify(fs.readdirSync(directory).sort()) !== JSON.stringify(expected)) throw Error('Unexpected files in release directory');
  return manifest;
}
async function main() {
  const command = process.argv[2];
  const directory = path.resolve(process.argv[3] || 'target/release-assets');
  if (command === 'verify') { console.log(JSON.stringify(verify(directory), null, 2)); return; }
  if (!['prepare', 'publish'].includes(command)) throw Error('Usage: node scripts/release.cjs prepare|verify|publish [directory]');
  const repo = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !token) throw Error('GITHUB_REPOSITORY and GH_TOKEN are required');
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  const apiRoot = `https://api.github.com/repos/${repo}`;
  async function api(endpoint, method = 'GET', payload) {
    const response = await fetch(apiRoot + endpoint, { method, headers: { ...headers, ...(payload ? { 'Content-Type': 'application/json' } : {}) }, body: payload ? JSON.stringify(payload) : undefined });
    if (!response.ok) throw Error(`GitHub ${method} ${endpoint}: ${response.status}`);
    return response.status === 204 ? null : response.json();
  }
  async function download(asset) {
    const response = await fetch(`${apiRoot}/releases/assets/${asset.id}`, { headers: { ...headers, Accept: 'application/octet-stream' } });
    if (!response.ok) throw Error(`Cannot download ${asset.name}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== asset.size || asset.digest && asset.digest !== `sha256:${digest(bytes)}`) throw Error(`GitHub asset digest mismatch: ${asset.name}`);
    return bytes;
  }
  function git(...args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); }
  function validateSource(sha) {
    if (!/^[a-f0-9]{40}$/.test(sha)) throw Error('Release source must be an exact commit SHA');
    git('merge-base', '--is-ancestor', sha, 'origin/main');
    const sourceVersion = JSON.parse(git('show', `${sha}:package.json`)).version;
    if (sourceVersion !== versionInfo().package) throw Error('Draft source version differs from main');
  }
  if (command === 'prepare') {
    const version = process.env.RELEASE_VERSION;
    if (version !== versionInfo().display) throw Error('Requested version differs from the checked-out main');
    const releases = await api('/releases?per_page=100');
    const candidates = releases.filter(release => release.draft && (release.tag_name === version || release.name === `Quota ${version}`));
    if (candidates.length !== 1) throw Error('Expected exactly one matching release draft');
    const release = candidates[0];
    const sourceCommit = release.target_commitish;
    validateSource(sourceCommit);
    const windowsName = `Quota_${version}_x64-setup.exe`, macName = `Quota_${version}_aarch64.dmg`;
    const windows = release.assets.find(asset => asset.name === windowsName), macos = release.assets.find(asset => asset.name === macName);
    if (!windows || !macos) throw Error('Both versioned installers must be uploaded before preparing a release');
    stage({ directory, version, sourceCommit, releaseId: release.id, windows: await download(windows), macos: await download(macos) });
    verify(directory);
    const baseline = releases.find(item => !item.draft && item.tag_name !== version && item.assets.some(asset => /^Quota_\d+\.\d+\.\d{4}_x64-setup\.exe$/.test(asset.name)));
    if (!baseline) throw Error('No published Windows baseline exists for the upgrade check');
    const baselineAsset = baseline.assets.find(asset => /^Quota_\d+\.\d+\.\d{4}_x64-setup\.exe$/.test(asset.name));
    const baselineBytes = await download(baselineAsset); validateBinary(baselineAsset.name, baselineBytes);
    const baselineDirectory = path.join(path.dirname(directory), 'release-baseline');
    fs.mkdirSync(baselineDirectory, { recursive: true });
    fs.writeFileSync(path.join(baselineDirectory, 'baseline-setup.exe'), baselineBytes);
    console.log(`Prepared ${version}; upgrade baseline ${baseline.tag_name}; source ${sourceCommit}`);
    return;
  }
  const manifest = verify(directory);
  if (manifest.version !== process.env.RELEASE_VERSION) throw Error('Unexpected release version');
  validateSource(manifest.sourceCommit);
  const channel = process.env.RELEASE_CHANNEL;
  if (!['draft', 'preview', 'release'].includes(channel)) throw Error('Invalid release channel');
  const release = await api(`/releases/${manifest.releaseId}`);
  if (!release.draft) throw Error('Published releases are immutable in this workflow; create a new version');
  if (release.target_commitish !== manifest.sourceCommit) throw Error('Draft source changed during validation');
  const existingTag = await fetch(`${apiRoot}/git/ref/tags/${manifest.version}`, { headers });
  if (existingTag.ok) {
    const commit = await api(`/commits/${manifest.version}`);
    if (commit.sha !== manifest.sourceCommit) throw Error('Existing release tag points to another commit');
  } else if (existingTag.status !== 404) throw Error('Cannot check release tag');
  for (const name of fs.readdirSync(directory)) {
    const bytes = fs.readFileSync(path.join(directory, name));
    const previous = release.assets.find(asset => asset.name === name);
    if (previous && previous.digest === `sha256:${digest(bytes)}` && previous.size === bytes.length) continue;
    if (previous && name !== 'SHA256SUMS.txt') throw Error(`Draft already contains different content: ${name}`);
    // Only a draft checksum index is regenerated; never overwrite an installer.
    if (previous) await api(`/releases/assets/${previous.id}`, 'DELETE');
    const response = await fetch(`https://uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encodeURIComponent(name)}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body: bytes });
    if (!response.ok) throw Error(`Cannot upload ${name}: ${response.status}`);
    const uploaded = await response.json();
    if (uploaded.size !== bytes.length || uploaded.digest !== `sha256:${digest(bytes)}`) throw Error(`Upload verification failed: ${name}`);
  }
  const base = `https://github.com/${repo}/releases/download/${manifest.version}`;
  const links = `<!-- quota-downloads:start -->\n## 下载 Quota ${manifest.version}\n\n| 平台 | 安装包 |\n| --- | --- |\n| Windows x64 | [下载安装包](${base}/${windowsAlias}) |\n| macOS Apple Silicon | [下载 DMG](${base}/${macAlias}) |\n\n[SHA-256 校验文件](${base}/SHA256SUMS.txt) · [源码与文件清单](${base}/release-manifest.json)\n\nGitHub 自动附加的 Source code 是源码压缩包，安装请使用上面的文件。Mac 为临时签名，未公证。\n<!-- quota-downloads:end -->`;
  const oldBody = (release.body || '').replace(/<!-- quota-downloads:start -->[\s\S]*?<!-- quota-downloads:end -->\s*/, '');
  const run = process.env.GITHUB_RUN_ID;
  const evidence = run ? `\n\n双平台文件校验与 Windows 覆盖升级检查：[Actions 验证](https://github.com/${repo}/actions/runs/${run})。` : '';
  const result = await api(`/releases/${release.id}`, 'PATCH', { tag_name: manifest.version, target_commitish: manifest.sourceCommit, name: `Quota ${manifest.version}`, body: `${links}\n\n${oldBody}${evidence}`, draft: channel === 'draft', prerelease: channel === 'preview', make_latest: channel === 'release' ? 'true' : 'false' });
  console.log(JSON.stringify({ url: result.html_url, draft: result.draft, prerelease: result.prerelease, tag: result.tag_name }));
}
module.exports = { stage, verify, versionInfo, validateBinary };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
