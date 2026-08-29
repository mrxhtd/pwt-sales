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
    const leadId = body?.leadId;
    if (!leadId) return json({ error: 'Missing leadId' }, 400, cors);

    // Get the lead
    const { data: lead, error: sErr } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (sErr || !lead) return json({ error: 'Lead not found' }, 404, cors);

    // Verify ownership
    if (lead.engineer_id !== engineerId && !isAdmin) {
      return json({ error: 'Not your lead' }, 403, cors);
    }

    // Check status
    if (lead.status !== 'Closed Won') {
      return json({ error: 'Lead must be Closed Won to convert' }, 400, cors);
    }

    // Check if already converted
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('converted_from', leadId)
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
        engineer_id: lead.engineer_id,
        name: lead.name || '',
        contact: lead.contact || '',
        phone: lead.phone || '',
        location: lead.location || '',
        equipment: lead.equipment || '',
        specs: lead.specs || '',
        notes: lead.notes || '',
        converted_from: leadId,
        converted_at: now,
        created_at: now,
        updated_at: now,
      });

    if (cErr) throw cErr;

    // Re-point the lead's follow-up history at the new client BEFORE deleting the
    // lead. activities.lead_id is ON DELETE CASCADE, so skipping this would
    // silently destroy every follow-up logged against the lead.
    const { error: aErr } = await supabase
      .from('activities')
      .update({ client_id: clientId, lead_id: null })
      .eq('lead_id', leadId);
    if (aErr) {
      console.error('Warning: could not move follow-ups to the new client:', aErr);
    }

    // Remove the lead from leads — it's now a client
    const { error: dErr } = await supabase.from('leads').delete().eq('id', leadId);
    if (dErr) {
      // Client was created but lead delete failed — log but don't fail
      console.error('Warning: lead delete failed after conversion:', dErr);
    }

    return json({
      ok: true,
      clientId,
      client: {
        id: clientId,
        name: lead.name || '',
        contact: lead.contact || '',
        phone: lead.phone || '',
        location: lead.location || '',
        equipment: lead.equipment || '',
        specs: lead.specs || '',
        notes: lead.notes || '',
        convertedFrom: leadId,
        convertedAt: now,
        createdAt: now,
      },
    }, 200, cors);
  } catch (err) {
    console.error('convert edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
