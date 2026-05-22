import { corsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = 'mailto:admin@pwtinternational.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

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

  // This function is called by pg_cron or manually — verify with a secret header
  const authHeader = req.headers.get('authorization') || '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';

  // Allow calls from: service role key, cron secret, or Supabase internal (pg_net)
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (token !== serviceKey && token !== cronSecret && !authHeader.includes(serviceKey)) {
    return json({ error: 'Unauthorized' }, 401);
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    // Format dates for comparison (due_date is a DATE column, not timestamp)
    const todayStr = now.toISOString().slice(0, 10);
    const tomorrowStr = in12h.toISOString().slice(0, 10);

    // Find leads with due dates that are today or tomorrow (covers the 12h window)
    // and haven't been notified yet for this due date
    const { data: leads, error: lErr } = await supabase
      .from('sites')
      .select('id, name, due_date, next_action, engineer_id, status')
      .gte('due_date', todayStr)
      .lte('due_date', tomorrowStr)
      .not('status', 'eq', 'Closed Won');

    if (lErr) throw lErr;
    if (!leads || leads.length === 0) {
      return json({ ok: true, sent: 0, message: 'No upcoming due dates' });
    }

    // Check which leads have already been notified
    const leadIds = leads.map((l: any) => l.id);
    const { data: alreadyNotified } = await supabase
      .from('notification_log')
      .select('site_id')
      .in('site_id', leadIds)
      .gte('sent_at', todayStr + 'T00:00:00Z');

    const notifiedSet = new Set((alreadyNotified || []).map((n: any) => n.site_id));
    const toNotify = leads.filter((l: any) => !notifiedSet.has(l.id));

    if (toNotify.length === 0) {
      return json({ ok: true, sent: 0, message: 'All already notified' });
    }

    // Group leads by engineer
    const byEngineer: Record<string, any[]> = {};
    for (const lead of toNotify) {
      if (!byEngineer[lead.engineer_id]) byEngineer[lead.engineer_id] = [];
      byEngineer[lead.engineer_id].push(lead);
    }

    let totalSent = 0;
    const errors: string[] = [];

    for (const [engineerId, engineerLeads] of Object.entries(byEngineer)) {
      // Get push subscriptions for this engineer
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys_p256dh, keys_auth')
        .eq('engineer_id', engineerId);

      if (!subs || subs.length === 0) continue;

      for (const lead of engineerLeads) {
        const dueDate = new Date(lead.due_date);
        const hoursUntil = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60));
        const timeLabel = hoursUntil <= 0 ? 'today' : `in ${hoursUntil}h`;

        const payload = JSON.stringify({
          title: `Due ${timeLabel}: ${lead.name}`,
          body: lead.next_action
            ? `Action: ${lead.next_action}`
            : `Lead "${lead.name}" is due ${timeLabel}`,
          tag: `due-${lead.id}`,
          url: `/#lead/${lead.id}`,
        });

        for (const sub of subs) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth },
              },
              payload
            );
            totalSent++;
          } catch (pushErr: any) {
            // If subscription expired/invalid, remove it
            if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
              await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', sub.endpoint);
            }
            errors.push(`${sub.endpoint.slice(-20)}: ${pushErr?.message || pushErr}`);
          }
        }

        // Log that we notified for this lead today
        await supabase.from('notification_log').insert({
          site_id: lead.id,
          engineer_id: engineerId,
          sent_at: now.toISOString(),
        });
      }
    }

    return json({
      ok: true,
      sent: totalSent,
      leadsNotified: toNotify.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err) {
    console.error('notify error:', err);
    return json({ error: 'Server error' }, 500);
  }
});
