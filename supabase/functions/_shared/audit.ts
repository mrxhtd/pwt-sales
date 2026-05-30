import { getSupabase } from './db.ts';

export type AuditEntry = {
  action: string;
  actorId?: string | null;
  actorName?: string | null;
  actorIp?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
};

export function getClientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0].trim();
  return req.headers.get('x-real-ip') || 'unknown';
}

// Fire-and-forget. Audit logging must never fail a primary request.
export function audit(entry: AuditEntry): void {
  const supabase = getSupabase();
  supabase.from('audit_log').insert({
    action: entry.action,
    actor_id: entry.actorId ?? null,
    actor_name: entry.actorName ?? null,
    actor_ip: entry.actorIp ?? null,
    entity_type: entry.entityType ?? null,
    entity_id: entry.entityId ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? null,
  }).then(({ error }: any) => {
    if (error) console.error('[audit] insert failed:', error.message, entry.action);
  });
}
