import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function rowToSite(r: any) {
  return {
    id: r.id,
    name: r.name || '',
    contact: r.contact || '',
    phone: r.phone || '',
    equipment: r.equipment || '',
    specs: r.specs || '',
    location: r.location || '',
    status: r.status || '',
    nextAction: r.next_action || '',
    dueDate: r.due_date || '',
    notes: r.notes || '',
    createdAt: r.created_at || '',
    engineerId: r.engineer_id || '',
    engineerName: r.engineers?.full_name || '',
  };
}

const VALID_STATUSES = [
  '', 'Potential Prospect', 'Qualified Prospect', 'Interested Prospect',
  'Hot Prospect', 'Hot Lead', 'Follow Up', 'Active', 'Pending', 'Closed Won', 'Lost',
];

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      let query = supabase
        .from('sites')
        .select('id, name, contact, phone, equipment, specs, location, status, next_action, due_date, notes, created_at, engineer_id, engineers(full_name)')
        .order('updated_at', { ascending: false });

      if (!isAdmin) {
        query = query.eq('engineer_id', engineerId);
      } else {
        const url = new URL(req.url);
        const filterEngId = url.searchParams.get('engineerId');
        if (filterEngId) query = query.eq('engineer_id', filterEngId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return json({ sites: (data || []).map(rowToSite) });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const s = body?.site;
      if (!s?.id) return json({ error: 'Missing site.id' }, 400);

      if (s.status && !VALID_STATUSES.includes(s.status)) {
        return json({ error: 'Invalid status' }, 400);
      }

      const { data: existing } = await supabase
        .from('sites')
        .select('engineer_id')
        .eq('id', s.id)
        .single();

      if (existing && existing.engineer_id !== engineerId && !isAdmin) {
        return json({ error: 'Not your site' }, 403);
      }

      const { error } = await supabase
        .from('sites')
        .upsert({
          id: s.id,
          name: s.name || '',
          contact: s.contact || '',
          phone: s.phone || '',
          equipment: s.equipment || '',
          specs: s.specs || '',
          location: s.location || '',
          status: s.status || '',
          next_action: s.nextAction || '',
          due_date: s.dueDate || '',
          notes: s.notes || '',
          engineer_id: existing ? existing.engineer_id : engineerId,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'id' });
      if (error) throw error;
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400);

      if (!isAdmin) {
        const { data: existing } = await supabase
          .from('sites')
          .select('engineer_id')
          .eq('id', id)
          .single();
        if (existing && existing.engineer_id !== engineerId) {
          return json({ error: 'Not your site' }, 403);
        }
      }

      const { error } = await supabase.from('sites').delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('sites edge function error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
