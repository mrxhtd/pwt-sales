import webpush from 'npm:web-push@3.6.7';
import { getSupabase } from './db.ts';

webpush.setVapidDetails(
  'mailto:admin@pwtinternational.com',
  Deno.env.get('VAPID_PUBLIC_KEY') || '',
  Deno.env.get('VAPID_PRIVATE_KEY') || '',
);

export async function notifyAdmins(options: {
  title: string;
  body: string;
  tag: string;
  url: string;
  excludeEngineerId?: string;
}): Promise<void> {
  const supabase = getSupabase();

  // 1. Find all active admins (excluding the acting user)
  let q = supabase.from('engineers').select('id').eq('role', 'admin').eq('is_active', true);
  if (options.excludeEngineerId) q = q.neq('id', options.excludeEngineerId);
  const { data: admins } = await q;
  if (!admins?.length) return;

  const adminIds = admins.map((a: any) => a.id);

  // 2. Get their push subscriptions
  const { data: subs } = await supabase
    .from('push_subscriptions')
    .select('id, endpoint, keys_p256dh, keys_auth')
    .in('engineer_id', adminIds);
  if (!subs?.length) return;

  // 3. Send to each subscription, clean up stale ones
  const payload = JSON.stringify({
    title: options.title,
    body: options.body,
    tag: options.tag,
    url: options.url,
  });

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
        payload,
      );
    } catch (err: any) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        await supabase.from('push_subscriptions').delete().eq('id', sub.id);
      } else {
        console.error('Push send failed:', err.message);
      }
    }
  }
}
