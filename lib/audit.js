// Append a change-history row. Best-effort: a failure here is logged but never
// fails the originating request. Captures the acting engineer plus before/after.
export async function audit(supabase, { table, rowId, action, session, before, after }) {
  try {
    await supabase.from('audit_log').insert({
      table_name: table,
      row_id: rowId,
      action,
      actor_id: session?.engineerId ?? null,
      actor_name: session?.fullName ?? null,
      before_data: before ?? null,
      after_data: after ?? null,
    });
  } catch (err) {
    console.error('audit_log write failed:', err);
  }
}
