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

export const config = { maxDuration: 30 };

// ─── RATE LIMITING ────────────────────────────────────
const loginAttempts = new Map(); // key → { count, resetAt }
const MAX_ATTEMPTS = 7;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function isRateLimited(key) {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  if (entry.count > MAX_ATTEMPTS) return true;
  return false;
}

function clearRateLimit(key) {
  loginAttempts.delete(key);
}

// Cleanup stale entries every 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (now > v.resetAt) loginAttempts.delete(k);
  }
}, 30 * 60 * 1000);

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

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const username = (body?.username || '').trim().toLowerCase();
    const password = body?.password || '';

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Rate limit by IP + username
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    const rateKey = ip + ':' + username;
    if (isRateLimited(rateKey)) {
      return res.status(429).json({ error: 'Too many login attempts. Try again in 15 minutes.' });
    }

    const supabase = getSupabase();
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
    clearRateLimit(rateKey);

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
    console.error('auth api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
