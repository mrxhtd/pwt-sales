import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

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

  const { engineerId, role } = session as any;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const siteId = url.searchParams.get('siteId');
      if (!siteId) return json({ error: 'Missing siteId' }, 400, cors);

      if (!isAdmin) {
        const { data: site } = await supabase.from('sites').select('engineer_id').eq('id', siteId).single();
        if (!site || site.engineer_id !== engineerId) return json({ error: 'Forbidden' }, 403, cors);
      }

      const { data, error } = await supabase
        .from('site_activities')
        .select('id, type, what_happened, next_action, next_action_date, created_at, engineer_id, engineers(full_name)')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return json({
        activities: (data || []).map((a: any) => ({
          id: a.id,
          type: a.type,
          whatHappened: a.what_happened,
          nextAction: a.next_action,
          nextActionDate: a.next_action_date || '',
          createdAt: a.created_at,
          engineerName: a.engineers?.full_name || '',
        })),
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const { siteId, type, whatHappened, nextAction, nextActionDate } = body || {};

      if (!siteId) return json({ error: 'Missing siteId' }, 400, cors);
      if (!type || !['call', 'visit'].includes(type)) return json({ error: 'Invalid type' }, 400, cors);

      const { data: site } = await supabase.from('sites').select('engineer_id').eq('id', siteId).single();
      if (!site) return json({ error: 'Site not found' }, 404, cors);
      if (!isAdmin && site.engineer_id !== engineerId) return json({ error: 'Forbidden' }, 403, cors);

      const id = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { error: insertErr } = await supabase.from('site_activities').insert({
        id,
        site_id: siteId,
        engineer_id: engineerId,
        type,
        what_happened: (whatHappened || '').slice(0, 3000),
        next_action: (nextAction || '').slice(0, 500),
        next_action_date: nextActionDate || null,
      });
      if (insertErr) throw insertErr;

      // Update site's next_action and due_date automatically
      const siteUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
      if (nextAction !== undefined) siteUpdate.next_action = (nextAction || '').slice(0, 2000);
      if (nextActionDate !== undefined) siteUpdate.due_date = nextActionDate || null;

      const { error: updateErr } = await supabase.from('sites').update(siteUpdate).eq('id', siteId);
      if (updateErr) throw updateErr;

      return json({ ok: true, id }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('activities function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
