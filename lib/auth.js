import { Buffer } from 'node:buffer';

const COOKIE_NAME = 'pwt_auth';
const MAX_AGE_DAYS = 30;

function expectedCookie() {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return Buffer.from(pw).toString('base64');
}

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k] = v.join('=');
  }
  return out;
}

export function isAuthed(req) {
  const expected = expectedCookie();
  if (!expected) return false;
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] === expected;
}

export function setAuthCookie(res) {
  const value = expectedCookie();
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}
