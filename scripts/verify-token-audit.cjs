// Synthetic metrics only. Verify diagnostics do not silently deduplicate or write.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { audit } = require('./audit-token-activity.cjs');

async function main() {
  const root = path.resolve('target/token-audit-checks', randomUUID());
  const home = path.join(root, 'codex'), sessions = path.join(home, 'sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const database = path.join(root, 'activity.sqlite'), now = Date.now();
  const timestamp = now - 1000;
  const raw = { cached_input_tokens: 50, input_tokens: 100, output_tokens: 20, reasoning_output_tokens: 5, total_tokens: 120 };
  const id = createHash('sha256').update(`codex:tokens:${timestamp}:${JSON.stringify(raw)}`).digest('hex');
  const tokens = { input: 100, cached: 50, cacheWrite: 0, output: 20, reasoning: 5, total: 120 };
  const event = { id, device: 'device', source: 'codex', session: 'codex-session', model: 'gpt-test',
    timestamp, tokens, kind: 'tokens', text: 'PRIVATE_DO_NOT_SAVE' };
  const zcode = (id, session, at = timestamp) => ({ ...event, id, source: 'zcode', session, model: 'GLM-test', timestamp: at });
  const db = new DatabaseSync(database);
  db.exec('CREATE TABLE metrics(id TEXT PRIMARY KEY,body TEXT); CREATE TABLE devices(id TEXT,name TEXT); CREATE TABLE cursors(path TEXT,body TEXT)');
  const insert = db.prepare('INSERT INTO metrics VALUES(?,?)');
  for (const row of [event, { ...event, id: 'same-metric-different-id' }, zcode('parent', 'parent'),
    zcode('fork', 'fork'), zcode('independent', 'independent', timestamp + 1),
    { ...zcode('suppressed', 'copied-only'), revision: 1 },
    { ...zcode('alias', 'shared-session'), revision: 2 }]) insert.run(row.id, JSON.stringify(row));
  db.prepare('INSERT INTO devices VALUES(?,?)').run('device', 'fixture');
  db.close();
  const envelope = (type, payload) => JSON.stringify({ type, payload, timestamp: new Date(timestamp).toISOString() });
  const header = envelope('session_meta', { id: 'codex-session' });
  const usage = envelope('event_msg', { type: 'token_count', info: { total_token_usage: raw, last_token_usage: raw } });
  const file = path.join(sessions, 'original.jsonl'), copy = path.join(sessions, 'copy.jsonl');
  fs.writeFileSync(file, [header, usage, usage].join('\r\n') + '\r\n');
  fs.writeFileSync(copy, [header, usage].join('\n') + '\n' + usage.slice(0, -1));
  const digest = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = [database, file, copy].map(digest);
  const result = await audit({ database, homes: [home], now });
  assert.equal(result.totals.total, 600);
  assert.equal(result.inheritedZcodeCorrections, 1);
  assert.equal(result.supersededZcodeLegacyCorrections, 1);
  assert.equal(result.anomalies.identicalMetricGroups, 1);
  assert.equal(result.possibleCrossSessionCopies.groups, 1);
  assert.equal(result.possibleCrossSessionCopies.candidateExtraTokens, 120);
  assert.equal(result.legacyCodex.events, 2);
  assert.equal(result.replay.observations, 1);
  assert.equal(result.replay.matchedEvents, 1);
  assert.equal(result.replay.duplicateObservations, 1);
  assert.equal(result.replay.incompleteTails, 1);
  assert.equal(result.replay.mismatchedEvents, 0);
  assert.equal(result.replay.missingEvents, 0);
  assert(!JSON.stringify(result).includes('PRIVATE_DO_NOT_SAVE'));
  assert.deepEqual([database, file, copy].map(digest), before);
  await assert.rejects(audit({ database: path.join(root, 'absent.sqlite') }));
  assert(!fs.existsSync(path.join(root, 'absent.sqlite')));
  console.log('PASS read-only Token audit: source/device totals, inherited correction, duplicate candidates without deletion, stable IDs, CRLF/repeated/copy/partial logs, legacy uncertainty and private-field exclusion');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
