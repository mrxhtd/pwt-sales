import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

const MAX_FIELD = 2000; // max chars per text field
function clamp(s: string, max = MAX_FIELD): string {
  return (s || '').slice(0, max);
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
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

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
      return json({ sites: (data || []).map(rowToSite) }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const s = body?.site;
      if (!s?.id) return json({ error: 'Missing site.id' }, 400, cors);

      if (s.status && !VALID_STATUSES.includes(s.status)) {
        return json({ error: 'Invalid status' }, 400, cors);
      }

      // Check if record exists — separate insert vs update
      const { data: existing } = await supabase
        .from('sites')
        .select('engineer_id')
        .eq('id', s.id)
        .single();

      if (existing) {
        // UPDATE — verify ownership
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your site' }, 403, cors);
        }
        const { error } = await supabase
          .from('sites')
          .update({
            name: clamp(s.name),
            contact: clamp(s.contact),
            phone: clamp(s.phone, 50),
            equipment: clamp(s.equipment),
            specs: clamp(s.specs),
            location: clamp(s.location),
            status: s.status || '',
            next_action: clamp(s.nextAction),
            due_date: s.dueDate || '',
            notes: clamp(s.notes, 5000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', s.id);
        if (error) throw error;
      } else {
        // INSERT — server generates ID to prevent IDOR
        const newId = crypto.randomUUID();
        const { error } = await supabase
          .from('sites')
          .insert({
            id: newId,
            name: clamp(s.name),
            contact: clamp(s.contact),
            phone: clamp(s.phone, 50),
            equipment: clamp(s.equipment),
            specs: clamp(s.specs),
            location: clamp(s.location),
            status: s.status || '',
            next_action: clamp(s.nextAction),
            due_date: s.dueDate || '',
            notes: clamp(s.notes, 5000),
            engineer_id: engineerId,
            updated_at: new Date().toISOString(),
          });
        if (error) throw error;
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);

      if (!isAdmin) {
        const { data: existing } = await supabase
          .from('sites')
          .select('engineer_id')
          .eq('id', id)
          .single();
        if (existing && existing.engineer_id !== engineerId) {
          return json({ error: 'Not your site' }, 403, cors);
        }
      }

      const { error } = await supabase.from('sites').delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('sites edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}
