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
