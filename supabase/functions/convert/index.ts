import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { notifyAdmins } from '../_shared/push.ts';
import { audit, getClientIp } from '../_shared/audit.ts';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, cors);
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const { engineerId, role, fullName } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();
    const body = await req.json();
    const siteId = body?.siteId;
    if (!siteId) return json({ error: 'Missing siteId' }, 400, cors);

    // Atomic conversion: insert client + soft-delete site in one transaction.
    const { data, error } = await supabase.rpc('convert_site_to_client', {
      p_site_id: siteId,
      p_acting_engineer_id: engineerId,
      p_is_admin: isAdmin,
    });

    if (error) {
      const msg = String(error.message || '');
      if (msg.includes('site_not_found')) return json({ error: 'Site not found' }, 404, cors);
      if (msg.includes('site_deleted')) return json({ error: 'Site no longer exists' }, 404, cors);
      if (msg.includes('forbidden')) return json({ error: 'Not your site' }, 403, cors);
      if (msg.includes('not_closed_won')) return json({ error: 'Site must be Closed Won to convert' }, 400, cors);
      const alreadyMatch = msg.match(/already_converted:([^"\s]+)/);
      if (alreadyMatch) {
        return json({ error: 'Already converted', clientId: alreadyMatch[1] }, 400, cors);
      }
      console.error('convert RPC error:', error);
      return json({ error: 'Server error' }, 500, cors);
    }

    const row = Array.isArray(data) ? data[0] : data;
    if (!row) {
      return json({ error: 'Conversion returned no data' }, 500, cors);
    }

    const clientId = row.client_id;

    audit({
      action: 'site_converted',
      actorId: engineerId,
      actorName: fullName,
      actorIp: getClientIp(req),
      entityType: 'site',
      entityId: siteId,
      after: { clientId },
    });

    notifyAdmins({
      title: `Win Closed: ${(row.client_name || 'Client').slice(0, 80)}`,
      body: `${fullName} converted a lead to client`,
      tag: `conversion-${clientId}`,
      url: `/#customer/${clientId}`,
      excludeEngineerId: engineerId,
    }).catch(err => console.error('Admin notify failed:', err));

    return json({
      ok: true,
      clientId,
      client: {
        id: clientId,
        name: row.client_name || '',
        contact: row.client_contact || '',
        phone: row.client_phone || '',
        location: row.client_location || '',
        equipment: row.client_equipment || '',
        specs: row.client_specs || '',
        notes: row.client_notes || '',
        engineerId: row.client_engineer_id || '',
        engineerName: row.client_engineer_name || '',
        convertedFrom: siteId,
        convertedAt: row.client_converted_at,
        createdAt: row.client_created_at,
      },
    }, 200, cors);
  } catch (err) {
    console.error('convert edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
