-- Quotation codes move to the company's document format:
--   PRO-YYYYMMDD-LOCATION-ENGINEER-NUMBER  (e.g. PRO-20260928-OCTO-001-32)
-- matching the surveys' SRV-… codes. Versions after the first add -V02, -V03 …
-- Safe to re-run.

-- 1. Four-letter location code, backfilled from the old numeric one.
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS location_abbr TEXT;

UPDATE quotations SET location_abbr = CASE location_code
    WHEN 1 THEN 'ALEX' WHEN 2 THEN 'BORG' WHEN 3 THEN 'AMRY' WHEN 4 THEN 'SADA'
    WHEN 5 THEN 'OCTO' WHEN 6 THEN 'NRTH' WHEN 7 THEN 'OBOR' WHEN 8 THEN 'RAMA'
    ELSE 'OTHR' END
  WHERE location_abbr IS NULL;

-- New rows carry the text code only, so the numeric column must be optional.
ALTER TABLE quotations ALTER COLUMN location_code DROP NOT NULL;

-- 2. Engineer numbers are written with three digits, so allow up to 999.
ALTER TABLE engineers DROP CONSTRAINT IF EXISTS engineers_engineer_code_range;
ALTER TABLE engineers ADD CONSTRAINT engineers_engineer_code_range
  CHECK (engineer_code IS NULL OR (engineer_code BETWEEN 1 AND 999));

ALTER TABLE quotations DROP CONSTRAINT IF EXISTS quotations_engineer_code_check;
ALTER TABLE quotations ADD CONSTRAINT quotations_engineer_code_check
  CHECK (engineer_code BETWEEN 1 AND 999);

-- 3. The stored value is a code now, not a barcode of digits.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'quotation_versions' AND column_name = 'barcode'
  ) THEN
    ALTER TABLE quotation_versions RENAME COLUMN barcode TO code;
  END IF;
END $$;

-- The old rule demanded exactly 17 digits; codes are text of varying length now.
ALTER TABLE quotation_versions DROP CONSTRAINT IF EXISTS quotation_versions_barcode_check;
ALTER TABLE quotation_versions DROP CONSTRAINT IF EXISTS quotation_versions_code_check;
ALTER TABLE quotation_versions ADD CONSTRAINT quotation_versions_code_check
  CHECK (char_length(code) BETWEEN 3 AND 64);
