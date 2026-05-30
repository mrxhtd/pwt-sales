-- Global quote numbering. Replaces per-device localStorage counter
-- which caused two engineers to mint the same offer number.

CREATE TABLE IF NOT EXISTS quotes (
  id BIGSERIAL PRIMARY KEY,
  offer_number TEXT NOT NULL UNIQUE,
  engineer_id TEXT REFERENCES engineers(id) ON DELETE SET NULL,
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  client_name TEXT NOT NULL DEFAULT '',
  -- Integer piastres (100 piastres = 1 EGP) to avoid float drift on currency.
  total_piastres BIGINT NOT NULL DEFAULT 0,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quotes_engineer ON quotes (engineer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quotes_client   ON quotes (client_id, created_at DESC);

ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotes FORCE  ROW LEVEL SECURITY;
REVOKE ALL ON quotes FROM anon, authenticated;

CREATE SEQUENCE IF NOT EXISTS quote_offer_number_seq AS BIGINT START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE;

-- Format: PWT-{YYYY}-{nnnnnn}
CREATE OR REPLACE FUNCTION next_offer_number() RETURNS TEXT
LANGUAGE plpgsql AS $$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := nextval('quote_offer_number_seq');
  RETURN 'PWT-' || to_char(now(), 'YYYY') || '-' || lpad(v_seq::TEXT, 6, '0');
END;
$$;
