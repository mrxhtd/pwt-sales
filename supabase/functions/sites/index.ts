import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit } from '../_shared/audit.ts';

const MAX_FIELD = 2000; // max chars per text field
function clamp(s: string, max = MAX_FIELD): string {
  return (s || '').slice(0, max);
}

// ─── PAGINATION ───────────────────────────────────────
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
function parsePaging(url: URL) {
  let limit = parseInt(url.searchParams.get('limit') || '', 10);
  let offset = parseInt(url.searchParams.get('offset') || '', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}
function pageMeta(count: number | null, limit: number, offset: number, rows: unknown[] | null) {
  const total = count ?? 0;
  return { total, limit, offset, hasMore: offset + (rows?.length || 0) < total };
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
      const url = new URL(req.url);
      const { limit, offset } = parsePaging(url);

      let query = supabase
        .from('sites')
        .select('id, name, contact, phone, equipment, specs, location, status, next_action, due_date, notes, created_at, engineer_id, engineers(full_name)', { count: 'exact' })
        .is('deleted_at', null)
        .order('updated_at', { ascending: false })
        .range(offset, offset + limit - 1);

      if (!isAdmin) {
        query = query.eq('engineer_id', engineerId);
      } else {
        const filterEngId = url.searchParams.get('engineerId');
        if (filterEngId) query = query.eq('engineer_id', filterEngId);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return json({
        sites: (data || []).map(rowToSite),
        pagination: pageMeta(count, limit, offset, data),
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      // RESTORE a soft-deleted site (admin only)
      if (body?.restore) {
        if (!isAdmin) return json({ error: 'Admin only' }, 403, cors);
        const { data: dead } = await supabase
          .from('sites').select('*').eq('id', body.restore).single();
        if (!dead) return json({ error: 'Site not found' }, 404, cors);
        const { error } = await supabase
          .from('sites')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', body.restore);
        if (error) throw error;
        await audit(supabase, { table: 'sites', rowId: body.restore, action: 'restore', session, before: dead });
        return json({ ok: true, id: body.restore }, 200, cors);
      }

      const s = body?.site;
      if (!s?.id) return json({ error: 'Missing site.id' }, 400, cors);

      if (s.status && !VALID_STATUSES.includes(s.status)) {
        return json({ error: 'Invalid status' }, 400, cors);
      }

      // Check if record exists — separate insert vs update (ignore soft-deleted)
      const { data: existing } = await supabase
        .from('sites')
        .select('*')
        .eq('id', s.id)
        .is('deleted_at', null)
        .single();

      if (existing) {
        // UPDATE — verify ownership
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your site' }, 403, cors);
        }
        const patch = {
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
        };
        const { error } = await supabase.from('sites').update(patch).eq('id', s.id);
        if (error) throw error;
        await audit(supabase, { table: 'sites', rowId: s.id, action: 'update', session, before: existing, after: patch });
      } else {
        // INSERT — server generates ID to prevent IDOR
        const newId = crypto.randomUUID();
        const record = {
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
        };
        const { error } = await supabase.from('sites').insert(record);
        if (error) throw error;
        await audit(supabase, { table: 'sites', rowId: newId, action: 'insert', session, after: record });
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);

      // Fetch the live row for the ownership check + audit snapshot.
      const { data: existing } = await supabase
        .from('sites').select('*').eq('id', id).is('deleted_at', null).single();
      if (!existing) return json({ ok: true }, 200, cors); // already gone — idempotent
      if (!isAdmin && existing.engineer_id !== engineerId) {
        return json({ error: 'Not your site' }, 403, cors);
      }

      // Soft delete — keep the row so it stays recoverable and auditable.
      const { error } = await supabase
        .from('sites')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await audit(supabase, { table: 'sites', rowId: id, action: 'delete', session, before: existing });
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
