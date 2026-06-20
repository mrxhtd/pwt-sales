-- Shared, cross-instance login rate-limiting state.
-- Serverless functions don't share memory, so the limiter must live in the DB.
CREATE TABLE IF NOT EXISTS login_attempts (
  key       TEXT PRIMARY KEY,   -- e.g. "<ip>:<username>"
  count     INTEGER NOT NULL DEFAULT 0,
  reset_at  TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_reset ON login_attempts(reset_at);
