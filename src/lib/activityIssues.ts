// Remember issue fingerprints only; never persist backend messages or secrets.
const key = "quota.activity.issues.v1";
const seen = new Set<string>();
let loaded = false;
function fingerprint(text: string) {
  let a = 2166136261, b = 5381;
  for (const char of text) { a = Math.imul(a ^ char.charCodeAt(0), 16777619); b = Math.imul(b, 33) ^ char.charCodeAt(0); }
  return `${a >>> 0}:${b >>> 0}`;
}
export function newActivityIssues(messages: string[]): number {
  if (!loaded) {
    loaded = true;
    try { const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]"); if (Array.isArray(stored)) stored.filter(x => typeof x === "string").forEach(x => seen.add(x)); } catch { /* In-memory dedup still works without storage. */ }
  }
  let count = 0;
  for (const text of new Set(messages)) {
    const id = fingerprint(text);
    if (!seen.has(id)) { seen.add(id); ++count; }
  }
  if (count) try { localStorage.setItem(key, JSON.stringify([...seen].slice(-256))); } catch { /* Storage can be disabled. */ }
  return count;
}
