import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401);

  const supabase = getSupabase();

  try {
    // POST — save or update push subscription
    if (req.method === 'POST') {
      const body = await req.json();
      const subscription = body?.subscription;
      if (!subscription?.endpoint) {
        return json({ error: 'Invalid subscription' }, 400);
      }

      // Upsert by engineer_id + endpoint
      const { error } = await supabase
        .from('push_subscriptions')
        .upsert(
          {
            engineer_id: session.engineerId,
            endpoint: subscription.endpoint,
            keys_p256dh: subscription.keys?.p256dh || '',
            keys_auth: subscription.keys?.auth || '',
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'engineer_id,endpoint' }
        );

      if (error) throw error;
      return json({ ok: true });
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
        // Delete all subscriptions for this engineer
        await supabase
          .from('push_subscriptions')
          .delete()
          .eq('engineer_id', session.engineerId);
      }
      return json({ ok: true });
    }

    return json({ error: 'Method not allowed' }, 405);
  } catch (err) {
    console.error('subscribe error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
