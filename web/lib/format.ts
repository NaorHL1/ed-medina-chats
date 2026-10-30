export type Lang = 'he' | 'en';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Short human duration for reply times and silences: "3 min", "5 h", "12 days". */
export function formatDuration(ms: number, lang: Lang): string {
  const he = lang === 'he';
  if (ms < MINUTE) return he ? 'פחות מדקה' : 'under a minute';
  if (ms < HOUR) {
    const n = Math.round(ms / MINUTE);
    return he ? `${n} דק׳` : `${n} min`;
  }
  if (ms < 2 * DAY) {
    const n = Math.round(ms / HOUR);
    return he ? `${n} שע׳` : `${n} h`;
  }
  const n = Math.round(ms / DAY);
  return he ? `${n} ימים` : `${n} days`;
}

export function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function formatNumber(n: number, lang: Lang): string {
  return new Intl.NumberFormat(lang === 'he' ? 'he-IL' : 'en-US').format(n);
}
