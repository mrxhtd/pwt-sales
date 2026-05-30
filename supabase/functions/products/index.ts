import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

const MAX_FIELD = 2000;

function clamp(s: unknown, max = MAX_FIELD): string {
  return String(s ?? '').slice(0, max);
}
function validDate(d: unknown): string | null {
  if (!d || typeof d !== 'string') return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
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
    deletedAt: r.deleted_at || null,
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
    .select('engineer_id, deleted_at')
    .eq('id', clientId)
    .single();
  return !!data && data.deleted_at === null && data.engineer_id === engineerId;
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
      const clientId = url.searchParams.get('clientId');
      if (!clientId) return json({ error: 'Missing clientId' }, 400, cors);

      const owns = await verifyClientOwnership(supabase, clientId, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403, cors);

      const includeDeleted = url.searchParams.get('includeDeleted') === '1' && isAdmin;
      let q = supabase
        .from('client_products')
        .select('*')
        .eq('client_id', clientId)
        .order('category')
        .order('created_at', { ascending: false });
      if (!includeDeleted) q = q.is('deleted_at', null);
      const { data, error } = await q;
      if (error) throw error;
      return json({ products: (data || []).map(rowToProduct) }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json();

      if (body?.action === 'restore' && body?.id) {
        const id = String(body.id);
        const { data: prod } = await supabase
          .from('client_products').select('client_id, deleted_at').eq('id', id).single();
        if (!prod) return json({ error: 'Not found' }, 404, cors);
        const owns = await verifyClientOwnership(supabase, prod.client_id, engineerId, isAdmin);
        if (!owns) return json({ error: 'Not your client' }, 403, cors);
        const { error: rErr } = await supabase
          .from('client_products')
          .update({ deleted_at: null, updated_at: new Date().toISOString() })
          .eq('id', id);
        if (rErr) throw rErr;
        audit({
          action: 'product_restored',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'product', entityId: id,
        });
        return json({ ok: true }, 200, cors);
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

      const productId = p.id;
      const { data: existing } = productId
        ? await supabase.from('client_products').select('id, client_id, deleted_at').eq('id', productId).single()
        : { data: null };

      if (existing) {
        if (existing.deleted_at) {
          return json({ error: 'Product is deleted; restore first' }, 409, cors);
        }
        const { error } = await supabase
          .from('client_products')
          .update({
            category: p.category || 'boilers',
            product_name: clamp(p.productName),
            model: clamp(p.model, 500),
            quantity: Math.min(Math.max(parseInt(p.quantity) || 1, 1), 99999),
            install_date: validDate(p.installDate),
            next_maintenance_date: validDate(p.nextMaintenanceDate),
            status: p.status || 'active',
            notes: clamp(p.notes, 5000),
            updated_at: new Date().toISOString(),
          })
          .eq('id', productId);
        if (error) throw error;
      } else {
        const newId = crypto.randomUUID();
        const { error } = await supabase
          .from('client_products')
          .insert({
            id: newId,
            client_id: p.clientId,
            category: p.category || 'boilers',
            product_name: clamp(p.productName),
            model: clamp(p.model, 500),
            quantity: Math.min(Math.max(parseInt(p.quantity) || 1, 1), 99999),
            install_date: validDate(p.installDate),
            next_maintenance_date: validDate(p.nextMaintenanceDate),
            status: p.status || 'active',
            notes: clamp(p.notes, 5000),
            updated_at: new Date().toISOString(),
          });
        if (error) throw error;
        audit({
          action: 'product_created',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'product', entityId: newId,
          after: { clientId: p.clientId, name: p.productName },
        });
        return json({ ok: true, id: newId }, 200, cors);
      }

      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'DELETE') {
      const id = url.searchParams.get('id');
      if (!id) return json({ error: 'Missing id' }, 400, cors);
      const hard = url.searchParams.get('hard') === '1' && isAdmin;

      const { data: product } = await supabase
        .from('client_products')
        .select('id, client_id, product_name, deleted_at')
        .eq('id', id)
        .single();
      if (!product) return json({ ok: true }, 200, cors);

      const owns = await verifyClientOwnership(supabase, product.client_id, engineerId, isAdmin);
      if (!owns) return json({ error: 'Not your client' }, 403, cors);

      if (hard) {
        const { error } = await supabase.from('client_products').delete().eq('id', id);
        if (error) throw error;
        audit({
          action: 'product_purged',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'product', entityId: id,
          before: product,
        });
      } else {
        const { error } = await supabase
          .from('client_products')
          .update({ deleted_at: new Date().toISOString() })
          .eq('id', id);
        if (error) throw error;
        audit({
          action: 'product_deleted',
          actorId: engineerId, actorName: fullName, actorIp: ip,
          entityType: 'product', entityId: id,
          before: { name: product.product_name, clientId: product.client_id },
        });
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('products edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
