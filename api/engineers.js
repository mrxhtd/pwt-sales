import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { getSupabase } from '../lib/db.js';
import { getSession } from '../lib/auth.js';

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const session = await getSession(req);
  if (!session) return res.status(401).json({ error: 'Unauthorized' });

  if (session.role !== 'admin') {
    return res.status(403).json({ error: 'Admin only' });
  }

  try {
    const supabase = getSupabase();

    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('engineers')
        .select('id, username, full_name, role, is_active, created_at')
        .order('created_at', { ascending: true });
      if (error) throw error;
      return res.status(200).json({
        engineers: (data || []).map(e => ({
          id: e.id,
          username: e.username,
          fullName: e.full_name,
          role: e.role,
          isActive: e.is_active,
          createdAt: e.created_at,
        })),
      });
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const e = body?.engineer;
      if (!e?.username) return res.status(400).json({ error: 'Missing username' });

      const id = e.id || 'eng_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);

      // Check if updating existing
      const { data: existing } = await supabase
        .from('engineers')
        .select('id')
        .eq('id', id)
        .single();

      const record = {
        id,
        username: e.username.trim().toLowerCase(),
        full_name: e.fullName || e.username,
        role: e.role || 'engineer',
        is_active: e.isActive !== false,
        updated_at: new Date().toISOString(),
      };

      // Hash password on create, or on update if provided
      if (!existing && !e.password) {
        return res.status(400).json({ error: 'Password required for new engineer' });
      }
      if (e.password) {
        record.password = await bcrypt.hash(e.password, 10);
      }

      const { error } = await supabase
        .from('engineers')
        .upsert(record, { onConflict: 'id' });
      if (error) throw error;
      return res.status(200).json({ ok: true, id });
    }

    if (req.method === 'DELETE') {
      const url = new URL(req.url, 'http://x');
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'Missing id' });

      // Don't let admin delete themselves
      if (id === session.engineerId) {
        return res.status(400).json({ error: 'Cannot delete yourself' });
      }

      // Soft disable
      const { error } = await supabase
        .from('engineers')
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('engineers api error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
}
