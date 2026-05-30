// Read-only audit log endpoint (admin).
import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);
  if (session.role !== 'admin') return json({ error: 'Admin only' }, 403, cors);

  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);

  try {
    const supabase = getSupabase();
    const url = new URL(req.url);

    const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(url.searchParams.get('limit') || String(DEFAULT_LIMIT)) || DEFAULT_LIMIT));
    const page = Math.max(0, parseInt(url.searchParams.get('page') || '0') || 0);
    const action = url.searchParams.get('action');
    const actorId = url.searchParams.get('actorId');
    const entityType = url.searchParams.get('entityType');
    const entityId = url.searchParams.get('entityId');

    let q = supabase
      .from('audit_log')
      .select('*', { count: 'exact' })
      .order('occurred_at', { ascending: false })
      .range(page * limit, page * limit + limit - 1);

    if (action) q = q.eq('action', action);
    if (actorId) q = q.eq('actor_id', actorId);
    if (entityType) q = q.eq('entity_type', entityType);
    if (entityId) q = q.eq('entity_id', entityId);

    const { data, error, count } = await q;
    if (error) throw error;

    return json({
      entries: (data || []).map((r: any) => ({
        id: r.id,
        occurredAt: r.occurred_at,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorIp: r.actor_ip,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        before: r.before,
        after: r.after,
        metadata: r.metadata,
      })),
      page, limit, total: count ?? null,
    }, 200, cors);
  } catch (err) {
    console.error('audit edge function error:', err);
    return json({ error: 'Server error' }, 500, cors);
  }
});
