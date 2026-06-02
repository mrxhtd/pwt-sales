import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit } from '../_shared/audit.ts';

const MAX_FIELD = 2000;
function clamp(s: string, max = MAX_FIELD): string {
  return (s || '').slice(0, max);
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
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
    .is('deleted_at', null)
    .single();
  return data && data.engineer_id === engineerId;
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
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json({ error: 'Missing clientId' }, 400, cors);

      const owns = await verifyClientOwnership(supabase, clientId, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403, cors);

      const { data, error } = await supabase
        .from('client_products')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('category')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return json({ products: (data || []).map(rowToProduct) }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      // RESTORE a soft-deleted product (admin only)
      if (body?.restore) {
        if (!isAdmin) return json({ error: 'Admin only' }, 403, cors);
        const { data: dead } = await supabase
          .from('client_products').select('*').eq('id', body.restore).single();
        if (!dead) return json({ error: 'Product not found' }, 404, cors);
        const { error } = await supabase
          .from('client_products')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', body.restore);
        if (error) throw error;
        await audit(supabase, { table: 'client_products', rowId: body.restore, action: 'restore', session, before: dead });
        return json({ ok: true, id: body.restore }, 200, cors);
      }

      const p = body?.product;
      if (!p?.clientId) return json({ error: 'Missing product.clientId' }, 400, cors);

      if (p.category && !VALID_CATS.includes(p.category)) {
        return json({ error: 'Invalid category' }, 400, cors);
      }
      if (p.status && !VALID_STATUSES.includes(p.status)) {
        return json({ error: 'Invalid status' }, 400, cors);
      }

      const owns = await verifyClientOwnership(supabase, p.clientId, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403, cors);

      // Check if product exists — separate insert vs update (ignore soft-deleted)
      const productId = p.id;
      const { data: existing } = productId
        ? await supabase.from('client_products').select('*').eq('id', productId).is('deleted_at', null).single()
        : { data: null };

      if (existing) {
        // UPDATE
        const patch = {
          category: p.category || 'boilers',
          product_name: clamp(p.productName),
          model: clamp(p.model, 500),
          quantity: Math.min(Math.max(parseInt(p.quantity) || 1, 1), 99999),
          install_date: p.installDate || null,
          next_maintenance_date: p.nextMaintenanceDate || null,
          status: p.status || 'active',
          notes: clamp(p.notes, 5000),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('client_products').update(patch).eq('id', productId);
        if (error) throw error;
        await audit(supabase, { table: 'client_products', rowId: productId, action: 'update', session, before: existing, after: patch });
      } else {
        // INSERT — server generates ID
        const newId = crypto.randomUUID();
        const record = {
          id: newId,
          client_id: p.clientId,
          category: p.category || 'boilers',
          product_name: clamp(p.productName),
          model: clamp(p.model, 500),
          quantity: Math.min(Math.max(parseInt(p.quantity) || 1, 1), 99999),
          install_date: p.installDate || null,
          next_maintenance_date: p.nextMaintenanceDate || null,
          status: p.status || 'active',
          notes: clamp(p.notes, 5000),
          updated_at: new Date().toISOString(),
        };
        const { error } = await supabase.from('client_products').insert(record);
        if (error) throw error;
        await audit(supabase, { table: 'client_products', rowId: newId, action: 'insert', session, after: record });
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url);
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);

      const { data: product } = await supabase
        .from('client_products').select('*').eq('id', id).is('deleted_at', null).single();
      if (!product) return json({ ok: true }, 200, cors); // already gone — idempotent
      if (!isAdmin) {
        const owns = await verifyClientOwnership(supabase, product.client_id, engineerId, isAdmin);
        if (!owns) return json({ error: 'Not your client' }, 403, cors);
      }

      const { error } = await supabase
        .from('client_products')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await audit(supabase, { table: 'client_products', rowId: id, action: 'delete', session, before: product });
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('products edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
