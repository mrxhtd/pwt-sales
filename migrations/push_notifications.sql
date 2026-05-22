-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id BIGSERIAL PRIMARY KEY,
  engineer_id TEXT NOT NULL REFERENCES engineers(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL,
  keys_p256dh TEXT NOT NULL DEFAULT '',
  keys_auth TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (engineer_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_engineer ON push_subscriptions (engineer_id);

-- Notification log to prevent duplicate notifications
CREATE TABLE IF NOT EXISTS notification_log (
  id BIGSERIAL PRIMARY KEY,
  site_id TEXT NOT NULL,
  engineer_id TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notif_log_site_sent ON notification_log (site_id, sent_at);

-- Clean up old notification logs (older than 7 days) automatically
-- Requires pg_cron extension to be enabled
SELECT cron.schedule(
  'cleanup-notification-log',
  '0 3 * * *',  -- daily at 3 AM UTC
  $$DELETE FROM notification_log WHERE sent_at < now() - interval '7 days'$$
);

-- Schedule the notify function to run every hour
SELECT cron.schedule(
  'check-due-dates',
  '0 * * * *',  -- every hour at minute 0
  $$
  SELECT net.http_post(
    url := 'https://hbiquvmldtoinqtmbvgd.supabase.co/functions/v1/notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);
