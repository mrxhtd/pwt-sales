import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession, createSession, deleteSession } from '../_shared/auth.ts';
import bcrypt from 'npm:bcryptjs@2.4.3';

// ─── RATE LIMITING (in-memory, per instance) ─────────
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const MAX_ATTEMPTS = 7;
const WINDOW_MS = 15 * 60 * 1000;

function isRateLimited(key: string): boolean {
  const now = Date.now();
  const entry = loginAttempts.get(key);
  if (!entry || now > entry.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > MAX_ATTEMPTS;
}

function clearRateLimit(key: string) {
  loginAttempts.delete(key);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  try {
    // ─── CHECK AUTH (GET) ────────────────────────────────
    if (req.method === 'GET') {
      const session = await getSession(req);
      if (!session) return json({ authed: false }, 200, cors);
      return json({
        authed: true,
        engineer: {
          id: session.engineerId,
          fullName: session.fullName,
          role: session.role,
        },
      }, 200, cors);
    }

    // ─── LOGOUT (DELETE) ─────────────────────────────────
    if (req.method === 'DELETE') {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      if (token) await deleteSession(token);
      return json({ ok: true }, 200, cors);
    }

    // ─── LOGIN (POST) ────────────────────────────────────
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    const body = await req.json();
    const username = (body?.username || '').trim().toLowerCase();
    const password = body?.password || '';

    if (!username || !password) {
      return json({ error: 'Username and password required' }, 400, cors);
    }

    // Validate input lengths
    if (username.length > 100 || password.length > 200) {
      return json({ error: 'Input too long' }, 400, cors);
    }

    // Rate limit by IP + username
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateKey = ip + ':' + username;
    if (isRateLimited(rateKey)) {
      return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429, cors);
    }

    const supabase = getSupabase();
    const { data: engineer, error } = await supabase
      .from('engineers')
      .select('id, username, password, full_name, role, is_active')
      .eq('username', username)
      .single();

    if (error || !engineer) {
      return json({ error: 'Invalid username or password' }, 401, cors);
    }

    if (!engineer.is_active) {
      return json({ error: 'Account disabled' }, 401, cors);
    }

    const match = await bcrypt.compare(password, engineer.password);
    if (!match) {
      return json({ error: 'Invalid username or password' }, 401, cors);
    }

    // Successful login — clear rate limit
    clearRateLimit(rateKey);

    // Create session
    const token = await createSession(engineer.id);

    return json({
      ok: true,
      token,
      engineer: {
        id: engineer.id,
        fullName: engineer.full_name,
        role: engineer.role,
      },
    }, 200, cors);
  } catch (err) {
    console.error('auth edge function error:', err);
    return json({ error: 'Server error' }, 500, getCorsHeaders(req));
  }
});
