// TOTP enrollment + management endpoint.
// GET    /totp           — current 2FA status
// POST   /totp           — start enrollment, returns secret + otpauth URL (does not enable yet)
// POST   /totp action=enable  — verify a code against the staged secret and enable 2FA
// POST   /totp action=disable — disable 2FA (requires current TOTP code, or admin acting on another)
// POST   /totp action=recovery — regenerate recovery codes

import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function generateBase32Secret(byteLength = 20): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  let bits = 0, value = 0, out = '';
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32[(value >> bits) & 0x1f];
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 0x1f];
  return out;
}

function base32Decode(encoded: string): Uint8Array {
  const clean = encoded.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >> bits) & 0xff); }
  }
  return new Uint8Array(out);
}

async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const code = ((sig[offset] & 0x7f) << 24) |
               ((sig[offset + 1] & 0xff) << 16) |
               ((sig[offset + 2] & 0xff) << 8) |
               (sig[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, '0');
}

async function verifyTotp(secret: string, code: string): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const bytes = base32Decode(secret);
  if (bytes.length === 0) return false;
  const step = Math.floor(Date.now() / 1000 / 30);
  for (const off of [-1, 0, 1]) {
    const expected = await hotp(bytes, step + off);
    let mismatch = 0;
    for (let i = 0; i < 6; i++) mismatch |= expected.charCodeAt(i) ^ code.charCodeAt(i);
    if (mismatch === 0) return true;
  }
  return false;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('');
}

function generateRecoveryCode(): string {
  // 10 chars in groups of 5 — "abcde-fghij"
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < 10; i++) {
    if (i === 5) out += '-';
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const supabase = getSupabase();
  const ip = getClientIp(req);

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('engineers')
        .select('totp_enabled, totp_enrolled_at')
        .eq('id', session.engineerId)
        .single();
      if (error) throw error;
      return json({
        enabled: !!data?.totp_enabled,
        enrolledAt: data?.totp_enrolled_at || null,
      }, 200, cors);
    }

    if (req.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, cors);
    }

    const body = await req.json().catch(() => ({}));
    const action = body?.action || 'start';

    if (action === 'start') {
      // Generate a fresh secret. Don't enable yet — caller must verify with a code.
      const secret = generateBase32Secret();
      const label = encodeURIComponent(`PWT Sales:${session.fullName || session.engineerId}`);
      const issuer = encodeURIComponent('PWT Sales');
      const otpauth = `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

      // Stage the new secret separately. If the user is already enrolled, their
      // existing totp_secret + totp_enabled stay intact until the new code is
      // verified — otherwise calling /totp start would silently disable 2FA.
      const { error } = await supabase
        .from('engineers')
        .update({ totp_secret_pending: secret, updated_at: new Date().toISOString() })
        .eq('id', session.engineerId);
      if (error) throw error;

      return json({ secret, otpauth }, 200, cors);
    }

    if (action === 'enable') {
      const code = String(body?.code || '').replace(/\s+/g, '');
      const { data: eng } = await supabase
        .from('engineers')
        .select('totp_secret_pending')
        .eq('id', session.engineerId)
        .single();
      if (!eng?.totp_secret_pending) return json({ error: 'No TOTP secret staged; call start first' }, 400, cors);
      const ok = await verifyTotp(eng.totp_secret_pending, code);
      if (!ok) return json({ error: 'Invalid code' }, 400, cors);

      // Promote the verified pending secret to the live secret in a single update.
      const { error } = await supabase
        .from('engineers')
        .update({
          totp_secret: eng.totp_secret_pending,
          totp_secret_pending: null,
          totp_enabled: true,
          totp_enrolled_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', session.engineerId);
      if (error) throw error;

      // Mint recovery codes (one-time use).
      await supabase.from('totp_recovery_codes').delete().eq('engineer_id', session.engineerId);
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) codes.push(generateRecoveryCode());
      const rows = await Promise.all(codes.map(async c => ({
        engineer_id: session.engineerId,
        code_hash: await sha256Hex(c),
      })));
      await supabase.from('totp_recovery_codes').insert(rows);

      audit({
        action: 'totp_enabled',
        actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
      });

      return json({ ok: true, recoveryCodes: codes }, 200, cors);
    }

    if (action === 'disable') {
      const targetId = body?.engineerId || session.engineerId;
      const isSelf = targetId === session.engineerId;
      const isAdmin = session.role === 'admin';
      if (!isSelf && !isAdmin) return json({ error: 'Forbidden' }, 403, cors);

      if (isSelf) {
        const code = String(body?.code || '').replace(/\s+/g, '');
        const { data: eng } = await supabase
          .from('engineers')
          .select('totp_secret, totp_enabled')
          .eq('id', session.engineerId)
          .single();
        if (eng?.totp_enabled) {
          const ok = eng.totp_secret ? await verifyTotp(eng.totp_secret, code) : false;
          if (!ok) return json({ error: 'Invalid code' }, 400, cors);
        }
      }

      const { error } = await supabase
        .from('engineers')
        .update({
          totp_secret: null,
          totp_secret_pending: null,
          totp_enabled: false,
          totp_enrolled_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', targetId);
      if (error) throw error;
      await supabase.from('totp_recovery_codes').delete().eq('engineer_id', targetId);

      audit({
        action: isSelf ? 'totp_disabled' : 'totp_admin_disabled',
        actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
        entityType: 'engineer', entityId: targetId,
      });

      return json({ ok: true }, 200, cors);
    }

    if (action === 'recovery') {
      // Regenerate recovery codes (requires current TOTP).
      const code = String(body?.code || '').replace(/\s+/g, '');
      const { data: eng } = await supabase
        .from('engineers')
        .select('totp_secret, totp_enabled')
        .eq('id', session.engineerId)
        .single();
      if (!eng?.totp_enabled || !eng.totp_secret) return json({ error: 'TOTP not enabled' }, 400, cors);
      const ok = await verifyTotp(eng.totp_secret, code);
      if (!ok) return json({ error: 'Invalid code' }, 400, cors);

      await supabase.from('totp_recovery_codes').delete().eq('engineer_id', session.engineerId);
      const codes: string[] = [];
      for (let i = 0; i < 10; i++) codes.push(generateRecoveryCode());
      const rows = await Promise.all(codes.map(async c => ({
        engineer_id: session.engineerId,
        code_hash: await sha256Hex(c),
      })));
      await supabase.from('totp_recovery_codes').insert(rows);

      audit({
        action: 'totp_recovery_regenerated',
        actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
      });

      return json({ ok: true, recoveryCodes: codes }, 200, cors);
    }

    return json({ error: 'Unknown action' }, 400, cors);
  } catch (err) {
    console.error('totp edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
