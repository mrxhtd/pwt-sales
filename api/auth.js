import bcrypt from 'bcryptjs';
import { getSupabase } from '../lib/db.js';
import {
  getSession,
  getTokenFromCookie,
  createSession,
  deleteSession,
  setAuthCookie,
  clearAuthCookie,
} from '../lib/auth.js';
import { readBody } from '../lib/http.js';

export const config = { maxDuration: 30 };

// ─── RATE LIMITING (DB-backed, shared across serverless instances) ──────────
// In-memory state doesn't work on serverless: each instance has its own Map and
// cold starts reset it, so attackers bypass the limit by spreading attempts.
// State lives in the `login_attempts` table (see migrations/login_attempts.sql).
// All checks fail open — a limiter outage must never lock out legitimate logins.
const MAX_ATTEMPTS = 7;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

async function isRateLimited(supabase, key) {
  try {
    const now = Date.now();
    const { data: entry } = await supabase
      .from('login_attempts')
      .select('count, reset_at')
      .eq('key', key)
      .single();

    if (!entry || now > new Date(entry.reset_at).getTime()) {
      await supabase
        .from('login_attempts')
        .upsert({ key, count: 1, reset_at: new Date(now + WINDOW_MS).toISOString() }, { onConflict: 'key' });
      return false;
    }

    const count = (entry.count || 0) + 1;
    await supabase.from('login_attempts').update({ count }).eq('key', key);
    return count > MAX_ATTEMPTS;
  } catch (err) {
    console.error('rate limit check failed (failing open):', err);
    return false;
  }
}

async function clearRateLimit(supabase, key) {
  try {
    await supabase.from('login_attempts').delete().eq('key', key);
  } catch (_) {
    /* best effort */
  }
}

export default async function handler(req, res) {
  try {
    // ─── CHECK AUTH ──────────────────────────────────────
    if (req.method === 'GET') {
      const session = await getSession(req);
      if (!session) return res.status(200).json({ authed: false });
      return res.status(200).json({
        authed: true,
        engineer: {
          id: session.engineerId,
          fullName: session.fullName,
          role: session.role,
        },
      });
    }

    // ─── LOGOUT ──────────────────────────────────────────
    if (req.method === 'DELETE') {
      const token = getTokenFromCookie(req);
      if (token) await deleteSession(token);
      clearAuthCookie(res);
      return res.status(200).json({ ok: true });
    }

    // ─── LOGIN ───────────────────────────────────────────
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const body = readBody(req);
    const username = (body?.username || '').trim().toLowerCase();
    const password = body?.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    const supabase = getSupabase();

    // Rate limit by IP + username. Prefer Vercel's real-client-IP header; fall
    // back to the left-most x-forwarded-for hop.
    const ip =
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      'unknown';
    const rateKey = ip + ':' + username;
    if (await isRateLimited(supabase, rateKey)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }
    const { data: engineer, error } = await supabase
      .from('engineers')
      .select('id, username, password, full_name, role, is_active')
      .eq('username', username)
      .single();

    if (error || !engineer) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    if (!engineer.is_active) {
      return res.status(401).json({ error: 'Account disabled' });
    }

    const match = await bcrypt.compare(password, engineer.password);
    if (!match) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }

    // Successful login — clear rate limit
    await clearRateLimit(supabase, rateKey);

    // Create session
    const token = await createSession(engineer.id);
    setAuthCookie(res, token);

    return res.status(200).json({
      ok: true,
      engineer: {
        id: engineer.id,
        fullName: engineer.full_name,
        role: engineer.role,
      },
    });
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: 'Invalid request' });
    console.error('auth api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
