import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';

export const config = { maxDuration: 30 };

// ─── PAGINATION ───────────────────────────────────────
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 500;
function parsePaging(url) {
  let limit = parseInt(url.searchParams.get('limit'), 10);
  let offset = parseInt(url.searchParams.get('offset'), 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = DEFAULT_PAGE_SIZE;
  if (limit > MAX_PAGE_SIZE) limit = MAX_PAGE_SIZE;
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  return { limit, offset };
}
function pageMeta(count, limit, offset, rows) {
  const total = count ?? 0;
  return { total, limit, offset, hasMore: offset + (rows?.length || 0) < total };
}

function rowToSite(r) {
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

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const { limit, offset } = parsePaging(url);

      let query = supabase
        .from('sites')
        .select('id, name, contact, phone, equipment, specs, location, status, next_action, due_date, notes, created_at, engineer_id, engineers(full_name)', { count: 'exact' })
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
      return res.status(200).json({
        sites: (data || []).map(rowToSite),
        pagination: pageMeta(count, limit, offset, data),
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const s = body?.site;
      if (!s?.id) return res.status(400).json({ error: 'Missing site.id' });

      // Validate status if provided
      const VALID_STATUSES = ['', 'Potential Prospect', 'Qualified Prospect', 'Interested Prospect', 'Hot Prospect', 'Hot Lead', 'Follow Up', 'Active', 'Pending', 'Closed Won', 'Lost'];
      if (s.status && !VALID_STATUSES.includes(s.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      // Check ownership on update
      const { data: existing } = await supabase
        .from('sites')
        .select('engineer_id')
        .eq('id', s.id)
        .single();

      if (existing && existing.engineer_id !== engineerId && !isAdmin) {
        return res.status(403).json({ error: 'Not your site' });
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
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      // Check ownership
      if (!isAdmin) {
        const { data: existing } = await supabase
          .from('sites')
          .select('engineer_id')
          .eq('id', id)
          .single();
        if (existing && existing.engineer_id !== engineerId) {
          return res.status(403).json({ error: 'Not your site' });
        }
      }

      const { error } = await supabase.from('sites').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('sites api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
