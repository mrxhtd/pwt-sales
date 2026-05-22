import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession, createSession, deleteSession } from '../_shared/auth.ts';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

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

function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ─── CHECK AUTH (GET) ────────────────────────────────
    if (req.method === 'GET') {
      const session = await getSession(req);
      if (!session) return json({ authed: false });
      return json({
        authed: true,
        engineer: {
          id: session.engineerId,
          fullName: session.fullName,
          role: session.role,
        },
      });
    }

    // ─── LOGOUT (DELETE) ─────────────────────────────────
    if (req.method === 'DELETE') {
      const authHeader = req.headers.get('authorization') || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
      if (token) await deleteSession(token);
      return json({ ok: true });
    }

    // ─── LOGIN (POST) ────────────────────────────────────
    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    const body = await req.json();
    const username = (body?.username || '').trim().toLowerCase();
    const password = body?.password || '';

    if (!username || !password) {
      return json({ error: 'Username and password required' }, 400);
    }

    // Rate limit by IP + username
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const rateKey = ip + ':' + username;
    if (isRateLimited(rateKey)) {
      return json({ error: 'Too many login attempts. Try again in 15 minutes.' }, 429);
    }

    const supabase = getSupabase();
    const { data: engineer, error } = await supabase
      .from('engineers')
      .select('id, username, password, full_name, role, is_active')
      .eq('username', username)
      .single();

    if (error || !engineer) {
      return json({ error: 'Invalid username or password' }, 401);
    }

    if (!engineer.is_active) {
      return json({ error: 'Account disabled' }, 401);
    }

    const match = await bcrypt.compare(password, engineer.password);
    if (!match) {
      return json({ error: 'Invalid username or password' }, 401);
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
    });
  } catch (err) {
    console.error('auth edge function error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
