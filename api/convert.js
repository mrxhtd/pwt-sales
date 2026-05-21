import crypto from 'node:crypto';
import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  const { engineerId, role } = session;
  const isAdmin = role === 'admin';

  try {
    const supabase = getSupabase();
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const siteId = body?.siteId;
    if (!siteId) return res.status(400).json({ error: 'Missing siteId' });

    // Get the site
    const { data: site, error: sErr } = await supabase
      .from('sites')
      .select('*')
      .eq('id', siteId)
      .single();

    if (sErr || !site) return res.status(404).json({ error: 'Site not found' });

    // Verify ownership
    if (site.engineer_id !== engineerId && !isAdmin) {
      return res.status(403).json({ error: 'Not your site' });
    }

    // Check status
    if (site.status !== 'Closed Won') {
      return res.status(400).json({ error: 'Site must be Closed Won to convert' });
    }

    // Check if already converted
    const { data: existing } = await supabase
      .from('clients')
      .select('id')
      .eq('converted_from', siteId)
      .single();

    if (existing) {
      return res.status(400).json({ error: 'Already converted', clientId: existing.id });
    }

    // Create client
    const clientId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: cErr } = await supabase
      .from('clients')
      .insert({
        id: clientId,
        engineer_id: site.engineer_id,
        name: site.name || '',
        contact: site.contact || '',
        phone: site.phone || '',
        location: site.location || '',
        equipment: site.equipment || '',
        specs: site.specs || '',
        notes: site.notes || '',
        converted_from: siteId,
        converted_at: now,
        created_at: now,
        updated_at: now,
      });

    if (cErr) throw cErr;

    return res.status(200).json({
      ok: true,
      clientId,
      client: {
        id: clientId,
        name: site.name || '',
        contact: site.contact || '',
        phone: site.phone || '',
        location: site.location || '',
        equipment: site.equipment || '',
        specs: site.specs || '',
        notes: site.notes || '',
        convertedFrom: siteId,
        convertedAt: now,
        createdAt: now,
      },
    });
  } catch (err) {
    console.error('convert api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
