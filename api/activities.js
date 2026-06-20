import crypto from 'node:crypto';
import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';
import { readBody } from '../lib/http.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const url = new URL(req.url, 'http://x');
      const siteId = url.searchParams.get('siteId');
      if (!siteId) return res.status(400).json({ error: 'Missing siteId' });

      // Verify access to this site
      if (!isAdmin) {
        const { data: site } = await supabase.from('sites').select('engineer_id').eq('id', siteId).single();
        if (!site || site.engineer_id !== engineerId) return res.status(403).json({ error: 'Forbidden' });
      }

      const { data, error } = await supabase
        .from('site_activities')
        .select('id, type, what_happened, next_action, next_action_date, created_at, engineer_id, engineers(full_name)')
        .eq('site_id', siteId)
        .order('created_at', { ascending: false });
      if (error) throw error;

      return res.status(200).json({
        activities: (data || []).map(a => ({
          id: a.id,
          type: a.type,
          whatHappened: a.what_happened,
          nextAction: a.next_action,
          nextActionDate: a.next_action_date || '',
          createdAt: a.created_at,
          engineerName: a.engineers?.full_name || '',
        })),
      });
    }

    if (req.method === 'POST') {
      const body = readBody(req);
      const { siteId, type, whatHappened, nextAction, nextActionDate } = body || {};

      if (!siteId) return res.status(400).json({ error: 'Missing siteId' });
      if (!type || !['call', 'visit'].includes(type)) return res.status(400).json({ error: 'Invalid type' });

      // Verify access to this site
      const { data: site } = await supabase.from('sites').select('engineer_id').eq('id', siteId).single();
      if (!site) return res.status(404).json({ error: 'Site not found' });
      if (!isAdmin && site.engineer_id !== engineerId) return res.status(403).json({ error: 'Forbidden' });

      const id = 'act_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      const { error: insertErr } = await supabase.from('site_activities').insert({
        id,
        site_id: siteId,
        engineer_id: engineerId,
        type,
        what_happened: (whatHappened || '').slice(0, 3000),
        next_action: (nextAction || '').slice(0, 500),
        next_action_date: nextActionDate || null,
      });
      if (insertErr) throw insertErr;

      // Update site's next_action and due_date automatically
      const siteUpdate = { updated_at: new Date().toISOString() };
      if (nextAction !== undefined) siteUpdate.next_action = (nextAction || '').slice(0, 2000);
      if (nextActionDate !== undefined) siteUpdate.due_date = nextActionDate || null;

      const { error: updateErr } = await supabase.from('sites').update(siteUpdate).eq('id', siteId);
      if (updateErr) throw updateErr;

      return res.status(200).json({ ok: true, id });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    if (err?.statusCode === 400) return res.status(400).json({ error: 'Invalid request' });
    console.error('activities api error:', err);
    const msg = err?.message || String(err);
    // Table not set up yet — keep this signal so the client can prompt setup,
    // but don't echo the raw driver message.
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return res.status(503).json({ error: 'setup_required' });
    }
    return res.status(500).json({ error: 'Server error' });
  }
}
