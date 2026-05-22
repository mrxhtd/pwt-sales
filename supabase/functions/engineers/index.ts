import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import * as bcrypt from 'https://deno.land/x/bcrypt@v0.4.1/mod.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  if (session.role !== 'admin') {
    return json({ error: 'Admin only' }, 403);
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
      });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const e = body?.engineer;
      if (!e?.username) return json({ error: 'Missing username' }, 400);

      const id = e.id || 'eng_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { data: existing } = await supabase
        .from('engineers')
        .select('id')
        .eq('id', id)
        .single();

      const record: any = {
        id,
        username: e.username.trim().toLowerCase(),
        full_name: e.fullName || e.username,
        role: e.role || 'engineer',
        is_active: e.isActive !== false,
        updated_at: new Date().toISOString(),
      };

      if (!existing && !e.password) {
        return json({ error: 'Password required for new engineer' }, 400);
      }
      if (e.password) {
        record.password = await bcrypt.hash(e.password);
      }

      const { error } = await supabase
        .from('engineers')
        .upsert(record, { onConflict: 'id' });
      if (error) throw error;
      return json({ ok: true, id });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400);

      if (id === session.engineerId) {
        return json({ error: 'Cannot delete yourself' }, 400);
      }

      const { error } = await supabase
        .from('engineers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('engineers edge function error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
