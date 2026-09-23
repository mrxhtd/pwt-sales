// Pure helpers behind the quotation barcode. Kept apart from index.ts so they
// can be imported by tests without starting a server.

// Location numbers are part of every barcode already pasted into a document, so
// they are permanent: never renumber an entry, only append new ones. Keep the
// labels in step with LOCATION_OPTIONS in index.html.
export const LOCATION_CODES: Record<string, number> = {
  'alexandria': 1,
  'borg el arab': 2,
  'al amryah': 3,
  'el sadat': 4,
  'october': 5,
  'north coast': 6,
  'obour': 7,
  '10th ramadan': 8,
};
export const OTHER_LOCATION_CODE = 99;

/** 0 means "no location set" — the caller refuses to make a quotation then. */
export function locationCode(location: string): number {
  const key = (location || '').trim().toLowerCase();
  if (!key) return 0;
  return LOCATION_CODES[key] ?? OTHER_LOCATION_CODE;
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * Today in Cairo — the barcode date must match the day the engineer sees, not
 * the UTC day the edge function happens to run in.
 */
export function cairoToday(now: Date = new Date()): { iso: string; yymmdd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const [y, m, d] = [get('year'), get('month'), get('day')];
  return { iso: `${y}-${m}-${d}`, yymmdd: `${y.slice(2)}${m}${d}` };
}

export interface BarcodeParts {
  engineer_code: number;
  location_code: number;
  issued_on: string; // YYYY-MM-DD
  number: number;
}

/** engineer(2) + location(2) + date YYMMDD(6) + number(5) + version(2) */
export function buildBarcode(q: BarcodeParts, version: number): string {
  const [y, m, d] = q.issued_on.split('-');
  return pad(q.engineer_code, 2) + pad(q.location_code, 2) +
    `${y.slice(2)}${m}${d}` + pad(q.number, 5) + pad(version, 2);
}

/** '' clears the link; null means the input was rejected. */
export function cleanDriveUrl(raw: unknown): string | null {
  const url = String(raw ?? '').trim().slice(0, 1000);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return url;
}
