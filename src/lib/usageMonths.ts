/** Local calendar months; subscription periods are managed independently. */
export function monthKey(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(month: string) {
  if (!/^(?:19|[2-9]\d)\d{2}-(?:0[1-9]|1[0-2])$/.test(month)) return null;
  const [year, index] = month.split("-").map(Number);
  const last = new Date(year, index, 0).getDate();
  return { from: `${month}-01`, to: `${month}-${last}` };
}

export function shiftMonth(month: string, offset: number) {
  if (!monthRange(month)) return null;
  const [year, index] = month.split("-").map(Number);
  const next = monthKey(new Date(year, index - 1 + offset, 1));
  return monthRange(next) ? next : null;
}

export function monthLabel(month: string) {
  const [year, index] = month.split("-").map(Number);
  return `${year} 年 ${index} 月`;
}

/** Restore only applied, valid filters; malformed preferences fall back to this month. */
export function restoreUsageRange(raw: string | null, now = new Date()) {
  const fallback = { ...monthRange(monthKey(now))!, mode: 'month' };
  try {
    const saved = JSON.parse(raw ?? 'null');
    if (saved?.mode === 'all') return { from: '1900-01-01', to: '9999-12-31', mode: 'all' };
    const validDay = (value: unknown): value is string => {
      if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
      const month = monthRange(value.slice(0, 7));
      return !!month && value >= month.from && value <= month.to;
    };
    if (saved?.mode === 'custom' && validDay(saved.from) && validDay(saved.to) && saved.from <= saved.to)
      return { from: saved.from, to: saved.to, mode: 'custom' };
    if (saved?.mode === 'month' || saved?.mode == null) {
      const month = typeof saved?.from === 'string' ? monthRange(saved.from.slice(0, 7)) : null;
      if (month) return { ...month, mode: 'month' };
    }
  } catch { /* Local preferences never prevent opening usage. */ }
  return fallback;
}
