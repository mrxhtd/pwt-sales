import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildCode, cairoToday, cleanDriveUrl, locationAbbr } from './code.ts';

Deno.test('location codes are four letters and case-insensitive', () => {
  assertEquals(locationAbbr('October'), 'OCTO');
  assertEquals(locationAbbr('  alexandria '), 'ALEX');
  assertEquals(locationAbbr('10th Ramadan'), 'RAMA');
  assertEquals(locationAbbr('Sadat City'), 'OTHR'); // not on the list
  assertEquals(locationAbbr('Other'), 'OTHR');
  assertEquals(locationAbbr(''), ''); // no location set
});

Deno.test('code follows the company shape, like SRV-20260909-OCTO-001-32', () => {
  const q = { engineer_code: 1, location_abbr: 'OCTO', issued_on: '2026-09-28', number: 32 };
  assertEquals(buildCode(q, 1), 'PRO-20260928-OCTO-001-32');
  assertMatch(buildCode(q, 1), /^PRO-\d{8}-[A-Z]{4}-\d{3}-\d+$/);
});

Deno.test('versions after the first carry a V suffix', () => {
  const q = { engineer_code: 3, location_abbr: 'ALEX', issued_on: '2026-09-28', number: 7 };
  assertEquals(buildCode(q, 1), 'PRO-20260928-ALEX-003-7');
  assertEquals(buildCode(q, 2), 'PRO-20260928-ALEX-003-7-V02');
  assertEquals(buildCode(q, 12), 'PRO-20260928-ALEX-003-7-V12');
  // every version of one quotation shares the part before the suffix
  assertEquals(buildCode(q, 5).startsWith(buildCode(q, 1)), true);
});

Deno.test('engineer number is padded to three digits, quotation number is not', () => {
  assertEquals(buildCode({ engineer_code: 12, location_abbr: 'OBOR', issued_on: '2026-01-02', number: 5 }, 1),
    'PRO-20260102-OBOR-012-5');
  assertEquals(buildCode({ engineer_code: 999, location_abbr: 'NRTH', issued_on: '2026-12-31', number: 1234 }, 1),
    'PRO-20261231-NRTH-999-1234');
});

Deno.test('drive links must be https', () => {
  assertEquals(cleanDriveUrl(''), '');
  assertEquals(cleanDriveUrl('  https://drive.google.com/file/d/abc '), 'https://drive.google.com/file/d/abc');
  assertEquals(cleanDriveUrl('http://drive.google.com/x'), null);
  assertEquals(cleanDriveUrl('javascript:alert(1)'), null);
});

Deno.test('date is taken in Cairo, not UTC', () => {
  const late = new Date('2026-09-28T22:30:00Z'); // already the 29th in Cairo
  assertEquals(cairoToday(late).iso, '2026-09-29');
  assertEquals(cairoToday(late).compact, '20260929');
});
