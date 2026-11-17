// Read-only metrics audit. Requires node:sqlite; no credentials or message text.
const fs = require('node:fs');
const path = require('node:path');
const readline = require('node:readline');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const fields = ['input', 'cached', 'cacheWrite', 'output', 'reasoning', 'total'];
const empty = () => Object.fromEntries(fields.map(key => [key, 0]));
const source = event => event.multica ? 'multica' : event.source;
const sum = events => events.reduce((total, event) => {
  for (const key of fields) {
    const value = event.tokens[key] ?? 0;
    if (!Number.isSafeInteger(value) || value < 0 || !Number.isSafeInteger(total[key] + value))
      throw new Error('Token value exceeds exact integer range; audit stopped without changing data.');
    total[key] += value;
  }
  return total;
}, empty());
const fingerprint = event => JSON.stringify([
  event.source, event.session, event.model, event.timestamp, event.channel || '',
  ...fields.map(key => event.tokens[key] || 0),
]);
function group(events, key) {
  const buckets = new Map();
  for (const event of events) {
    const id = key(event);
    if (!buckets.has(id)) buckets.set(id, []);
    buckets.get(id).push(event);
  }
  return [...buckets].map(([key, rows]) => ({
    key, events: rows.length, sessions: new Set(rows.map(e => `${e.source}:${e.session}`)).size,
    tokens: sum(rows), legacyCodexEvents: rows.filter(e => e.source === 'codex' && !e.codexUsageVersion).length,
  })).sort((a, b) => b.tokens.total - a.tokens.total || a.key.localeCompare(b.key));
}
function logs(dir, files, depth = 0) {
  if (depth > 12 || !fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) logs(file, files, depth + 1);
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) files.add(file);
  }
}
function counters(raw) {
  const value = key => Number.isSafeInteger(raw?.[key]) && raw[key] >= 0 ? raw[key] : 0;
  const input = value('input_tokens'), output = value('output_tokens');
  return { input, output, cached: value('cached_input_tokens'), cacheWrite: value('cache_write_input_tokens'),
    reasoning: value('reasoning_output_tokens'), total: Number.isSafeInteger(raw?.total_tokens) && raw.total_tokens >= 0 ? raw.total_tokens : input + output };
}
function lastUsage(raw, cumulative) {
  if (!raw || !['input_tokens', 'output_tokens'].every(key => Number.isSafeInteger(raw[key]) && raw[key] >= 0)) return null;
  if (['cached_input_tokens', 'cache_write_input_tokens', 'reasoning_output_tokens', 'total_tokens']
    .some(key => raw[key] !== undefined && (!Number.isSafeInteger(raw[key]) || raw[key] < 0))) return null;
  const value = counters(raw);
  return value.total === value.input + value.output && value.cached <= value.input && value.reasoning <= value.output
    && ['input', 'output', 'total'].every(key => value[key] <= cumulative[key]) ? value : null;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  return value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
}
async function replay(files, stored, cutoff) {
  const observations = new Map();
  let malformed = 0, incompleteTails = 0, duplicateObservations = 0;
  for (const file of files) {
    let previous = empty(), session = '', inheritedUntil;
    const size = fs.statSync(file).size;
    if (!size) continue;
    // Ignore a partial tail, as the collector does. Never modify the source.
    const fd = fs.openSync(file, 'r');
    let completeSize = 0, end = size;
    try {
      while (end > 0 && !completeSize) {
        const start = Math.max(0, end - 65536), chunk = Buffer.alloc(end - start);
        fs.readSync(fd, chunk, 0, chunk.length, start);
        const newline = chunk.lastIndexOf(10);
        if (newline >= 0) completeSize = start + newline + 1;
        end = start;
      }
    } finally { fs.closeSync(fd); }
    if (completeSize !== size) incompleteTails++;
    if (!completeSize) continue;
    const stream = fs.createReadStream(file, { encoding: 'utf8', end: completeSize - 1 });
    const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of lines) {
      if (line.length > 32 * 1024 * 1024 || !/"(?:session_meta|token_count)"/.test(line)) continue;
      let row;
      try { row = JSON.parse(line); } catch { malformed++; continue; }
      const payload = row.payload;
      if (row.type === 'session_meta') {
        session = payload?.session_id || payload?.id || '';
        inheritedUntil = payload?.subagent_history_start_ordinal;
        continue;
      }
      const raw = payload?.info?.total_token_usage;
      if (row.type !== 'event_msg' || payload?.type !== 'token_count' || !raw) continue;
      const timestamp = Date.parse(row.timestamp), cumulative = counters(raw);
      const baseline = !previous.total || ['input', 'output', 'total'].some(key => cumulative[key] < previous[key]);
      const delta = baseline ? cumulative : Object.fromEntries(fields.map(key => [key, Math.max(0, cumulative[key] - previous[key])]));
      previous = cumulative;
      if (!session || !Number.isFinite(timestamp) || !delta.total || (Number.isInteger(row.ordinal) && row.ordinal < inheritedUntil)) continue;
      if (timestamp > cutoff) continue;
      const tokens = baseline ? lastUsage(payload.info.last_token_usage, cumulative) || delta : delta;
      const id = createHash('sha256').update(`codex:tokens:${timestamp}:${JSON.stringify(canonical(raw))}`).digest('hex');
      if (observations.has(id)) duplicateObservations++;
      // A copy can begin mid-session. Preserve the complete-file observation.
      const old = observations.get(id);
      if (!old || tokens.total > old.total) observations.set(id, tokens);
    }
  }
  const mismatches = [], matched = [], missing = [];
  for (const [id, tokens] of observations) {
    const event = stored.get(id);
    if (!event) { missing.push({ tokens }); continue; }
    matched.push(event);
    if (fields.some(key => (event.tokens[key] || 0) !== tokens[key])) {
      mismatches.push({ id: id.slice(0, 12), source: source(event), model: event.model,
        at: new Date(event.timestamp).toISOString(), stored: event.tokens, replayed: tokens,
        parserVersion: event.codexUsageVersion || 0 });
    }
  }
  return { files: files.size, observations: observations.size, duplicateObservations, malformed, incompleteTails,
    matchedEvents: matched.length, matchedStoredTokens: sum(matched), missingEvents: missing.length,
    missingTokens: sum(missing), mismatchedEvents: mismatches.length,
    storedMinusReplayed: mismatches.reduce((total, row) => total + row.stored.total - row.replayed.total, 0),
    mismatches, note: 'Only explicitly selected, still-present logs are replayed. Unmatched history is not proven correct or duplicated.' };
}
async function audit({ database, homes = [], now = Date.now(), replayUntil = now }) {
  const db = new DatabaseSync(database, { readOnly: true });
  let rows, names, cursors, integrity;
  try {
    db.exec('BEGIN');
    integrity = db.prepare('PRAGMA quick_check').all().map(row => row.quick_check);
    rows = db.prepare('SELECT body FROM metrics').all().map(row => JSON.parse(row.body));
    names = new Map(db.prepare('SELECT id,name FROM devices').all().map(row => [row.id, row.name]));
    cursors = db.prepare('SELECT path,body FROM cursors').all();
    db.exec('COMMIT');
  } finally { db.close(); }
  const inherited = rows.filter(row => row.source === 'zcode' && row.kind === 'tokens' && row.revision === 1);
  const aliases = rows.filter(row => row.source === 'zcode' && row.kind === 'tokens' && row.revision === 2);
  const events = rows.filter(row => row.kind === 'tokens'
    && !(row.source === 'zcode' && [1, 2].includes(row.revision)));
  const legacy = events.filter(row => row.source === 'codex' && !row.codexUsageVersion);
  const seen = new Map();
  for (const event of events) {
    const key = fingerprint(event);
    seen.set(key, [...(seen.get(key) || []), event]);
  }
  const duplicates = [...seen.values()].filter(list => list.length > 1);
  const crossSession = new Map();
  for (const event of events) {
    const key = fingerprint({ ...event, session: '' });
    crossSession.set(key, [...(crossSession.get(key) || []), event]);
  }
  const candidates = [...crossSession.values()].filter(list => new Set(list.map(event => event.session)).size > 1);
  const files = new Set();
  for (const home of homes) for (const name of ['sessions', 'archived_sessions', 'multica-sessions']) logs(path.join(home, name), files);
  return {
    checkedAt: new Date(now).toISOString(), integrity, records: rows.length, tokenEvents: events.length,
    scopeNote: 'Metric fingerprints do not prove all sources duplicate-free. Cross-format records require explicit source request links; missing logs remain unreviewed.',
    inheritedZcodeCorrections: inherited.length,
    supersededZcodeLegacyCorrections: aliases.length,
    totals: sum(events), bySource: group(events, source),
    byDevice: group(events, event => event.device).map(row => ({ ...row, name: names.get(row.key) || '未知设备' })),
    byModel: group(events, event => event.model),
    anomalies: { tokenSumMismatch: events.filter(e => e.tokens.total !== e.tokens.input + e.tokens.output).length,
      cachedExceedsInput: events.filter(e => e.tokens.cached > e.tokens.input).length,
      reasoningExceedsOutput: events.filter(e => e.tokens.reasoning > e.tokens.output).length,
      futureEvents: events.filter(e => e.timestamp > now).length,
      identicalMetricGroups: duplicates.length,
      identicalMetricExtraTokens: duplicates.reduce((total, list) => total + sum(list.slice(1)).total, 0) },
    possibleCrossSessionCopies: { groups: candidates.length,
      candidateExtraTokens: candidates.reduce((total, list) => total + sum(list.slice(1)).total, 0),
      bySource: group(candidates.flatMap(list => list.slice(1)), source),
      note: 'Candidates require source parent/fork evidence. Equal timestamps and amounts alone never justify removing usage.' },
    legacyCodex: { events: legacy.length, tokens: sum(legacy), byDevice: group(legacy, event => names.get(event.device) || event.device),
      note: 'Missing parser marker means unreviewed legacy data, not proof of duplication. Do not delete or zero it.' },
    codexCursors: cursors.filter(row => !/^(?:zcode:|harness:)/.test(row.path)).reduce((out, row) => {
      const cursor = JSON.parse(row.body);
      const key = `v${cursor.usage_version || 0}:${fs.existsSync(row.path) ? 'present' : 'absent'}`;
      out[key] = (out[key] || 0) + 1;
      return out;
    }, {}),
    replay: homes.length ? await replay(files, new Map(events.map(event => [event.id, event])), replayUntil) : null,
  };
}
module.exports = { audit };
if (require.main === module) {
  const args = process.argv.slice(2), homes = [];
  let database;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--db' && args[i + 1]) database = path.resolve(args[++i]);
    else if (args[i] === '--codex-home' && args[i + 1]) homes.push(path.resolve(args[++i]));
    else throw new Error('Usage: node scripts/audit-token-activity.cjs --db <activity.sqlite> [--codex-home <home>]');
  }
  if (!database) throw new Error('Specify a statistics snapshot with --db; personal data is never selected automatically.');
  audit({ database, homes }).then(report => console.log(JSON.stringify(report, null, 2))).catch(error => {
    console.error(`Activity audit failed: ${error.message}`); process.exitCode = 1;
  });
}
