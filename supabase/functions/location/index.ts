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

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);

  try {
    const supabase = getSupabase();

    // POST — engineer updates their location
    if (req.method === 'POST') {
      const body = await req.json();
      const lat = parseFloat(body?.lat);
      const lng = parseFloat(body?.lng);

      console.log(`[location POST] engineer=${session.engineerId} (${session.fullName}) lat=${lat} lng=${lng}`);

      if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
        return json({ error: 'Invalid coordinates' }, 400, cors);
      }

      const { data: updated, error } = await supabase
        .from('engineers')
        .update({
          last_lat: lat,
          last_lng: lng,
          last_location_at: new Date().toISOString(),
        })
        .eq('id', session.engineerId)
        .select('id, last_lat, last_lng');

      if (error) {
        console.error(`[location POST] DB error for ${session.engineerId}:`, error);
        throw error;
      }
      console.log(`[location POST] updated rows:`, updated?.length ?? 0);
      return json({ ok: true }, 200, cors);
    }

    // GET — admin fetches all engineer locations
    if (req.method === 'GET') {
      if (session.role !== 'admin') {
        return json({ error: 'Admin only' }, 403, cors);
      }

      const { data, error } = await supabase
        .from('engineers')
        .select('id, full_name, role, is_active, last_lat, last_lng, last_location_at')
        .eq('is_active', true)
        .not('last_lat', 'is', null);

      if (error) throw error;
      console.log(`[location GET] found ${data?.length ?? 0} engineers with locations`);

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
