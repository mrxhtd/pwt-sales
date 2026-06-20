import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { readBody, isValidId } from '../lib/http.js';

export const config = { maxDuration: 30 };

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
      let query = supabase
        .from('clients')
        .select('id, name, contact, phone, location, equipment, specs, notes, converted_from, converted_at, created_at, engineer_id, engineers(full_name)')
        .order('updated_at', { ascending: false });

      if (!isAdmin) {
        query = query.eq('engineer_id', engineerId);
      } else {
        const url = new URL(req.url, 'http://x');
        const filterEngId = url.searchParams.get('engineerId');
        if (filterEngId) query = query.eq('engineer_id', filterEngId);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Get product counts, categories, and low stock per client
      const clientIds = (data || []).map(c => c.id);
      let productSummary = {};
      let totalLowStock = 0;
      if (clientIds.length > 0) {
        const { data: products, error: pErr } = await supabase
          .from('client_products')
          .select('client_id, category, status')
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

      return res.status(200).json({ clients, totalLowStock });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const c = body?.client;
      if (!c?.id) return res.status(400).json({ error: 'Missing client.id' });
      if (!isValidId(c.id)) return res.status(400).json({ error: 'Invalid client.id' });

      // Check ownership on update
      const { data: existing } = await supabase
        .from('clients')
        .select('engineer_id')
        .eq('id', c.id)
        .single();

      if (existing && existing.engineer_id !== engineerId && !isAdmin) {
        return res.status(403).json({ error: 'Not your client' });
      }

      const { error } = await supabase
        .from('clients')
        .upsert({
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
        }, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      if (!isAdmin) {
        const { data: existing } = await supabase
          .from('clients')
          .select('engineer_id')
          .eq('id', id)
          .single();
        if (existing && existing.engineer_id !== engineerId) {
          return res.status(403).json({ error: 'Not your client' });
        }
      }

      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: 'Invalid request' });
    console.error('clients api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
