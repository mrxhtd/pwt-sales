import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

const MAX_FIELD = 2000;
const DEFAULT_PAGE_SIZE = 200;
const MAX_PAGE_SIZE = 500;

function clamp(s: unknown, max = MAX_FIELD): string {
  return String(s ?? '').slice(0, max);
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
    updatedAt: r.updated_at || '',
    deletedAt: r.deleted_at || null,
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
        .from('clients')
        .select(
          'id, name, contact, phone, location, equipment, specs, notes, converted_from, converted_at, created_at, updated_at, deleted_at, engineer_id, engineers(full_name)',
          { count: 'exact' },
        )
        .order('updated_at', { ascending: false, nullsFirst: false })
        .range(page * limit, page * limit + limit - 1);

      if (!includeDeleted) query = query.is('deleted_at', null);

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

      return json({ clients, totalLowStock, page, limit, total: count ?? null }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      if (body?.action === 'restore' && body?.id) {
        const id = String(body.id);
        const { data: existing } = await supabase
          .from('clients').select('engineer_id, deleted_at').eq('id', id).single();
        if (!existing) return json({ error: 'Not found' }, 404, cors);
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your client' }, 403, cors);
        }
        const { error: rErr } = await supabase
          .from('clients')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (rErr) throw rErr;
        audit({
          action: 'client_restored',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'client', entityId: id,
        });
        return json({ ok: true }, 200, cors);
      }

      const c = body?.client;
      if (!c?.id) return json({ error: 'Missing client.id' }, 400, cors);

      const { data: existing } = await supabase
        .from('clients')
        .select('engineer_id, name, deleted_at')
        .eq('id', c.id)
        .single();

      if (existing) {
        if (existing.engineer_id !== engineerId && !isAdmin) {
          return json({ error: 'Not your client' }, 403, cors);
        }
        if (existing.deleted_at) {
          return json({ error: 'Client is deleted; restore first' }, 409, cors);
        }
        const { error } = await supabase
          .from('clients')
          .update({
            name: clamp(c.name),
            contact: clamp(c.contact),
            phone: clamp(c.phone, 50),
            location: clamp(c.location),
            equipment: clamp(c.equipment),
            specs: clamp(c.specs),
            notes: clamp(c.notes, 5000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', c.id);
        if (error) throw error;
      } else {
        const newId = crypto.randomUUID();
        const { error } = await supabase
          .from('clients')
          .insert({
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
          });
        if (error) throw error;
        audit({
          action: 'client_created',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'client', entityId: newId,
          after: { name: c.name },
        });
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);
      const hard = url.searchParams.get('hard') === '1' && isAdmin;

      const { data: existing } = await supabase
        .from('clients').select('engineer_id, name, deleted_at').eq('id', id).single();
      if (!existing) return json({ ok: true }, 200, cors);
      if (!isAdmin && existing.engineer_id !== engineerId) {
        return json({ error: 'Not your client' }, 403, cors);
      }

      if (hard) {
        await supabase.from('client_products').delete().eq('client_id', id);
        const { error } = await supabase.from('clients').delete().eq('id', id);
        if (error) throw error;
        audit({
          action: 'client_purged',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'client', entityId: id,
          before: existing,
        });
      } else {
        const now = new Date().toISOString();
        await supabase.from('client_products').update({ deleted_at: now }).eq('client_id', id).is('deleted_at', null);
        const { error } = await supabase.from('clients').update({ deleted_at: now }).eq('id', id);
        if (error) throw error;
        audit({
          action: 'client_deleted',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'client', entityId: id,
          before: { name: existing.name },
        });
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('clients edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
