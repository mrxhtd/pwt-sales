import { getSql, ensureSchema } from '../lib/db.js';
import { isAuthed } from '../lib/auth.js';

export const config = { maxDuration: 30 };

function rowToSite(r) {
  return {
    id: r.id,
    name: r.name || '',
    contact: r.contact || '',
    phone: r.phone || '',
    equipment: r.equipment || '',
    specs: r.specs || '',
    location: r.location || '',
    status: r.status || '',
    nextAction: r.next_action || '',
    dueDate: r.due_date || '',
    notes: r.notes || '',
  };
}

export default async function handler(req, res) {
  if (!isAuthed(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    await ensureSchema();
    const sql = getSql();

    if (req.method === 'GET') {
      const rows = await sql`
        SELECT id, name, contact, phone, equipment, specs, location,
               status, next_action, due_date, notes
        FROM sites
        ORDER BY updated_at DESC
      `;
      return res.status(200).json({ sites: rows.map(rowToSite) });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const s = body?.site;
      if (!s?.id) return res.status(400).json({ error: 'Missing site.id' });

      await sql`
        INSERT INTO sites (
          id, name, contact, phone, equipment, specs, location,
          status, next_action, due_date, notes, updated_at
        )
        VALUES (
          ${s.id}, ${s.name || ''}, ${s.contact || ''}, ${s.phone || ''},
          ${s.equipment || ''}, ${s.specs || ''}, ${s.location || ''},
          ${s.status || ''}, ${s.nextAction || ''}, ${s.dueDate || ''},
          ${s.notes || ''}, now()
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          contact = EXCLUDED.contact,
          phone = EXCLUDED.phone,
          equipment = EXCLUDED.equipment,
          specs = EXCLUDED.specs,
          location = EXCLUDED.location,
          status = EXCLUDED.status,
          next_action = EXCLUDED.next_action,
          due_date = EXCLUDED.due_date,
          notes = EXCLUDED.notes,
          updated_at = now()
      `;
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });
      await sql`DELETE FROM sites WHERE id = ${id}`;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('sites api error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
