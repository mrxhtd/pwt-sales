import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        .from('clients')
        .select('id, name, contact, phone, location, equipment, specs, notes, converted_from, converted_at, created_at, engineer_id, engineers(full_name)')
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

      // Get product counts, categories, and low stock per client
      const clientIds = (data || []).map((c: any) => c.id);
      const productSummary: Record<string, { count: number; lowStock: number; cats: Set<string> }> = {};
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

      const clients = (data || []).map((r: any) => {
        const summary = productSummary[r.id] || { count: 0, lowStock: 0, cats: new Set() };
        return rowToClient({
          ...r,
          product_count: summary.count,
          low_stock_count: summary.lowStock,
          categories: [...summary.cats],
        });
      });

      return json({ clients, totalLowStock });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const c = body?.client;
      if (!c?.id) return json({ error: 'Missing client.id' }, 400);

      const { data: existing } = await supabase
        .from('clients')
        .select('engineer_id')
        .eq('id', c.id)
        .single();

      if (existing && existing.engineer_id !== engineerId && !isAdmin) {
        return json({ error: 'Not your client' }, 403);
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
      return json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400);

      if (!isAdmin) {
        const { data: existing } = await supabase
          .from('clients')
          .select('engineer_id')
          .eq('id', id)
          .single();
        if (existing && existing.engineer_id !== engineerId) {
          return json({ error: 'Not your client' }, 403);
        }
      }

      const { error } = await supabase.from('clients').delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('clients edge function error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
