// Relative time in Chinese (刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD) from a
// millisecond epoch. Shared by the notifications feed, the 共读 live feed, group
// discussions, thread replies, comments, DMs, and reading summaries — anywhere a
// stored created_at is shown as "time ago". Pass a number of ms; 0/undefined → 刚刚.
export function relTime(ms: number): string {
  const d = Date.now() - Number(ms || 0);
  if (d < 60_000) return "刚刚";
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 7 * 86_400_000) return `${Math.floor(d / 86_400_000)} 天前`;
  return new Date(Number(ms)).toISOString().slice(0, 10);
}
