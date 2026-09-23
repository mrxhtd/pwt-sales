import { assertEquals, assertMatch } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { buildBarcode, cairoToday, cleanDriveUrl, locationCode } from './barcode.ts';

Deno.test('location codes are stable and case-insensitive', () => {
  assertEquals(locationCode('Alexandria'), 1);
  assertEquals(locationCode('  borg el arab '), 2);
  assertEquals(locationCode('10th Ramadan'), 8);
  assertEquals(locationCode('Sadat City'), 99); // not on the list → Other
  assertEquals(locationCode('Other'), 99);
  assertEquals(locationCode(''), 0); // no location set
});

Deno.test('barcode matches the agreed 17-digit layout', () => {
  const q = { engineer_code: 3, location_code: 1, issued_on: '2026-09-16', number: 127 };
  assertEquals(buildBarcode(q, 2), '03012609160012702');
  assertEquals(buildBarcode(q, 1).slice(-2), '01');
  assertMatch(buildBarcode(q, 7), /^[0-9]{17}$/);
  assertEquals(
    buildBarcode({ engineer_code: 99, location_code: 99, issued_on: '2026-12-31', number: 99999 }, 99),
    '99992612319999999',
  );
});

Deno.test('all versions of a quotation differ only in the last two digits', () => {
  const q = { engineer_code: 5, location_code: 8, issued_on: '2026-01-02', number: 42 };
  const v1 = buildBarcode(q, 1);
  const v12 = buildBarcode(q, 12);
  assertEquals(v1.slice(0, 15), v12.slice(0, 15));
  assertEquals(v12.slice(-2), '12');
});

Deno.test('drive links must be https', () => {
  assertEquals(cleanDriveUrl(''), '');
  assertEquals(cleanDriveUrl('  https://drive.google.com/file/d/abc '), 'https://drive.google.com/file/d/abc');
  assertEquals(cleanDriveUrl('http://drive.google.com/x'), null);
  assertEquals(cleanDriveUrl('javascript:alert(1)'), null);
  assertEquals(cleanDriveUrl('drive.google.com/x'), null);
});

Deno.test('date is taken in Cairo, not UTC', () => {
  // 22:30 UTC on 16 Sep is already 01:30 on 17 Sep in Cairo.
  const late = new Date('2026-09-16T22:30:00Z');
  assertEquals(cairoToday(late).iso, '2026-09-17');
  assertEquals(cairoToday(late).yymmdd, '260917');
});
