import { createClient } from '@supabase/supabase-js';

let _supabase = null;

export function getSupabase() {
  if (_supabase) return _supabase;
  const url = process.env.SUPABASE_URL;
  // Must use the service-role key: the API enforces ownership in app code and
  // relies on bypassing RLS. Silently falling back to the anon key would change
  // authorization behavior in surprising ways, so require it explicitly.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
  }
  _supabase = createClient(url, key);
  return _supabase;
}
