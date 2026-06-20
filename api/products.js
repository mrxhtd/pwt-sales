import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { readBody, isValidId } from '../lib/http.js';

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
        .order('category')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return res.status(200).json({ products: (data || []).map(rowToProduct) });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const p = body?.product;
      if (!p?.id || !p?.clientId) return res.status(400).json({ error: 'Missing product.id or product.clientId' });
      if (!isValidId(p.id) || !isValidId(p.clientId)) return res.status(400).json({ error: 'Invalid product.id or product.clientId' });

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
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      // Verify ownership via join
      if (!isAdmin) {
        const { data: product } = await supabase
          .from('client_products')
          .select('client_id')
          .eq('id', id)
          .single();
        if (product) {
          const owns = await verifyClientOwnership(supabase, product.client_id, engineerId, isAdmin);
          if (!owns) return res.status(403).json({ error: 'Not your client' });
        }
      }

      const { error } = await supabase.from('client_products').delete().eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: 'Invalid request' });
    console.error('products api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
