import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Session = { engineerId: string; fullName: string; role: string };

interface AuditEntry {
  table: string;
  rowId: string;
  action: 'insert' | 'update' | 'delete' | 'restore';
  session: Session;
  before?: unknown;
  after?: unknown;
}

/**
 * Append a change-history row. Best-effort: a failure here is logged but never
 * fails the originating request. Captures the acting engineer (actor) plus a
 * before/after snapshot.
 */
export async function audit(supabase: SupabaseClient, e: AuditEntry): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      table_name: e.table,
      row_id: e.rowId,
      action: e.action,
      actor_id: e.session?.engineerId ?? null,
      actor_name: e.session?.fullName ?? null,
      before_data: e.before ?? null,
      after_data: e.after ?? null,
    });
  } catch (err) {
    console.error('audit_log write failed:', err);
  }
}
