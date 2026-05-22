import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function rowToProduct(r: any) {
  return {
    id: r.id,
    clientId: r.client_id,
    category: r.category || '',
    productName: r.product_name || '',
    model: r.model || '',
    quantity: r.quantity || 1,
    installDate: r.install_date || '',
    nextMaintenanceDate: r.next_maintenance_date || '',
    status: r.status || 'active',
    notes: r.notes || '',
    createdAt: r.created_at || '',
  };
}

const VALID_CATS = ['boilers', 'cooling_towers', 'chillers', 'swimming_pools'];
const VALID_STATUSES = ['active', 'running_out_of_stock'];

async function verifyClientOwnership(
  supabase: any, clientId: string, engineerId: string, isAdmin: boolean,
): Promise<boolean> {
  if (isAdmin) return true;
  const { data } = await supabase
    .from('clients')
    .select('engineer_id')
    .eq('id', clientId)
    .single();
  return data && data.engineer_id === engineerId;
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
      const url = new URL(req.url);
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json({ error: 'Missing clientId' }, 400);

      const owns = await verifyClientOwnership(supabase, clientId, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403);

      const { data, error } = await supabase
        .from('client_products')
        .select('*')
        .eq('client_id', clientId)
        .order('category')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ products: (data || []).map(rowToProduct) });
    }

    if (req.method === 'POST') {
      const body = await req.json();
      const p = body?.product;
      if (!p?.id || !p?.clientId) return json({ error: 'Missing product.id or product.clientId' }, 400);

      if (p.category && !VALID_CATS.includes(p.category)) {
        return json({ error: 'Invalid category' }, 400);
      }
      if (p.status && !VALID_STATUSES.includes(p.status)) {
        return json({ error: 'Invalid status' }, 400);
      }

      const owns = await verifyClientOwnership(supabase, p.clientId, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403);

      const { error } = await supabase
        .from('client_products')
        .upsert({
          id: p.id,
          client_id: p.clientId,
          category: p.category || 'boilers',
          product_name: p.productName || '',
          model: p.model || '',
          quantity: p.quantity || 1,
          install_date: p.installDate || null,
          next_maintenance_date: p.nextMaintenanceDate || null,
          status: p.status || 'active',
          notes: p.notes || '',
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
        const { data: product } = await supabase
          .from('client_products')
          .select('client_id')
          .eq('id', id)
          .single();
        if (product) {
          const owns = await verifyClientOwnership(supabase, product.client_id, engineerId, isAdmin);
          if (!owns) return json({ error: 'Not your client' }, 403);
        }
      }

      const { error } = await supabase.from('client_products').delete().eq('id', id);
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('products edge function error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
