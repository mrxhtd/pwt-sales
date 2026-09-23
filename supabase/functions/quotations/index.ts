import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import { buildBarcode, cairoToday, cleanDriveUrl, locationCode } from './barcode.ts';

function resolveParent(leadId: string | null, clientId: string | null) {
  if (leadId && clientId) return { error: 'Provide leadId or clientId, not both' };
  if (leadId) return { table: 'leads', column: 'lead_id', id: leadId, isLead: true };
  if (clientId) return { table: 'clients', column: 'client_id', id: clientId, isLead: false };
  return { error: 'Missing leadId or clientId' };
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

function rowToQuotation(q: any) {
  return {
    id: q.id,
    number: q.number,
    engineerId: q.engineer_id,
    engineerName: q.engineers?.full_name || '',
    engineerCode: q.engineer_code,
    locationCode: q.location_code,
    issuedOn: q.issued_on,
    leadId: q.lead_id || '',
    clientId: q.client_id || '',
    createdAt: q.created_at,
    versions: (q.quotation_versions || [])
      .slice()
      .sort((a: any, b: any) => b.version - a.version)
      .map((v: any) => ({
        id: v.id,
        version: v.version,
        barcode: v.barcode,
        driveUrl: v.drive_url || '',
        note: v.note || '',
        createdAt: v.created_at,
      })),
  };
}

const SELECT_QUOTATION =
  'id, number, engineer_id, engineer_code, location_code, issued_on, lead_id, client_id, created_at,' +
  ' engineers(full_name), quotation_versions(id, version, barcode, drive_url, note, created_at)';

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const { engineerId, role } = session as any;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    // Load the parent row and check the caller is allowed to touch it.
    async function loadParent(parent: any) {
      const cols = parent.isLead ? 'engineer_id, location' : 'engineer_id, location, converted_from';
      const { data } = await supabase
        .from(parent.table).select(cols).eq('id', parent.id).single();
      if (!data) return { error: parent.isLead ? 'Lead not found' : 'Client not found', status: 404 };
      if (!isAdmin && (data as any).engineer_id !== engineerId) {
        return { error: 'Forbidden', status: 403 };
      }
      return { row: data as any };
    }

    if (req.method === 'GET') {
      const url = new URL(req.url);
      const parent = resolveParent(url.searchParams.get('leadId'), url.searchParams.get('clientId'));
      if (parent.error) return json({ error: parent.error }, 400, cors);

      const found = await loadParent(parent);
      if (found.error) return json({ error: found.error }, found.status, cors);

      // A client also shows the quotations raised while it was still a lead.
      let query = supabase.from('quotations').select(SELECT_QUOTATION);
      if (parent.isLead) {
        query = query.eq('lead_id', parent.id!);
      } else if (found.row.converted_from) {
        query = query.or(`client_id.eq.${parent.id},lead_id.eq.${found.row.converted_from}`);
      } else {
        query = query.eq('client_id', parent.id!);
      }

      const { data, error } = await query.order('number', { ascending: false });
      if (error) throw error;

      return json({ quotations: (data || []).map(rowToQuotation) }, 200, cors);
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const action = body?.action || 'create';

      // ── Save (or clear) the Drive link on one version ──
      if (action === 'link') {
        const versionId = String(body?.versionId || '');
        if (!versionId) return json({ error: 'Missing versionId' }, 400, cors);
        const driveUrl = cleanDriveUrl(body?.driveUrl);
        if (driveUrl === null) return json({ error: 'Drive link must be an https:// URL' }, 400, cors);

        const { data: ver } = await supabase
          .from('quotation_versions')
          .select('id, quotations(engineer_id)')
          .eq('id', versionId)
          .single();
        if (!ver) return json({ error: 'Version not found' }, 404, cors);
        if (!isAdmin && (ver as any).quotations?.engineer_id !== engineerId) {
          return json({ error: 'Forbidden' }, 403, cors);
        }

        const { error } = await supabase
          .from('quotation_versions').update({ drive_url: driveUrl }).eq('id', versionId);
        if (error) throw error;
        return json({ ok: true, driveUrl }, 200, cors);
      }

      // ── Add a version to an existing quotation ──
      if (action === 'version') {
        const quotationId = String(body?.quotationId || '');
        if (!quotationId) return json({ error: 'Missing quotationId' }, 400, cors);

        const { data: q } = await supabase
          .from('quotations')
          .select('id, number, engineer_id, engineer_code, location_code, issued_on')
          .eq('id', quotationId)
          .single();
        if (!q) return json({ error: 'Quotation not found' }, 404, cors);
        if (!isAdmin && q.engineer_id !== engineerId) return json({ error: 'Forbidden' }, 403, cors);

        const { data: last } = await supabase
          .from('quotation_versions')
          .select('version')
          .eq('quotation_id', quotationId)
          .order('version', { ascending: false })
          .limit(1);
        const nextVersion = ((last?.[0]?.version as number) || 0) + 1;
        if (nextVersion > 99) return json({ error: 'This quotation has reached version 99' }, 400, cors);

        const version = await insertVersion(supabase, q, nextVersion, engineerId, body?.note);
        if ((version as any).error) return json({ error: (version as any).error }, (version as any).status, cors);

        return json({ ok: true, version }, 200, cors);
      }

      // ── New quotation (always starts at version 01) ──
      const parent = resolveParent(body?.leadId ?? null, body?.clientId ?? null);
      if (parent.error) return json({ error: parent.error }, 400, cors);

      const found = await loadParent(parent);
      if (found.error) return json({ error: found.error }, found.status, cors);

      const locCode = locationCode(found.row.location);
      if (!locCode) {
        return json({
          error: parent.isLead
            ? 'Set a location on this lead before making a quotation'
            : 'Set a location on this client before making a quotation',
        }, 400, cors);
      }

      // The engineer number is part of the barcode, so it must exist first.
      const { data: eng } = await supabase
        .from('engineers').select('engineer_code').eq('id', engineerId).single();
      const engCode = eng?.engineer_code as number | null | undefined;
      if (!engCode) return json({ error: 'Your engineer number is not set — ask an admin' }, 400, cors);

      // Double-tap guard: a second identical request within 15s returns the
      // quotation the first one just made instead of burning another number.
      const since = new Date(Date.now() - 15000).toISOString();
      const { data: recent } = await supabase
        .from('quotations')
        .select(SELECT_QUOTATION)
        .eq(parent.column!, parent.id!)
        .eq('engineer_id', engineerId)
        .gte('created_at', since)
        .order('created_at', { ascending: false })
        .limit(1);
      if (recent?.[0]) {
        return json({ ok: true, duplicate: true, quotation: rowToQuotation(recent[0]) }, 200, cors);
      }

      const today = cairoToday();
      const id = 'quo_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { data: inserted, error: insertErr } = await supabase
        .from('quotations')
        .insert({
          id,
          engineer_id: engineerId,
          engineer_code: engCode,
          location_code: locCode,
          issued_on: today.iso,
          [parent.column!]: parent.id,
        })
        .select('id, number, engineer_id, engineer_code, location_code, issued_on')
        .single();
      if (insertErr) throw insertErr;

      const version = await insertVersion(supabase, inserted, 1, engineerId, body?.note);
      if ((version as any).error) {
        // Never leave a quotation without its first barcode.
        await supabase.from('quotations').delete().eq('id', id);
        return json({ error: (version as any).error }, (version as any).status, cors);
      }

      const { data: full } = await supabase
        .from('quotations').select(SELECT_QUOTATION).eq('id', id).single();

      return json({ ok: true, quotation: full ? rowToQuotation(full) : null }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('quotations function error:', err);
    const msg = (err as any)?.message || String(err);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return json({ error: 'setup_required' }, 503, cors);
    }
    return json({ error: 'Server error' }, 500, cors);
  }
});

// Inserts one version row. The (quotation_id, version) unique constraint is the
// real guard against two racing requests creating the same version number.
async function insertVersion(
  supabase: any,
  q: { id: string; number: number; engineer_code: number; location_code: number; issued_on: string },
  version: number,
  engineerId: string,
  rawNote: unknown,
) {
  const id = 'qvr_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const { data, error } = await supabase
    .from('quotation_versions')
    .insert({
      id,
      quotation_id: q.id,
      version,
      barcode: buildBarcode(q, version),
      note: String(rawNote ?? '').slice(0, 500),
      created_by: engineerId,
    })
    .select('id, version, barcode, drive_url, note, created_at')
    .single();

  if (error) {
    const msg = (error as any)?.message || '';
    if (msg.includes('duplicate key')) {
      return { error: 'That version was just created — reload the page', status: 409 };
    }
    throw error;
  }

  return {
    id: data.id,
    version: data.version,
    barcode: data.barcode,
    driveUrl: data.drive_url || '',
    note: data.note || '',
    createdAt: data.created_at,
  };
}
