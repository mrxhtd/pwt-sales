import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || '';
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '';
const VAPID_SUBJECT = 'mailto:admin@pwtinternational.com';

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// Timing-safe comparison to prevent timing attacks
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const encoder = new TextEncoder();
  const aBuf = encoder.encode(a);
  const bBuf = encoder.encode(b);
  let result = 0;
  for (let i = 0; i < aBuf.length; i++) {
    result |= aBuf[i] ^ bBuf[i];
  }
  return result === 0;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors });
  }

  // Authenticate: only service role key or cron secret allowed
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  const cronSecret = Deno.env.get('CRON_SECRET') || '';

  const isServiceRole = token.length > 0 && serviceKey.length > 0 && safeCompare(token, serviceKey);
  const isCron = token.length > 0 && cronSecret.length > 0 && safeCompare(token, cronSecret);

  if (!isServiceRole && !isCron) {
    return json({ error: 'Unauthorized' }, 401, cors);
  }

  try {
    const supabase = getSupabase();
    const now = new Date();
    const in12h = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    const todayStr = now.toISOString().slice(0, 10);
    const tomorrowStr = in12h.toISOString().slice(0, 10);

    // Find leads with due dates in the next 12 hours that haven't been notified
    const { data: leads, error: lErr } = await supabase
      .from('sites')
      .select('id, name, due_date, next_action, engineer_id, status')
      .gte('due_date', todayStr)
      .lte('due_date', tomorrowStr)
      .not('status', 'eq', 'Closed Won');

    if (lErr) throw lErr;
    if (!leads || leads.length === 0) {
      return json({ ok: true, sent: 0, message: 'No upcoming due dates' }, 200, cors);
    }

    // Check which leads have already been notified today
    const leadIds = leads.map((l: any) => l.id);
    const { data: alreadyNotified } = await supabase
      .from('notification_log')
      .select('site_id')
      .in('site_id', leadIds)
      .gte('sent_at', todayStr + 'T00:00:00Z');

    const notifiedSet = new Set((alreadyNotified || []).map((n: any) => n.site_id));
    const toNotify = leads.filter((l: any) => !notifiedSet.has(l.id));

    if (toNotify.length === 0) {
      return json({ ok: true, sent: 0, message: 'All already notified' }, 200, cors);
    }

    // Group leads by engineer
    const byEngineer: Record<string, any[]> = {};
    for (const lead of toNotify) {
      if (!byEngineer[lead.engineer_id]) byEngineer[lead.engineer_id] = [];
      byEngineer[lead.engineer_id].push(lead);
    }

    let totalSent = 0;
    const errors: string[] = [];

    for (const [engId, engineerLeads] of Object.entries(byEngineer)) {
      const { data: subs } = await supabase
        .from('push_subscriptions')
        .select('endpoint, keys_p256dh, keys_auth')
        .eq('engineer_id', engId);

      if (!subs || subs.length === 0) continue;

      for (const lead of engineerLeads) {
        const dueDate = new Date(lead.due_date);
        const hoursUntil = Math.round((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60));
        const timeLabel = hoursUntil <= 0 ? 'today' : `in ${hoursUntil}h`;

        const payload = JSON.stringify({
          title: `Due ${timeLabel}: ${(lead.name || 'Lead').slice(0, 100)}`,
          body: lead.next_action
            ? `Action: ${lead.next_action.slice(0, 200)}`
            : `Lead is due ${timeLabel}`,
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
            if (pushErr?.statusCode === 410 || pushErr?.statusCode === 404) {
              await supabase
                .from('push_subscriptions')
                .delete()
                .eq('endpoint', sub.endpoint);
            }
            errors.push(`push failed: ${pushErr?.statusCode || 'unknown'}`);
          }
        }

        // Log notification
        await supabase.from('notification_log').insert({
          site_id: lead.id,
          engineer_id: engId,
          sent_at: now.toISOString(),
        });
      }
    }

    return json({
      ok: true,
      sent: totalSent,
      leadsNotified: toNotify.length,
      errors: errors.length > 0 ? errors : undefined,
    }, 200, cors);
  } catch (err) {
    console.error('notify error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
