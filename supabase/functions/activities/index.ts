import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

// A follow-up hangs off exactly one parent: a lead (sites) or a client (clients).
function resolveParent(siteId: string | null, clientId: string | null) {
  if (siteId && clientId) return { error: 'Provide siteId or clientId, not both' };
  if (siteId) return { table: 'sites', column: 'site_id', id: siteId, isSite: true };
  if (clientId) return { table: 'clients', column: 'client_id', id: clientId, isSite: false };
  return { error: 'Missing siteId or clientId' };
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

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const { engineerId, role } = session as any;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const parent = resolveParent(url.searchParams.get('siteId'), url.searchParams.get('clientId'));
      if (parent.error) return json({ error: parent.error }, 400, cors);

      if (!isAdmin) {
        const { data: row } = await supabase
          .from(parent.table!).select('engineer_id').eq('id', parent.id!).single();
        if (!row || row.engineer_id !== engineerId) return json({ error: 'Forbidden' }, 403, cors);
      }

      const { data, error } = await supabase
        .from('site_activities')
        .select('id, type, what_happened, next_action, next_action_date, created_at, engineer_id, engineers(full_name)')
        .eq(parent.column!, parent.id!)
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
      const { siteId, clientId, type, whatHappened, nextAction, nextActionDate } = body || {};

      const parent = resolveParent(siteId ?? null, clientId ?? null);
      if (parent.error) return json({ error: parent.error }, 400, cors);
      if (!type || !['call', 'visit'].includes(type)) return json({ error: 'Invalid type' }, 400, cors);

      const { data: row } = await supabase
        .from(parent.table!).select('engineer_id').eq('id', parent.id!).single();
      if (!row) return json({ error: parent.isSite ? 'Site not found' : 'Client not found' }, 404, cors);
      if (!isAdmin && row.engineer_id !== engineerId) return json({ error: 'Forbidden' }, 403, cors);

      const id = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { error: insertErr } = await supabase.from('site_activities').insert({
        id,
        [parent.column!]: parent.id,
        engineer_id: engineerId,
        type,
        what_happened: (whatHappened || '').slice(0, 3000),
        next_action: (nextAction || '').slice(0, 500),
        next_action_date: nextActionDate || null,
      });
      if (insertErr) throw insertErr;

      if (parent.isSite) {
        // Mirror the follow-up's next step onto the lead itself.
        // Clients have no next_action/due_date columns, so this is leads-only.
        const siteUpdate: Record<string, any> = { updated_at: new Date().toISOString() };
        if (nextAction !== undefined) siteUpdate.next_action = (nextAction || '').slice(0, 2000);
        if (nextActionDate !== undefined) siteUpdate.due_date = nextActionDate || null;

        const { error: updateErr } = await supabase.from('sites').update(siteUpdate).eq('id', siteId);
        if (updateErr) throw updateErr;
      } else {
        const { error: updateErr } = await supabase
          .from('clients')
          .update({ updated_at: new Date().toISOString() })
          .eq('id', clientId);
        if (updateErr) throw updateErr;
      }

      return json({ ok: true, id }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('activities function error:', err);
    // Table not set up yet — keep this signal so the client can prompt setup,
    // but don't echo the raw driver message.
    const msg = (err as any)?.message || String(err);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return json({ error: 'setup_required' }, 503, cors);
    }
    return json({ error: 'Server error' }, 500, cors);
  }
});
