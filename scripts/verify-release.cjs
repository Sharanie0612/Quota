const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stage, verify, versionInfo } = require('./release.cjs');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quota-release-check-'));
function fixture(name) {
  const windows = Buffer.alloc(2048); windows.write('MZ');
  const macos = Buffer.alloc(2048); macos.write('koly', macos.length - 512);
  const options = { directory: path.join(temporary, name), version: '1.0.2500', sourceCommit: 'a'.repeat(40), releaseId: 123, windows, macos };
  return options;
}
try {
  const complete = fixture('complete');
  stage(complete);
  const manifest = verify(complete.directory);
  assert.equal(manifest.files.length, 4);
  assert.equal(manifest.files[0].sha256, manifest.files[2].sha256);
  assert.equal(manifest.files[1].sha256, manifest.files[3].sha256);
  const version = versionInfo();
  assert.match(version.display, /^\d+\.\d+\.\d{4}$/);
  assert.equal(Number(version.display.split('.')[2]), Number(version.package.split('.')[2]));
  assert.throws(() => stage(complete), /empty/);
  console.log('PASS paired platform files, exact aliases, version mapping and no overwrite');

  const wrong = fixture('wrong');
  wrong.windows.write('NO');
  assert.throws(() => stage(wrong), /Windows executable/);
  const wrongMac = fixture('wrong-mac'); wrongMac.macos.write('NOPE', wrongMac.macos.length - 512);
  assert.throws(() => stage(wrongMac), /UDIF/);
  assert.throws(() => stage({ ...fixture('bad-version'), version: '1.0.250' }), /Invalid release/);
  console.log('PASS invalid binary formats and incomplete display versions rejected');

  const changed = path.join(complete.directory, 'Quota-Windows-x64-setup.exe');
  const bytes = fs.readFileSync(changed); bytes[100] = 123; fs.writeFileSync(changed, bytes);
  assert.throws(() => verify(complete.directory), /Artifact changed/);
  console.log('PASS altered installer rejected before publication');

  const checks = fixture('checks'); stage(checks);
  fs.appendFileSync(path.join(checks.directory, 'SHA256SUMS.txt'), 'unexpected\n');
  assert.throws(() => verify(checks.directory), /Checksum list/);
  const extras = fixture('extras'); stage(extras);
  fs.writeFileSync(path.join(extras.directory, 'personal-config.json'), '{}');
  assert.throws(() => verify(extras.directory), /Unexpected files/);
  const traversal = fixture('traversal'); stage(traversal);
  const manifestPath = path.join(traversal.directory, 'release-manifest.json');
  const invalid = JSON.parse(fs.readFileSync(manifestPath)); invalid.files[0].name = '../outside.exe';
  fs.writeFileSync(manifestPath, JSON.stringify(invalid));
  assert.throws(() => verify(traversal.directory), /Invalid release manifest/);
  console.log('PASS checksum changes, extra files and path traversal rejected');
} finally {
  const resolved = path.resolve(temporary);
  if (!resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(resolved).startsWith('quota-release-check-')) throw Error('Unsafe temporary cleanup target');
  fs.rmSync(resolved, { recursive: true, force: true });
}
