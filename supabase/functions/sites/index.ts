import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { notifyAdmins } from '../_shared/push.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

const MAX_FIELD = 2000;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

function clamp(s: unknown, max = MAX_FIELD): string {
  return String(s ?? '').slice(0, max);
}
function validDate(d: unknown): string | null {
  if (!d || typeof d !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
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
    updatedAt: r.updated_at || '',
    deletedAt: r.deleted_at || null,
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

  const { engineerId, role, fullName } = session;
  const isAdmin = role === 'admin';
  const ip = getClientIp(req);

  try {
    const supabase = getSupabase();
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const includeDeleted = url.searchParams.get('includeDeleted') === '1' && isAdmin;
      const page = Math.max(0, parseInt(url.searchParams.get('page') || '0') || 0);
      const limit = Math.min(
        MAX_PAGE_SIZE,
        Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_PAGE_SIZE)) || DEFAULT_PAGE_SIZE),
      );

      let query = supabase
        .from('sites')
        .select(
          'id, name, contact, phone, equipment, specs, location, status, next_action, due_date, notes, created_at, updated_at, deleted_at, engineer_id, engineers(full_name)',
          { count: 'exact' },
        )
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(page * limit, page * limit + limit - 1);

      if (!includeDeleted) {
        query = query.is('deleted_at', null);
      }

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
        page,
        limit,
        total: count ?? null,
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      // Restore endpoint: PATCH-like via POST with action=restore.
      if (body?.action === 'restore' && body?.id) {
        const id = String(body.id);
        const { data: existing } = await supabase
          .from('sites')
          .select('engineer_id, deleted_at')
          .eq('id', id)
          .single();
        if (!existing) return json({ error: 'Not found' }, 404, cors);
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your site' }, 403, cors);
        }
        const { error: rErr } = await supabase
          .from('sites')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (rErr) throw rErr;
        audit({
          action: 'site_restored',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'site', entityId: id,
        });
        return json({ ok: true }, 200, cors);
      }

      const s = body?.site;
      if (!s?.id) return json({ error: 'Missing site.id' }, 400, cors);

      if (s.status && !VALID_STATUSES.includes(s.status)) {
        return json({ error: 'Invalid status' }, 400, cors);
      }

      const { data: existing } = await supabase
        .from('sites')
        .select('id, engineer_id, name, status, deleted_at, next_action, due_date')
        .eq('id', s.id)
        .single();

      if (existing) {
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your site' }, 403, cors);
        }
        if (existing.deleted_at) {
          return json({ error: 'Site is deleted; restore first' }, 409, cors);
        }
        const next = {
          name: clamp(s.name),
          contact: clamp(s.contact),
          phone: clamp(s.phone, 50),
          equipment: clamp(s.equipment),
          specs: clamp(s.specs),
          location: clamp(s.location),
          status: s.status || '',
          next_action: clamp(s.nextAction),
          due_date: validDate(s.dueDate),
          notes: clamp(s.notes, 5000),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('sites').update(next).eq('id', s.id);
        if (error) throw error;
        if (existing.status !== next.status) {
          audit({
            action: 'site_status_changed',
            actorId: engineerId, actorName: fullName, actorIp: ip,
            entityType: 'site', entityId: s.id,
            before: { status: existing.status }, after: { status: next.status },
          });
        }
      } else {
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
            due_date: validDate(s.dueDate),
            notes: clamp(s.notes, 5000),
            engineer_id: engineerId,
            updated_at: new Date().toISOString(),
          });
        if (error) throw error;

        audit({
          action: 'site_created',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'site', entityId: newId,
          after: { name: s.name, status: s.status },
        });

        notifyAdmins({
          title: `New Lead: ${(s.name || 'Unnamed').slice(0, 80)}`,
          body: `${fullName} added a new lead`,
          tag: `new-lead-${newId}`,
          url: `/#lead/${newId}`,
          excludeEngineerId: engineerId,
        }).catch(err => console.error('Admin notify failed:', err));

        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);
      const hard = url.searchParams.get('hard') === '1' && isAdmin;

      const { data: existing } = await supabase
        .from('sites')
        .select('id, engineer_id, name, status, deleted_at')
        .eq('id', id)
        .single();
      if (!existing) return json({ ok: true }, 200, cors);
      if (!isAdmin && existing.engineer_id !== engineerId) {
        return json({ error: 'Not your site' }, 403, cors);
      }

      if (hard) {
        const { error } = await supabase.from('sites').delete().eq('id', id);
        if (error) throw error;
        audit({
          action: 'site_purged',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'site', entityId: id,
          before: existing,
        });
      } else {
        const { error } = await supabase
          .from('sites')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        audit({
          action: 'site_deleted',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'site', entityId: id,
          before: { name: existing.name, status: existing.status },
        });
      }
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
