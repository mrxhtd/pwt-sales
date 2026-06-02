import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { audit } from '../lib/audit.js';

// NOTE: legacy Vercel backend; the live frontend uses the Supabase Edge Functions.
export const config = { maxDuration: 30 };

function rowToProduct(r) {
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

/** Check if the engineer owns the client (or is admin) */
async function verifyClientOwnership(supabase, clientId, engineerId, isAdmin) {
  if (isAdmin) return true;
  const { data } = await supabase
    .from('clients')
    .select('engineer_id')
    .eq('id', clientId)
    .is('deleted_at', null)
    .single();
  return data && data.engineer_id === engineerId;
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
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return res.status(400).json({ error: 'Missing clientId' });

      // Verify ownership
      const owns = await verifyClientOwnership(supabase, clientId, engineerId, isAdmin);
      if (!owns) return res.status(403).json({ error: 'Not your client' });

      const { data, error } = await supabase
        .from('client_products')
        .select('*')
        .eq('client_id', clientId)
        .is('deleted_at', null)
        .order('category')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ products: (data || []).map(rowToProduct) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;

      // RESTORE a soft-deleted product (admin only)
      if (body?.restore) {
        if (!isAdmin) return res.status(403).json({ error: 'Admin only' });
        const { data: dead } = await supabase.from('client_products').select('*').eq('id', body.restore).single();
        if (!dead) return res.status(404).json({ error: 'Product not found' });
        const { error } = await supabase.from('client_products')
          .update({ deleted_at: null, updated_at: new Date().toISOString() }).eq('id', body.restore);
        if (error) throw error;
        await audit(supabase, { table: 'client_products', rowId: body.restore, action: 'restore', session, before: dead });
        return res.status(200).json({ ok: true, id: body.restore });
      }

      const p = body?.product;
      if (!p?.id || !p?.clientId) return res.status(400).json({ error: 'Missing product.id or product.clientId' });

      // Validate category and status
      const VALID_CATS = ['boilers', 'cooling_towers', 'chillers', 'swimming_pools'];
      if (p.category && !VALID_CATS.includes(p.category)) {
        return res.status(400).json({ error: 'Invalid category' });
      }
      const VALID_STATUSES = ['active', 'running_out_of_stock'];
      if (p.status && !VALID_STATUSES.includes(p.status)) {
        return res.status(400).json({ error: 'Invalid status' });
      }

      // Verify client ownership
      const owns = await verifyClientOwnership(supabase, p.clientId, engineerId, isAdmin);
      if (!owns) return res.status(403).json({ error: 'Not your client' });

      const { data: existing } = await supabase
        .from('client_products').select('*').eq('id', p.id).is('deleted_at', null).single();

      const record = {
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
      };
      const { error } = await supabase.from('client_products').upsert(record, { onConflict: 'id' });
      if (error) throw error;
      await audit(supabase, {
        table: 'client_products', rowId: p.id, action: existing ? 'update' : 'insert',
        session, before: existing || null, after: record,
      });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      const { data: product } = await supabase
        .from('client_products').select('*').eq('id', id).is('deleted_at', null).single();
      if (!product) return res.status(200).json({ ok: true }); // already gone — idempotent
      if (!isAdmin) {
        const owns = await verifyClientOwnership(supabase, product.client_id, engineerId, isAdmin);
        if (!owns) return res.status(403).json({ error: 'Not your client' });
      }

      const { error } = await supabase.from('client_products')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', id);
      if (error) throw error;
      await audit(supabase, { table: 'client_products', rowId: id, action: 'delete', session, before: product });
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('products api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
