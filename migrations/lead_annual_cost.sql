-- Total annual cost (EGP) the sales engineer records on each lead.
-- Nullable: leads created before this column, or where the figure isn't known yet,
-- stay NULL rather than a misleading 0. Safe to re-run.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS annual_cost NUMERIC(14,2)
  CHECK (annual_cost IS NULL OR annual_cost >= 0);
