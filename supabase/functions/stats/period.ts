// Pure date/bucket helpers for the admin charts. Separate from index.ts so the
// tests can import them without starting a server.

export type Period = 'month' | 'quarter' | 'year' | 'all';

/** Today in Cairo as YYYY-MM-DD — the team works to Egyptian dates, not UTC. */
export function cairoToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

/**
 * First day the period covers, as YYYY-MM-DD. 'all' has no start.
 *   month   → the 1st of the current month
 *   quarter → the same day three months back
 *   year    → 1 January
 */
export function periodStart(period: Period, today: string = cairoToday()): string | null {
  const [y, m, d] = today.split('-').map(Number);
  if (period === 'all') return null;
  if (period === 'month') return `${y}-${String(m).padStart(2, '0')}-01`;
  if (period === 'year') return `${y}-01-01`;
  const start = new Date(Date.UTC(y, m - 1 - 3, d));
  return start.toISOString().slice(0, 10);
}

/** true when an ISO timestamp/date falls on or after the period start. */
export function inPeriod(stamp: string | null | undefined, from: string | null): boolean {
  if (!from) return true;
  if (!stamp) return false;
  return stamp.slice(0, 10) >= from;
}

export interface Week { start: string; label: string }

/** The last `count` weeks, oldest first, each starting `start` (inclusive). */
export function weekBuckets(count = 12, today: string = cairoToday()): Week[] {
  const [y, m, d] = today.split('-').map(Number);
  const end = Date.UTC(y, m - 1, d);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const weeks: Week[] = [];
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(end - i * 7 * 86400000);
    weeks.push({
      start: start.toISOString().slice(0, 10),
      label: `${start.getUTCDate()} ${months[start.getUTCMonth()]}`,
    });
  }
  return weeks;
}

/** Index of the week a timestamp belongs to, or -1 when it is older/newer. */
export function weekIndex(stamp: string, weeks: Week[]): number {
  const day = (stamp || '').slice(0, 10);
  if (!day || day < weeks[0].start) return -1;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (day >= weeks[i].start) return i;
  }
  return -1;
}

// The statuses the app offers today. Anything else (older wording such as
// 'Follow Up' or a blank status) is counted under 'Other' so no lead vanishes.
export const PIPELINE_STATUSES = [
  'Potential Prospect', 'Qualified Prospect', 'Interested Prospect',
  'Hot Prospect', 'Closed Won', 'Lost', 'Other',
];

export function pipelineBucket(status: string | null | undefined): string {
  const s = (status || '').trim();
  return PIPELINE_STATUSES.includes(s) && s !== 'Other' ? s : 'Other';
}
