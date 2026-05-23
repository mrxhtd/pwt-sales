import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

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

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();
    const body = await req.json();
    const siteId = body?.siteId;
    if (!siteId) return json({ error: 'Missing siteId' }, 400, cors);

    // Get the site
    const { data: site, error: sErr } = await supabase
      .from('sites')
      .select('*')
      .eq('id', siteId)
      .single();

    if (sErr || !site) return json({ error: 'Site not found' }, 404, cors);

    // Verify ownership
    if (site.engineer_id !== engineerId && !isAdmin) {
      return json({ error: 'Not your site' }, 403, cors);
    }

    // Check status
    if (site.status !== 'Closed Won') {
      return json({ error: 'Site must be Closed Won to convert' }, 400, cors);
    }

    // Check if already converted
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('converted_from', siteId)
      .single();

    if (existing) {
      return json({ error: 'Already converted', clientId: existing.id }, 400, cors);
    }

    // Create client with server-generated ID
    const clientId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: cErr } = await supabase
      .from('clients')
      .insert({
        id: clientId,
        engineer_id: site.engineer_id,
        name: site.name || '',
        contact: site.contact || '',
        phone: site.phone || '',
        location: site.location || '',
        equipment: site.equipment || '',
        specs: site.specs || '',
        notes: site.notes || '',
        converted_from: siteId,
        converted_at: now,
        created_at: now,
        updated_at: now,
      });

    if (cErr) throw cErr;

    // Remove the lead from sites — it's now a client
    const { error: dErr } = await supabase.from('sites').delete().eq('id', siteId);
    if (dErr) {
      // Client was created but site delete failed — log but don't fail
      console.error('Warning: site delete failed after conversion:', dErr);
    }

    return json({
      ok: true,
      clientId,
      client: {
        id: clientId,
        name: site.name || '',
        contact: site.contact || '',
        phone: site.phone || '',
        location: site.location || '',
        equipment: site.equipment || '',
        specs: site.specs || '',
        notes: site.notes || '',
        convertedFrom: siteId,
        convertedAt: now,
        createdAt: now,
      },
    }, 200, cors);
  } catch (err) {
    console.error('convert edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
