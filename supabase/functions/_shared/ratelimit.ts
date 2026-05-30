import { getSupabase } from './db.ts';

const LOGIN_MAX_ATTEMPTS = 7;
const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_LOCKOUT_SECONDS = 15 * 60;

export type RateLimitResult =
  | { locked: false; attempts: number }
  | { locked: true; retryAfterSeconds: number; attempts: number };

export async function checkLoginRateLimit(rateKey: string): Promise<RateLimitResult> {
  const supabase = getSupabase();
  const { data, error } = await supabase.rpc('register_login_attempt', {
    p_rate_key: rateKey,
    p_max_attempts: LOGIN_MAX_ATTEMPTS,
    p_window_seconds: LOGIN_WINDOW_SECONDS,
    p_lockout_seconds: LOGIN_LOCKOUT_SECONDS,
  });
  if (error) {
    console.error('[ratelimit] RPC failed, falling back to allow:', error.message);
    return { locked: false, attempts: 0 };
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return { locked: false, attempts: 0 };
  if (row.locked) {
    return {
      locked: true,
      retryAfterSeconds: row.retry_after_seconds ?? LOGIN_LOCKOUT_SECONDS,
      attempts: row.attempts ?? 0,
    };
  }
  return { locked: false, attempts: row.attempts ?? 0 };
}

export async function clearLoginRateLimit(rateKey: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.rpc('clear_login_attempts', { p_rate_key: rateKey });
}
