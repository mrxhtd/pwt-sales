import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { checkPasswordStrength } from '../_shared/password.ts';
import { audit, getClientIp } from '../_shared/audit.ts';
import bcrypt from 'npm:bcryptjs@2.4.3';

const MAX_FIELD = 200;

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function validEmail(e: unknown): string | null {
  if (typeof e !== 'string') return null;
  const trimmed = e.trim().toLowerCase();
  if (!trimmed) return null;
  if (trimmed.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  if (session.role !== 'admin') {
    return json({ error: 'Admin only' }, 403, cors);
  }

  const ip = getClientIp(req);
  const actorId = session.engineerId;
  const actorName = session.fullName;

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('engineers')
        .select('id, username, full_name, email, role, is_active, totp_enabled, location_consent_given, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({
        engineers: (data || []).map((e: any) => ({
          id: e.id,
          username: e.username,
          fullName: e.full_name,
          email: e.email || '',
          role: e.role,
          isActive: e.is_active,
          totpEnabled: !!e.totp_enabled,
          locationConsentGiven: !!e.location_consent_given,
          createdAt: e.created_at,
        })),
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const e = body?.engineer;
      if (!e?.username) return json({ error: 'Missing username' }, 400, cors);

      const username = e.username.trim().toLowerCase().slice(0, 100);
      const fullName = (e.fullName || e.username).slice(0, MAX_FIELD);
      const email = e.email !== undefined ? validEmail(e.email) : undefined;

      if (e.email && email === null) {
        return json({ error: 'Invalid email' }, 400, cors);
      }

      if (username.length < 3) {
        return json({ error: 'Username must be at least 3 characters' }, 400, cors);
      }
      if (!/^[a-z0-9._-]+$/.test(username)) {
        return json({ error: 'Username may only contain letters, digits, dot, underscore, and dash' }, 400, cors);
      }

      const role = e.role === 'admin' ? 'admin' : 'engineer';

      const isUpdate = !!e.id;
      let id: string;
      let existing: any = null;

      if (isUpdate) {
        id = e.id;
        const { data } = await supabase
          .from('engineers')
          .select('id, username, full_name, email, role, is_active')
          .eq('id', id)
          .single();
        existing = data;
        if (!existing) return json({ error: 'Engineer not found' }, 404, cors);
      } else {
        id = 'eng_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      }

      const { data: dupeCheck } = await supabase
        .from('engineers')
        .select('id')
        .eq('username', username)
        .neq('id', id)
        .single();

      if (dupeCheck) {
        return json({ error: 'Username already taken' }, 400, cors);
      }

      const record: any = {
        id,
        username,
        full_name: fullName,
        role,
        is_active: e.isActive !== false,
        updated_at: new Date().toISOString(),
      };
      if (email !== undefined) record.email = email;

      if (!existing && !e.password) {
        return json({ error: 'Password required for new engineer' }, 400, cors);
      }
      if (e.password) {
        const check = checkPasswordStrength(e.password);
        if (!check.ok) return json({ error: check.reason }, 400, cors);
        record.password = await bcrypt.hash(e.password, 10);
      }

      const { error } = await supabase
        .from('engineers')
        .upsert(record, { onConflict: 'id' });
      if (error) throw error;

      if (existing) {
        const diff: Record<string, [unknown, unknown]> = {};
        if (existing.role !== role) diff.role = [existing.role, role];
        if (!!existing.is_active !== (e.isActive !== false)) diff.is_active = [existing.is_active, e.isActive !== false];
        if (existing.username !== username) diff.username = [existing.username, username];
        if (e.password) diff.password = ['***', '***'];
        if (Object.keys(diff).length > 0) {
          audit({
            action: 'engineer_updated',
            actorId, actorName, actorIp: ip,
            entityType: 'engineer', entityId: id,
            metadata: { diff },
          });
        }
      } else {
        audit({
          action: 'engineer_created',
          actorId, actorName, actorIp: ip,
          entityType: 'engineer', entityId: id,
          after: { username, role },
        });
      }

      return json({ ok: true, id }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);

      if (id === session.engineerId) {
        return json({ error: 'Cannot delete yourself' }, 400, cors);
      }

      const { error } = await supabase
        .from('engineers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;

      audit({
        action: 'engineer_deactivated',
        actorId, actorName, actorIp: ip,
        entityType: 'engineer', entityId: id,
      });

      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('engineers edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
