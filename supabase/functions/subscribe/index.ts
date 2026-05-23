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

  const supabase = getSupabase();

  try {
    // POST — save or update push subscription
    if (req.method === 'POST') {
      const body = await req.json();
      const subscription = body?.subscription;
      if (!subscription?.endpoint) {
        return json({ error: 'Invalid subscription' }, 400, cors);
      }

      // Validate endpoint is a valid URL
      try {
        new URL(subscription.endpoint);
      } catch {
        return json({ error: 'Invalid endpoint URL' }, 400, cors);
      }

      // Limit endpoint length
      if (subscription.endpoint.length > 2000) {
        return json({ error: 'Endpoint too long' }, 400, cors);
      }

      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            engineer_id: session.engineerId,
            endpoint: subscription.endpoint,
            keys_p256dh: (subscription.keys?.p256dh || '').slice(0, 500),
            keys_auth: (subscription.keys?.auth || '').slice(0, 500),
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'engineer_id,endpoint' }
        );

      if (error) throw error;
      return json({ ok: true }, 200, cors);
    }

    // DELETE — remove push subscription
    if (req.method === 'DELETE') {
      const body = await req.json();
      const endpoint = body?.endpoint;
      if (endpoint) {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('engineer_id', session.engineerId)
          .eq('endpoint', endpoint);
      } else {
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('engineer_id', session.engineerId);
      }
      return json({ ok: true }, 200, cors);
    }

    return json({ error: 'Method not allowed' }, 405, cors);
  } catch (err) {
    console.error('subscribe error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
