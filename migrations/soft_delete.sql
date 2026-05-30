-- Soft delete: every "destructive" operation just sets deleted_at.
-- Reads filter `WHERE deleted_at IS NULL`. Admin Recycle Bin shows the rest.

ALTER TABLE sites           ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE clients         ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;
ALTER TABLE client_products ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_sites_deleted_at           ON sites (deleted_at)           WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_clients_deleted_at         ON clients (deleted_at)         WHERE deleted_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_client_products_deleted_at ON client_products (deleted_at) WHERE deleted_at IS NOT NULL;

-- Auto-purge soft-deleted rows after 30 days.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'purge-soft-deleted',
      '30 3 * * *',
      $cron$
        DELETE FROM client_products WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
        DELETE FROM clients         WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
        DELETE FROM sites           WHERE deleted_at IS NOT NULL AND deleted_at < now() - interval '30 days';
      $cron$
    );
  END IF;
END $$;
