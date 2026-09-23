-- Quotation barcodes (agreed plan: docs/quotation-barcodes-plan.md).
--
-- A quotation belongs to exactly one lead or one client. Every version of it
-- carries a 17-digit barcode:
--   engineer(2) + location(2) + first-created date YYMMDD(6) + number(5) + version(2)
--
-- Safe to re-run.

-- 1. Two-digit engineer number, assigned in creation order and never reused.
ALTER TABLE engineers ADD COLUMN IF NOT EXISTS engineer_code SMALLINT;

WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY created_at, id) AS rn
  FROM engineers
  WHERE engineer_code IS NULL
)
UPDATE engineers e
SET engineer_code = o.rn
FROM ordered o
WHERE e.id = o.id AND e.engineer_code IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_engineers_engineer_code
  ON engineers (engineer_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'engineers_engineer_code_range'
  ) THEN
    ALTER TABLE engineers ADD CONSTRAINT engineers_engineer_code_range
      CHECK (engineer_code IS NULL OR (engineer_code BETWEEN 1 AND 99));
  END IF;
END $$;

-- 2. Company-wide quotation counter. It never restarts, so it must not cycle:
--    running past 99999 is a hard error rather than a silently reused number.
CREATE SEQUENCE IF NOT EXISTS quotation_number_seq
  AS INTEGER START WITH 1 MINVALUE 1 MAXVALUE 99999 NO CYCLE;

-- 3. Quotations. lead_id/client_id are mutually exclusive; a quotation raised on a
--    lead keeps pointing at that lead after the lead is converted to a client, and
--    the client screen finds it through clients.converted_from.
CREATE TABLE IF NOT EXISTS quotations (
  id TEXT PRIMARY KEY,
  number INTEGER NOT NULL UNIQUE DEFAULT nextval('quotation_number_seq')
    CHECK (number BETWEEN 1 AND 99999),
  engineer_id TEXT NOT NULL REFERENCES engineers(id),
  engineer_code SMALLINT NOT NULL CHECK (engineer_code BETWEEN 1 AND 99),
  location_code SMALLINT NOT NULL CHECK (location_code BETWEEN 1 AND 99),
  issued_on DATE NOT NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE CASCADE,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT quotations_one_parent CHECK ((lead_id IS NULL) <> (client_id IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_quotations_lead ON quotations (lead_id);
CREATE INDEX IF NOT EXISTS idx_quotations_client ON quotations (client_id);
CREATE INDEX IF NOT EXISTS idx_quotations_engineer ON quotations (engineer_id);

-- 4. Versions. The unique (quotation_id, version) pair is what stops a
--    double-tapped "New version" from creating two rows with the same number.
CREATE TABLE IF NOT EXISTS quotation_versions (
  id TEXT PRIMARY KEY,
  quotation_id TEXT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  version SMALLINT NOT NULL CHECK (version BETWEEN 1 AND 99),
  barcode TEXT NOT NULL UNIQUE CHECK (barcode ~ '^[0-9]{17}$'),
  drive_url TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT REFERENCES engineers(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (quotation_id, version)
);

CREATE INDEX IF NOT EXISTS idx_quotation_versions_quotation
  ON quotation_versions (quotation_id, version DESC);

-- 5. Same posture as every other table: only the service role (the edge
--    functions) may touch these. The browser never talks to PostgREST directly.
ALTER TABLE quotations ENABLE ROW LEVEL SECURITY;
ALTER TABLE quotation_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_only" ON quotations;
DROP POLICY IF EXISTS "service_role_only" ON quotation_versions;

CREATE POLICY "service_role_only" ON quotations
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "service_role_only" ON quotation_versions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
