import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession, createSession, deleteSession } from '../_shared/auth.ts';
import { checkLoginRateLimit, clearLoginRateLimit } from '../_shared/ratelimit.ts';
import { audit, getClientIp } from '../_shared/audit.ts';
import bcrypt from 'npm:bcryptjs@2.4.3';

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
      if (token) {
        const session = await getSession(req);
        await deleteSession(token);
        if (session) {
          audit({
            action: 'logout',
            actorId: session.engineerId,
            actorName: session.fullName,
            actorIp: getClientIp(req),
          });
        }
      }
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

    if (username.length > 100 || password.length > 200) {
      return json({ error: 'Input too long' }, 400, cors);
    }

    const ip = getClientIp(req);
    const rateKey = ip + ':' + username;
    const rl = await checkLoginRateLimit(rateKey);
    if (rl.locked) {
      return json(
        { error: 'Too many login attempts. Try again in 15 minutes.' },
        429,
        { ...cors, 'Retry-After': String(rl.retryAfterSeconds) },
      );
    }

    const supabase = getSupabase();
    const { data: engineer, error } = await supabase
      .from('engineers')
      .select('id, username, password, full_name, role, is_active, totp_enabled, totp_secret')
      .eq('username', username)
      .single();

    if (error || !engineer) {
      audit({ action: 'login_failed', actorIp: ip, metadata: { username, reason: 'no_user' } });
      return json({ error: 'Invalid username or password' }, 401, cors);
    }

    if (!engineer.is_active) {
      audit({
        action: 'login_failed',
        actorId: engineer.id,
        actorName: engineer.full_name,
        actorIp: ip,
        metadata: { reason: 'inactive' },
      });
      return json({ error: 'Account disabled' }, 401, cors);
    }

    const match = await bcrypt.compare(password, engineer.password);
    if (!match) {
      audit({
        action: 'login_failed',
        actorId: engineer.id,
        actorName: engineer.full_name,
        actorIp: ip,
        metadata: { reason: 'wrong_password' },
      });
      return json({ error: 'Invalid username or password' }, 401, cors);
    }

    // ─── 2FA / TOTP step ─────────────────────────────────
    if (engineer.totp_enabled && engineer.totp_secret) {
      const code = String(body?.totpCode || '').replace(/\s+/g, '');
      if (!code) {
        return json({ needsTotp: true }, 200, cors);
      }
      const valid = await verifyTotp(engineer.totp_secret, code);
      if (!valid) {
        const recoveryConsumed = await tryConsumeRecoveryCode(engineer.id, code);
        if (!recoveryConsumed) {
          audit({
            action: 'login_failed',
            actorId: engineer.id,
            actorName: engineer.full_name,
            actorIp: ip,
            metadata: { reason: 'wrong_totp' },
          });
          return json({ error: 'Invalid verification code', needsTotp: true }, 401, cors);
        }
      }
    }

    await clearLoginRateLimit(rateKey);

    const token = await createSession(engineer.id);

    audit({
      action: 'login',
      actorId: engineer.id,
      actorName: engineer.full_name,
      actorIp: ip,
      metadata: { role: engineer.role },
    });

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

// ─── TOTP HELPERS ──────────────────────────────────────────
// RFC 6238 (TOTP) + RFC 4226 (HOTP). 30-second step, 6 digits, ±1 step window.

function base32Decode(encoded: string): Uint8Array {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = encoded.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey(
    'raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
  );
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const code = ((sig[offset] & 0x7f) << 24) |
               ((sig[offset + 1] & 0xff) << 16) |
               ((sig[offset + 2] & 0xff) << 8) |
               (sig[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

export async function verifyTotp(secretBase32: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const secret = base32Decode(secretBase32);
  if (secret.length === 0) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const offset of [-1, 0, 1]) {
    const expected = await hotp(secret, step + offset);
    if (timingSafeEqual(expected, code)) return true;
  }
  return false;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

async function tryConsumeRecoveryCode(engineerId: string, code: string): Promise<boolean> {
  const supabase = getSupabase();
  const normalized = code.replace(/\s+/g, '').toLowerCase();
  if (normalized.length < 8) return false;
  const hash = await sha256Hex(normalized);
  const { data } = await supabase
    .from('totp_recovery_codes')
    .select('id, used_at')
    .eq('engineer_id', engineerId)
    .eq('code_hash', hash)
    .is('used_at', null)
    .maybeSingle();
  if (!data) return false;
  const { error } = await supabase
    .from('totp_recovery_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', data.id)
    .is('used_at', null);
  return !error;
}
