import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  cairoToday, inPeriod, periodStart, pipelineBucket, weekBuckets, weekIndex,
} from './period.ts';

Deno.test('period start dates', () => {
  assertEquals(periodStart('month', '2026-09-23'), '2026-09-01');
  assertEquals(periodStart('year', '2026-09-23'), '2026-01-01');
  assertEquals(periodStart('quarter', '2026-09-23'), '2026-06-23');
  assertEquals(periodStart('quarter', '2026-02-15'), '2025-11-15'); // crosses the year
  assertEquals(periodStart('all', '2026-09-23'), null);
});

Deno.test('inPeriod counts the first day and rejects earlier ones', () => {
  assertEquals(inPeriod('2026-09-01T00:00:00Z', '2026-09-01'), true);
  assertEquals(inPeriod('2026-08-31T23:00:00Z', '2026-09-01'), false);
  assertEquals(inPeriod('2026-09-23T10:00:00Z', null), true); // all time
  assertEquals(inPeriod(null, '2026-09-01'), false);
});

Deno.test('week buckets cover 12 weeks ending today', () => {
  const weeks = weekBuckets(12, '2026-09-23');
  assertEquals(weeks.length, 12);
  assertEquals(weeks[11].start, '2026-09-23');
  assertEquals(weeks[0].start, '2026-07-08');
  assertEquals(weeks[0].label, '8 Jul');
});

Deno.test('activities land in the right week', () => {
  const weeks = weekBuckets(12, '2026-09-23');
  assertEquals(weekIndex('2026-09-23T08:00:00Z', weeks), 11); // today
  assertEquals(weekIndex('2026-09-17T08:00:00Z', weeks), 10); // last week
  assertEquals(weekIndex('2026-07-08T00:00:00Z', weeks), 0);  // first day covered
  assertEquals(weekIndex('2026-07-07T23:59:00Z', weeks), -1); // too old
});

Deno.test('unknown or blank statuses fall into Other', () => {
  assertEquals(pipelineBucket('Hot Prospect'), 'Hot Prospect');
  assertEquals(pipelineBucket('Closed Won'), 'Closed Won');
  assertEquals(pipelineBucket('Follow Up'), 'Other'); // older wording
  assertEquals(pipelineBucket(''), 'Other');
  assertEquals(pipelineBucket(null), 'Other');
});

Deno.test('today is Cairo, not UTC', () => {
  assertEquals(cairoToday(new Date('2026-09-23T22:30:00Z')), '2026-09-24');
});
