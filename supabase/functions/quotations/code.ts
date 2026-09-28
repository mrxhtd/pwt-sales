// Pure helpers behind the quotation code. Kept apart from index.ts so they can
// be imported by tests without starting a server.
//
// The company writes its document codes as TYPE-DATE-LOCATION-ENGINEER-NUMBER,
// e.g. the surveys' SRV-20260909-OCTO-001-32. Proposals use PRO.

export const CODE_PREFIX = 'PRO';

// Four-letter location codes. They are part of codes already pasted into
// documents, so they are permanent: never change one, only append new ones.
// Keep the labels in step with LOCATION_OPTIONS in index.html.
export const LOCATION_ABBR: Record<string, string> = {
  'alexandria': 'ALEX',
  'borg el arab': 'BORG',
  'al amryah': 'AMRY',
  'el sadat': 'SADA',
  'october': 'OCTO',
  'north coast': 'NRTH',
  'obour': 'OBOR',
  '10th ramadan': 'RAMA',
};
export const OTHER_LOCATION_ABBR = 'OTHR';

/** '' means "no location set" — the caller refuses to make a quotation then. */
export function locationAbbr(location: string): string {
  const key = (location || '').trim().toLowerCase();
  if (!key) return '';
  return LOCATION_ABBR[key] ?? OTHER_LOCATION_ABBR;
}

export const pad = (n: number, width: number) => String(n).padStart(width, '0');

/**
 * Today in Cairo — the code's date must match the day the engineer sees, not
 * the UTC day the edge function happens to run in.
 */
export function cairoToday(now: Date = new Date()): { iso: string; compact: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)!.value;
  const [y, m, d] = [get('year'), get('month'), get('day')];
  return { iso: `${y}-${m}-${d}`, compact: `${y}${m}${d}` };
}

export interface CodeParts {
  engineer_code: number;
  location_abbr: string;
  issued_on: string; // YYYY-MM-DD
  number: number;
}

/**
 * PRO-YYYYMMDD-LOC-ENG-NUMBER, with -V02, -V03 … from the second version on.
 * Version 1 carries no suffix, so a quotation that is never revised reads
 * exactly like the company's survey codes.
 */
export function buildCode(q: CodeParts, version: number): string {
  const date = q.issued_on.split('-').join('');
  const base = `${CODE_PREFIX}-${date}-${q.location_abbr}-${pad(q.engineer_code, 3)}-${q.number}`;
  return version > 1 ? `${base}-V${pad(version, 2)}` : base;
}

/** '' clears the link; null means the input was rejected. */
export function cleanDriveUrl(raw: unknown): string | null {
  const url = String(raw ?? '').trim().slice(0, 1000);
  if (!url) return '';
  if (!/^https:\/\//i.test(url)) return null;
  try { new URL(url); } catch { return null; }
  return url;
}
