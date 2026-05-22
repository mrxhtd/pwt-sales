import { getSupabase } from './db.ts';

const MAX_AGE_DAYS = 30;

/**
 * Read the session token from Authorization header (Bearer token),
 * look up in DB joined with engineers.
 * Returns { engineerId, fullName, role } or null.
 */

// Periodically clean expired sessions (at most once per hour per instance)
let _lastCleanup = 0;
async function maybeCleanExpired() {
  const now = Date.now();
  if (now - _lastCleanup < 60 * 60 * 1000) return;
  _lastCleanup = now;
  const supabase = getSupabase();
  await supabase.from('sessions').delete().lt('expires_at', new Date().toISOString());
}

export async function getSession(req: Request): Promise<{ engineerId: string; fullName: string; role: string } | null> {
  // Read token from Authorization: Bearer <token>
  const authHeader = req.headers.get('authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
  if (!token) return null;

  const supabase = getSupabase();

  // Non-blocking cleanup of stale sessions
  maybeCleanExpired().catch(() => {});

  const { data, error } = await supabase
    .from('sessions')
    .select('engineer_id, expires_at, engineers(id, full_name, role, is_active)')
    .eq('token', token)
    .single();

  if (error || !data) return null;

  // Check expiry
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('sessions').delete().eq('token', token);
    return null;
  }

  const eng = data.engineers as any;
  if (!eng || !eng.is_active) return null;

  return {
    engineerId: eng.id,
    fullName: eng.full_name,
    role: eng.role,
  };
}

/** Create a new session for an engineer, return the token */
export async function createSession(engineerId: string): Promise<string> {
  const supabase = getSupabase();
  const token = crypto.randomUUID();
  const now = new Date();
  const expires = new Date(now.getTime() + MAX_AGE_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await supabase.from('sessions').insert({
    token,
    engineer_id: engineerId,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  });

  if (error) throw error;
  return token;
}

/** Delete a session by token */
export async function deleteSession(token: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.from('sessions').delete().eq('token', token);
}
