import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit } from '../_shared/audit.ts';

const MAX_FIELD = 2000;
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

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function rowToClient(r: any) {
  return {
    id: r.id,
    name: r.name || '',
    contact: r.contact || '',
    phone: r.phone || '',
    location: r.location || '',
    equipment: r.equipment || '',
    specs: r.specs || '',
    notes: r.notes || '',
    convertedFrom: r.converted_from || '',
    convertedAt: r.converted_at || '',
    createdAt: r.created_at || '',
    engineerId: r.engineer_id || '',
    engineerName: r.engineers?.full_name || '',
    productCount: r.product_count || 0,
    lowStockCount: r.low_stock_count || 0,
    categories: r.categories || [],
  };
}

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
        .from('clients')
        .select('id, name, contact, phone, location, equipment, specs, notes, converted_from, converted_at, created_at, engineer_id, engineers(full_name)', { count: 'exact' })
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

      const clientIds = (data || []).map((c: any) => c.id);
      const productSummary: Record<string, { count: number; lowStock: number; cats: Set<string> }> = {};
      let totalLowStock = 0;

      if (clientIds.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('client_products')
          .select('client_id, category, status')
          .is('deleted_at', null)
          .in('client_id', clientIds);
        if (!pErr && products) {
          for (const p of products) {
            if (!productSummary[p.client_id]) {
              productSummary[p.client_id] = { count: 0, lowStock: 0, cats: new Set() };
            }
            productSummary[p.client_id].count++;
            productSummary[p.client_id].cats.add(p.category);
            if (p.status === 'running_out_of_stock') {
              productSummary[p.client_id].lowStock++;
              totalLowStock++;
            }
          }
        }
      }

      const clients = (data || []).map((r: any) => {
        const summary = productSummary[r.id] || { count: 0, lowStock: 0, cats: new Set() };
        return rowToClient({
          ...r,
          product_count: summary.count,
          low_stock_count: summary.lowStock,
          categories: [...summary.cats],
        });
      });

      return json({
        clients,
        totalLowStock,
        pagination: pageMeta(count, limit, offset, data),
      }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      // RESTORE a soft-deleted client (admin only) — also restores its products.
      if (body?.restore) {
        if (!isAdmin) return json({ error: 'Admin only' }, 403, cors);
        const { data: dead } = await supabase
          .from('clients').select('*').eq('id', body.restore).single();
        if (!dead) return json({ error: 'Client not found' }, 404, cors);
        const now = new Date().toISOString();
        const { error } = await supabase
          .from('clients').update({ deleted_at: null, updated_at: now }).eq('id', body.restore);
        if (error) throw error;
        await supabase.from('client_products')
          .update({ deleted_at: null, updated_at: now }).eq('client_id', body.restore);
        await audit(supabase, { table: 'clients', rowId: body.restore, action: 'restore', session, before: dead });
        return json({ ok: true, id: body.restore }, 200, cors);
      }

      const c = body?.client;
      if (!c?.id) return json({ error: 'Missing client.id' }, 400, cors);

      // Check if record exists — separate insert vs update (ignore soft-deleted)
      const { data: existing } = await supabase
        .from('clients')
        .select('*')
        .eq('id', c.id)
        .is('deleted_at', null)
        .single();

      if (existing) {
        // UPDATE — verify ownership
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your client' }, 403, cors);
        }
        const patch = {
          name: clamp(c.name),
          contact: clamp(c.contact),
          phone: clamp(c.phone, 50),
          location: clamp(c.location),
          equipment: clamp(c.equipment),
          specs: clamp(c.specs),
          notes: clamp(c.notes, 5000),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('clients').update(patch).eq('id', c.id);
        if (error) throw error;
        await audit(supabase, { table: 'clients', rowId: c.id, action: 'update', session, before: existing, after: patch });
      } else {
        // INSERT — server generates ID
        const newId = crypto.randomUUID();
        const record = {
          id: newId,
          name: clamp(c.name),
          contact: clamp(c.contact),
          phone: clamp(c.phone, 50),
          location: clamp(c.location),
          equipment: clamp(c.equipment),
          specs: clamp(c.specs),
          notes: clamp(c.notes, 5000),
          engineer_id: engineerId,
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('clients').insert(record);
        if (error) throw error;
        await audit(supabase, { table: 'clients', rowId: newId, action: 'insert', session, after: record });
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);

      const { data: existing } = await supabase
        .from('clients').select('*').eq('id', id).is('deleted_at', null).single();
      if (!existing) return json({ ok: true }, 200, cors); // already gone — idempotent
      if (!isAdmin && existing.engineer_id !== engineerId) {
        return json({ error: 'Not your client' }, 403, cors);
      }

      // Soft delete the client AND its products (the DB CASCADE only fires on hard delete).
      const now = new Date().toISOString();
      await supabase.from('client_products')
        .update({ deleted_at: now, updated_at: now })
        .eq('client_id', id).is('deleted_at', null);
      const { error } = await supabase
        .from('clients').update({ deleted_at: now, updated_at: now }).eq('id', id);
      if (error) throw error;
      await audit(supabase, { table: 'clients', rowId: id, action: 'delete', session, before: existing });
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('clients edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
