import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

// NOTE: legacy Vercel backend; the live frontend uses the Supabase Edge Functions.
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

function rowToClient(r) {
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

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
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

      // Get product counts, categories, and low stock per client
      const clientIds = (data || []).map(c => c.id);
      let productSummary = {};
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

      const clients = (data || []).map(r => {
        const summary = productSummary[r.id] || { count: 0, lowStock: 0, cats: new Set() };
        return rowToClient({
          ...r,
          product_count: summary.count,
          low_stock_count: summary.lowStock,
          categories: [...summary.cats],
        });
      });

      return res.status(200).json({
        clients,
        totalLowStock,
        pagination: pageMeta(count, limit, offset, data),
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // RESTORE a soft-deleted client (admin only) — also restores its products.
      if (body?.restore) {
        if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
        const { data: dead } = await supabase.from('clients').select('*').eq('id', body.restore).single();
        if (!dead) return res.status(404).json({ error: 'Client not found' });
        const now = new Date().toISOString();
        const { error } = await supabase.from('clients')
          .update({ deleted_at: null, updated_at: now }).eq('id', body.restore);
        if (error) throw error;
        await supabase.from('client_products')
          .update({ deleted_at: null, updated_at: now }).eq('client_id', body.restore);
        await audit(supabase, { table: 'clients', rowId: body.restore, action: 'restore', session, before: dead });
        return res.status(200).json({ ok: true, id: body.restore });
      }

      const c = body?.client;
      if (!c?.id) return res.status(400).json({ error: 'Missing client.id' });

      // Check ownership on update (ignore soft-deleted)
      const { data: existing } = await supabase
        .from('clients')
        .select('*')
        .eq('id', c.id)
        .is('deleted_at', null)
        .single();

      if (existing && existing.engineer_id !== engineerId && !isAdmin) {
        return res.status(403).json({ error: 'Not your client' });
      }

      const record = {
        id: c.id,
        name: c.name || '',
        contact: c.contact || '',
        phone: c.phone || '',
        location: c.location || '',
        equipment: c.equipment || '',
        specs: c.specs || '',
        notes: c.notes || '',
        engineer_id: existing ? existing.engineer_id : engineerId,
        updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from('clients').upsert(record, { onConflict: 'id' });
      if (error) throw error;
      await audit(supabase, {
        table: 'clients', rowId: c.id, action: existing ? 'update' : 'insert',
        session, before: existing || null, after: record,
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: existing } = await supabase
        .from('clients').select('*').eq('id', id).is('deleted_at', null).single();
      if (!existing) return res.status(200).json({ ok: true }); // already gone — idempotent
      if (!isAdmin && existing.engineer_id !== engineerId) {
        return res.status(403).json({ error: 'Not your client' });
      }

      // Soft delete the client AND its products (DB CASCADE only fires on hard delete).
      const now = new Date().toISOString();
      await supabase.from('client_products')
        .update({ deleted_at: now, updated_at: now }).eq('client_id', id).is('deleted_at', null);
      const { error } = await supabase.from('clients')
        .update({ deleted_at: now, updated_at: now }).eq('id', id);
      if (error) throw error;
      await audit(supabase, { table: 'clients', rowId: id, action: 'delete', session, before: existing });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('clients api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
