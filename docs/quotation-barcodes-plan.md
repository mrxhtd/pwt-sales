# Quotation Barcodes — Agreed Plan

Agreed with the client on 2026-09-16. Built on branch `feat/quotation-barcodes`
(2026-09-23): migrations/quotations.sql, supabase/functions/quotations/, and the
Quotations section in index.html. The barcode library is vendored at
vendor/jsbarcode.code128.min.js so it works offline and under the CSP.

## Background

Sales engineers keep their quotation documents on Google Drive. Today, staff make a
barcode for each quotation by hand. The PWA should generate that barcode instead:
the engineer copies it from the app and pastes it into the quotation document on Drive.

Receipts and payments are **out of scope** for now.

## Barcode format

A 1D barcode (Code 128, drawn in the browser with JsBarcode from cdnjs) holding
**17 digits, no dashes**. Every part is fixed-width and zero-padded:

| Digits | Part | Example |
|---|---|---|
| 1–2   | Engineer number                          | `03` |
| 3–4   | Location number                          | `01` (Alexandria) |
| 5–10  | Date the quotation was first created (YYMMDD) | `260916` |
| 11–15 | Quotation number                         | `00127` |
| 16–17 | Version                                  | `02` |

Example: `03012609160012702`

- The number is also printed as text under the barcode.
- All versions of one quotation share engineer, location, date and quotation number;
  only the version digits change.
- The date is the **first** version's creation date (not each version's date).
- The quotation number is a single company-wide counter, 00001–99999, and
  **never restarts** (not per year, not per engineer).
- Numbers and dates are assigned by the server, never the phone.

## Engineer numbers (automatic)

- New column `engineers.engineer_code`, unique, two digits.
- Migration numbers existing engineers 01, 02, 03… by `created_at` order.
- Each new engineer automatically gets the next number.
- Numbers are never reused; a departed engineer's number stays retired.
- Shown read-only on the admin engineer screen.

## Location numbers

Based on `LOCATION_OPTIONS` in `index.html`:

| Code | Location |
|---|---|
| 01 | Alexandria |
| 02 | Borg El Arab |
| 03 | Al Amryah |
| 04 | El sadat |
| 05 | October |
| 06 | North Coast |
| 07 | Obour |
| 08 | 10th Ramadan |
| 99 | Other |

- Keep the numbers in one place that both frontend and backend use.
- New places get the next free code (09, 10…); existing codes never change.
- A lead must have a location before a quotation can be created.
- Free-text or AI-extracted locations that don't match the list → 99 unless the
  engineer picks a listed one.
- The location code is saved on the quotation when it's created, so later changes to
  the lead's location don't change existing barcodes.

## Database

- `engineers.engineer_code` (see above).
- `quotations`: id, quotation number (sequence), engineer_id, location code,
  date (YYMMDD source), lead_id / client_id, created_at. It must stay attached when a
  lead is converted to a client (see `clients.converted_from`).
- `quotation_versions`: id, quotation_id, version number, full 17-digit barcode,
  Drive link, optional note, created_by, created_at.
  Unique on (quotation_id, version).
- Enable RLS with a `service_role_only` policy on the new tables (match `migrate.sql`).
- Guard against double-tap (see commit fa02871 for the existing pattern).

## Backend

- New edge function `supabase/functions/quotations/index.ts`.
- Engineers can only see and create quotations for their own leads and clients;
  admins can see all of them.

## Frontend (`index.html`)

- A **Quotations** section on the lead and client detail screens:
  - **New quotation** and **New version** buttons.
  - Version history with a barcode for each version.
  - A **Drive link** field for each version, with an open button.
- Buttons for each barcode: **Copy barcode** (PNG image to clipboard through
  `navigator.clipboard.write`), **Copy number**, **Download PNG**.

## Testing checklist

- Pasting the barcode into a document works and the barcode scans, on phone and desktop.
- Version numbers increase correctly; double-tap does not create an extra version.
- An engineer cannot read or create quotations for another engineer's lead or client.
- Engineer numbers are assigned automatically and never reused.
- A quotation follows its lead when the lead is converted to a client.
