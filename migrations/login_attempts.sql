-- Persistent rate limiting for login.
-- Replaces in-memory Map (which was per-edge-instance and bypassable).

CREATE TABLE IF NOT EXISTS login_attempts (
  rate_key TEXT PRIMARY KEY,             -- ip + ':' + username
  attempt_count INTEGER NOT NULL DEFAULT 0,
  first_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_last_attempt ON login_attempts (last_attempt_at);

ALTER TABLE login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempts FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON login_attempts FROM anon, authenticated;

-- Atomically register a login attempt and return whether the caller is currently locked out.
-- max_attempts: how many failures allowed in window_seconds before lockout.
-- lockout_seconds: how long the lock lasts after exceeding the threshold.
CREATE OR REPLACE FUNCTION register_login_attempt(
  p_rate_key TEXT,
  p_max_attempts INTEGER DEFAULT 7,
  p_window_seconds INTEGER DEFAULT 900,
  p_lockout_seconds INTEGER DEFAULT 900
) RETURNS TABLE(locked BOOLEAN, retry_after_seconds INTEGER, attempts INTEGER)
LANGUAGE plpgsql AS $$
DECLARE
  v_row login_attempts;
  v_now TIMESTAMPTZ := now();
BEGIN
  INSERT INTO login_attempts (rate_key, attempt_count, first_attempt_at, last_attempt_at)
  VALUES (p_rate_key, 1, v_now, v_now)
  ON CONFLICT (rate_key) DO UPDATE
    SET attempt_count = CASE
          WHEN login_attempts.first_attempt_at < v_now - make_interval(secs => p_window_seconds)
            THEN 1
          ELSE login_attempts.attempt_count + 1
        END,
        first_attempt_at = CASE
          WHEN login_attempts.first_attempt_at < v_now - make_interval(secs => p_window_seconds)
            THEN v_now
          ELSE login_attempts.first_attempt_at
        END,
        last_attempt_at = v_now,
        locked_until = CASE
          WHEN login_attempts.attempt_count + 1 > p_max_attempts
            THEN v_now + make_interval(secs => p_lockout_seconds)
          ELSE login_attempts.locked_until
        END
    RETURNING * INTO v_row;

  IF v_row.locked_until IS NOT NULL AND v_row.locked_until > v_now THEN
    locked := TRUE;
    retry_after_seconds := GREATEST(1, EXTRACT(EPOCH FROM (v_row.locked_until - v_now))::INTEGER);
  ELSE
    locked := FALSE;
    retry_after_seconds := 0;
  END IF;
  attempts := v_row.attempt_count;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION clear_login_attempts(p_rate_key TEXT)
RETURNS VOID LANGUAGE SQL AS $$
  DELETE FROM login_attempts WHERE rate_key = p_rate_key;
$$;

-- Clean up old rows daily (older than 7 days).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'cleanup-login-attempts',
      '15 3 * * *',
      $cron$DELETE FROM login_attempts WHERE last_attempt_at < now() - interval '7 days'$cron$
    );
  END IF;
END $$;
