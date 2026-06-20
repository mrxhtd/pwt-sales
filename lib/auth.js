import { Buffer } from 'node:buffer';
import crypto from 'node:crypto';
import { getSupabase } from './db.js';

const COOKIE_NAME = 'pwt_auth';
const MAX_AGE_DAYS = 30;

function parseCookies(header) {
  const out = {};
  for (const part of (header || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (!k) continue;
    try {
      out[k] = decodeURIComponent(v.join('='));
    } catch {
      out[k] = v.join('=');
    }
  }
  return out;
}

/**
 * Resolve the session token from either the HttpOnly cookie (preferred) or an
 * `Authorization: Bearer <token>` header. Supporting both lets every endpoint
 * share one session helper while the frontend transitions from localStorage
 * tokens to cookies.
 */
function getTokenFromRequest(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  if (cookies[COOKIE_NAME]) return cookies[COOKIE_NAME];
  const authHeader = req.headers['authorization'] || '';
  return authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
}

/**
 * Read the session token from cookie, look up in DB joined with engineers.
 * Returns { engineerId, fullName, role } or null.
 */
// Periodically clean expired sessions (at most once per hour per instance)
let _lastCleanup = 0;
async function maybeCleanExpired(supabase) {
  const now = Date.now();
  if (now - _lastCleanup < 60 * 60 * 1000) return;
  _lastCleanup = now;
  await supabase.from('sessions').delete().lt('expires_at', new Date().toISOString());
}

export async function getSession(req) {
  const token = getTokenFromRequest(req);
  if (!token) return null;

  const supabase = getSupabase();

  // Non-blocking cleanup of stale sessions
  maybeCleanExpired(supabase).catch(() => {});

  const { data, error } = await supabase
    .from('sessions')
    .select('engineer_id, expires_at, engineers(id, full_name, role, is_active)')
    .eq('token', token)
    .single();

  if (error || !data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }

  const eng = data.engineers;
  if (!eng || !eng.is_active) return null;

  return {
    engineerId: eng.id,
    fullName: eng.full_name,
    role: eng.role,
  };
}

/** Boolean check — is the request authenticated? */
export async function isAuthed(req) {
  const session = await getSession(req);
  return !!session;
}

/** Create a new session for an engineer, return the token */
export async function createSession(engineerId) {
  const supabase = getSupabase();
  const token = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from('sessions').insert({
    token,
    engineer_id: engineerId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });

  if (error) throw error;
  return token;
}

/** Delete a session by token */
export async function deleteSession(token) {
  const supabase = getSupabase();
  await supabase.from('sessions').delete().eq('token', token);
}

/** Get the raw token from the cookie */
export function getTokenFromCookie(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return cookies[COOKIE_NAME] || null;
}

export function setAuthCookie(res, token) {
  const maxAge = MAX_AGE_DAYS * 24 * 60 * 60;
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAge}`
  );
}

export function clearAuthCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}
