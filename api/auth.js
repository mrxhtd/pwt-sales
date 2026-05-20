import { setAuthCookie, clearAuthCookie, isAuthed } from '../lib/auth.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ authed: isAuthed(req) });
  }

  if (req.method === 'DELETE') {
    clearAuthCookie(res);
    return res.status(200).json({ ok: true });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!process.env.APP_PASSWORD) {
    return res.status(500).json({ error: 'APP_PASSWORD not configured' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const password = body?.password || '';

  if (password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  setAuthCookie(res);
  return res.status(200).json({ ok: true });
}
