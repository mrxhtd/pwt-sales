-- Transactional lead → client conversion.
-- Replaces two separate INSERT+DELETE calls in the convert edge function,
-- which could leave orphan state if the second call failed.

CREATE OR REPLACE FUNCTION convert_site_to_client(
  p_site_id TEXT,
  p_acting_engineer_id TEXT,
  p_is_admin BOOLEAN
) RETURNS TABLE(
  client_id TEXT,
  client_name TEXT,
  client_contact TEXT,
  client_phone TEXT,
  client_location TEXT,
  client_equipment TEXT,
  client_specs TEXT,
  client_notes TEXT,
  client_engineer_id TEXT,
  client_engineer_name TEXT,
  client_converted_at TIMESTAMPTZ,
  client_created_at TIMESTAMPTZ
)
LANGUAGE plpgsql AS $$
DECLARE
  v_site sites%ROWTYPE;
  v_existing_client_id TEXT;
  v_new_client_id TEXT;
  v_now TIMESTAMPTZ := now();
  v_engineer_name TEXT;
BEGIN
  SELECT * INTO v_site FROM sites WHERE id = p_site_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'site_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_site.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'site_deleted' USING ERRCODE = 'P0001';
  END IF;

  IF v_site.engineer_id IS DISTINCT FROM p_acting_engineer_id AND NOT p_is_admin THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'P0001';
  END IF;

  IF v_site.status IS DISTINCT FROM 'Closed Won' THEN
    RAISE EXCEPTION 'not_closed_won' USING ERRCODE = 'P0001';
  END IF;

  SELECT id INTO v_existing_client_id FROM clients
    WHERE converted_from = p_site_id AND deleted_at IS NULL LIMIT 1;
  IF v_existing_client_id IS NOT NULL THEN
    RAISE EXCEPTION 'already_converted:%', v_existing_client_id USING ERRCODE = 'P0001';
  END IF;

  v_new_client_id := gen_random_uuid()::TEXT;

  INSERT INTO clients (
    id, engineer_id, name, contact, phone, location, equipment, specs, notes,
    converted_from, converted_at, created_at, updated_at
  ) VALUES (
    v_new_client_id, v_site.engineer_id,
    COALESCE(v_site.name, ''),
    COALESCE(v_site.contact, ''),
    COALESCE(v_site.phone, ''),
    COALESCE(v_site.location, ''),
    COALESCE(v_site.equipment, ''),
    COALESCE(v_site.specs, ''),
    COALESCE(v_site.notes, ''),
    p_site_id, v_now, v_now, v_now
  );

  -- Soft delete the site (was a hard delete; transaction now guarantees atomicity).
  UPDATE sites SET deleted_at = v_now, updated_at = v_now WHERE id = p_site_id;

  SELECT full_name INTO v_engineer_name FROM engineers WHERE id = v_site.engineer_id;

  client_id := v_new_client_id;
  client_name := COALESCE(v_site.name, '');
  client_contact := COALESCE(v_site.contact, '');
  client_phone := COALESCE(v_site.phone, '');
  client_location := COALESCE(v_site.location, '');
  client_equipment := COALESCE(v_site.equipment, '');
  client_specs := COALESCE(v_site.specs, '');
  client_notes := COALESCE(v_site.notes, '');
  client_engineer_id := v_site.engineer_id;
  client_engineer_name := COALESCE(v_engineer_name, '');
  client_converted_at := v_now;
  client_created_at := v_now;
  RETURN NEXT;
END;
$$;
