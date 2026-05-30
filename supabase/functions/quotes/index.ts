// Quote numbering + storage.
//   GET  /quotes                — list latest quotes for the caller (admin sees all)
//   POST /quotes  action=number — atomically allocate the next offer number
//   POST /quotes                — store a generated quote { offerNumber, clientId, clientName, totalPiastres, payload }
import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const supabase = getSupabase();
  const ip = getClientIp(req);

  try {
    if (req.method === 'GET') {
      const url = new URL(req.url);
      const limit = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit') || '50')));
      let q = supabase
        .from('quotes')
        .select('id, offer_number, engineer_id, client_id, client_name, total_piastres, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (session.role !== 'admin') q = q.eq('engineer_id', session.engineerId);
      const { data, error } = await q;
      if (error) throw error;
      return json({
        quotes: (data || []).map((r: any) => ({
          id: r.id,
          offerNumber: r.offer_number,
          engineerId: r.engineer_id,
          clientId: r.client_id,
          clientName: r.client_name,
          totalPiastres: r.total_piastres,
          createdAt: r.created_at,
        })),
      }, 200, cors);
    }

    if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, cors);

    const body = await req.json().catch(() => ({}));

    if (body?.action === 'number') {
      const { data, error } = await supabase.rpc('next_offer_number');
      if (error) throw error;
      return json({ offerNumber: data }, 200, cors);
    }

    const offerNumber = String(body?.offerNumber || '').slice(0, 50);
    if (!offerNumber) return json({ error: 'Missing offerNumber' }, 400, cors);

    const clientId = body?.clientId ? String(body.clientId).slice(0, 50) : null;
    const clientName = String(body?.clientName || '').slice(0, 500);
    const totalPiastres = Math.max(0, Math.floor(Number(body?.totalPiastres) || 0));
    const payload = body?.payload && typeof body.payload === 'object' ? body.payload : {};

    if (clientId) {
      const { data: client } = await supabase
        .from('clients').select('engineer_id, deleted_at').eq('id', clientId).single();
      if (client && client.deleted_at === null && client.engineer_id !== session.engineerId && session.role !== 'admin') {
        return json({ error: 'Not your client' }, 403, cors);
      }
    }

    const { data, error } = await supabase
      .from('quotes')
      .insert({
        offer_number: offerNumber,
        engineer_id: session.engineerId,
        client_id: clientId,
        client_name: clientName,
        total_piastres: totalPiastres,
        payload,
      })
      .select('id')
      .single();

    if (error) {
      // Duplicate offer numbers collide on the UNIQUE index — return 409.
      if (String(error.message || '').includes('duplicate key')) {
        return json({ error: 'Offer number already used' }, 409, cors);
      }
      throw error;
    }

    audit({
      action: 'quote_saved',
      actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
      entityType: 'quote', entityId: String(data.id),
      after: { offerNumber, clientId, totalPiastres },
    });

    return json({ ok: true, id: data.id }, 200, cors);
  } catch (err) {
    console.error('quotes edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
