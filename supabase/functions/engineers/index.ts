import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import bcrypt from 'npm:bcryptjs@2.4.3';

const MAX_FIELD = 200;

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

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  if (session.role !== 'admin') {
    return json({ error: 'Admin only' }, 403, cors);
  }

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('engineers')
        .select('id, username, full_name, role, is_active, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return json({
        engineers: (data || []).map((e: any) => ({
          id: e.id,
          username: e.username,
          fullName: e.full_name,
          role: e.role,
          isActive: e.is_active,
          createdAt: e.created_at,
        })),
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const e = body?.engineer;
      if (!e?.username) return json({ error: 'Missing username' }, 400, cors);

      // Validate input lengths
      const username = e.username.trim().toLowerCase().slice(0, 100);
      const fullName = (e.fullName || e.username).slice(0, MAX_FIELD);

      if (username.length < 3) {
        return json({ error: 'Username must be at least 3 characters' }, 400, cors);
      }

      // Validate role
      const role = e.role === 'admin' ? 'admin' : 'engineer';

      const id = e.id || 'eng_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { data: existing } = await supabase
        .from('engineers')
        .select('id')
        .eq('id', id)
        .single();

      // Check for duplicate username (on new records or username changes)
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

      if (!existing && !e.password) {
        return json({ error: 'Password required for new engineer' }, 400, cors);
      }
      if (e.password) {
        // Password validation
        if (e.password.length < 6) {
          return json({ error: 'Password must be at least 6 characters' }, 400, cors);
        }
        if (e.password.length > 200) {
          return json({ error: 'Password too long' }, 400, cors);
        }
        record.password = await bcrypt.hash(e.password, 10);
      }

      const { error } = await supabase
        .from('engineers')
        .upsert(record, { onConflict: 'id' });
      if (error) throw error;
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
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('engineers edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
