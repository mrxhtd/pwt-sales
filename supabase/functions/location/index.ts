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

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  const ip = getClientIp(req);

  try {
    const supabase = getSupabase();
    const url = new URL(req.url);

    // PATCH-ish — manage consent (also via POST with action=consent|revoke).
    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));

      if (body?.action === 'consent') {
        const { error } = await supabase
          .from('engineers')
          .update({
            location_consent_given: true,
            location_consent_at: new Date().toISOString(),
            location_consent_revoked_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.engineerId);
        if (error) throw error;
        await supabase.from('location_consent_log').insert({
          engineer_id: session.engineerId,
          action: 'granted',
          user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
        });
        audit({
          action: 'location_consent_granted',
          actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
        });
        return json({ ok: true, consent: true }, 200, cors);
      }

      if (body?.action === 'revoke') {
        // Revoke + clear stored location.
        const { error } = await supabase
          .from('engineers')
          .update({
            location_consent_given: false,
            location_consent_revoked_at: new Date().toISOString(),
            last_lat: null,
            last_lng: null,
            last_location_at: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', session.engineerId);
        if (error) throw error;
        await supabase.from('location_consent_log').insert({
          engineer_id: session.engineerId,
          action: 'revoked',
          user_agent: (req.headers.get('user-agent') || '').slice(0, 500),
        });
        audit({
          action: 'location_consent_revoked',
          actorId: session.engineerId, actorName: session.fullName, actorIp: ip,
        });
        return json({ ok: true, consent: false }, 200, cors);
      }

      const lat = parseFloat(body?.lat);
      const lng = parseFloat(body?.lng);
      if (!isFinite(lat) || !isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return json({ error: 'Invalid coordinates' }, 400, cors);
      }

      // Enforce consent server-side.
      const { data: eng } = await supabase
        .from('engineers')
        .select('location_consent_given')
        .eq('id', session.engineerId)
        .single();
      if (!eng?.location_consent_given) {
        return json({ error: 'Location consent required', needsConsent: true }, 403, cors);
      }

      const { error } = await supabase
        .from('engineers')
        .update({
          last_lat: lat,
          last_lng: lng,
          last_location_at: new Date().toISOString(),
        })
        .eq('id', session.engineerId);
      if (error) throw error;
      return json({ ok: true }, 200, cors);
    }

    if (req.method === 'GET') {
      if (url.searchParams.get('me') === '1') {
        const { data, error } = await supabase
          .from('engineers')
          .select('location_consent_given, location_consent_at')
          .eq('id', session.engineerId)
          .single();
        if (error) throw error;
        return json({
          consent: !!data?.location_consent_given,
          consentAt: data?.location_consent_at || null,
        }, 200, cors);
      }

      if (session.role !== 'admin') {
        return json({ error: 'Admin only' }, 403, cors);
      }

      const { data, error } = await supabase
        .from('engineers')
        .select('id, full_name, role, is_active, last_lat, last_lng, last_location_at, location_consent_given')
        .eq('is_active', true)
        .eq('location_consent_given', true)
        .not('last_lat', 'is', null);

      if (error) throw error;

      return json({
        locations: (data || []).map((e: any) => ({
          id: e.id,
          fullName: e.full_name,
          role: e.role,
          lat: e.last_lat,
          lng: e.last_lng,
          updatedAt: e.last_location_at,
        })),
      }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('location edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
