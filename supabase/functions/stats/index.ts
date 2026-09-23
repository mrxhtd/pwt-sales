import { getCorsHeaders } from '../_shared/cors.ts';
import { getSupabase } from '../_shared/db.ts';
import { getSession } from '../_shared/auth.ts';
import {
  cairoToday, inPeriod, periodStart, pipelineBucket, PIPELINE_STATUSES,
  weekBuckets, weekIndex, type Period,
} from './period.ts';

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, 'Content-Type': 'application/json' },
  });
}

// PostgREST caps a plain select at 1000 rows, which would silently understate
// every chart once the company passes that many leads or follow-ups. The first
// page comes back with an exact row count, so any remaining pages are fetched
// in parallel instead of one after another.
const PAGE = 1000;
async function fetchAll(
  supabase: any,
  table: string,
  columns: string,
  since?: { column: string; from: string | null },
): Promise<any[]> {
  const page = (n: number) => {
    let q = supabase.from(table).select(columns, n === 0 ? { count: 'exact' } : {})
      .range(n * PAGE, n * PAGE + PAGE - 1);
    if (since?.from) q = q.gte(since.column, since.from);
    return q;
  };

  const { data, error, count } = await page(0);
  if (error) throw error;
  const rows: any[] = data || [];
  if (rows.length < PAGE || !count || count <= PAGE) return rows;

  const rest = await Promise.all(
    Array.from({ length: Math.ceil(count / PAGE) - 1 }, (_, i) => page(i + 1)),
  );
  for (const r of rest) {
    if (r.error) throw r.error;
    rows.push(...(r.data || []));
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  const cors = getCorsHeaders(req);

  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'GET') return json({ error: 'Method not allowed' }, 405, cors);

  const session = await getSession(req);
  if (!session) return json({ error: 'Unauthorized' }, 401, cors);
  if ((session as any).role !== 'admin') return json({ error: 'Admin only' }, 403, cors);

  try {
    const supabase = getSupabase();
    const url = new URL(req.url);

    const asked = url.searchParams.get('period') || 'quarter';
    const period: Period = ['month', 'quarter', 'year', 'all'].includes(asked) ? asked as Period : 'quarter';
    const includeAdmins = url.searchParams.get('includeAdmins') !== '0';

    const today = cairoToday();
    const from = periodStart(period, today);
    const weeks = weekBuckets(12, today);

    // Only fetch what the charts can actually show: follow-ups older than both
    // the period and the 12-week window can never appear, and neither can
    // clients converted before the period. Leads are read in full because the
    // pipeline and overdue charts are snapshots of everything open right now.
    const activityFrom = from && from < weeks[0].start ? from : weeks[0].start;

    const [engineerRows, leads, activities, clients] = await Promise.all([
      fetchAll(supabase, 'engineers', 'id, full_name, role, is_active, engineer_code'),
      fetchAll(supabase, 'leads', 'id, engineer_id, status, created_at, due_date, annual_cost'),
      fetchAll(supabase, 'activities', 'engineer_id, type, created_at',
        { column: 'created_at', from: period === 'all' ? null : activityFrom }),
      // Clients are not date-filtered: one converted inside the period may have
      // been created long before it, and that conversion still counts.
      fetchAll(supabase, 'clients', 'engineer_id, converted_at, created_at'),
    ]);

    const people = engineerRows
      .filter((e: any) => e.is_active && (includeAdmins || e.role !== 'admin'))
      .sort((a: any, b: any) => (a.engineer_code || 99) - (b.engineer_code || 99));

    const index = new Map<string, number>();
    people.forEach((e: any, i: number) => index.set(e.id, i));
    const zeros = () => people.map(() => 0);

    const calls = zeros(), visits = zeros(), newLeads = zeros(), won = zeros(), lost = zeros();
    const converted = zeros(), overdue = zeros(), moneyAll = zeros(), moneyWon = zeros();
    const pipeline: Record<string, number[]> = {};
    for (const s of PIPELINE_STATUSES) pipeline[s] = zeros();
    const weekly = people.map(() => weeks.map(() => 0));

    for (const lead of leads) {
      const i = index.get(lead.engineer_id);
      if (i === undefined) continue;

      // Pipeline and overdue are "right now" snapshots, so they ignore the period.
      pipeline[pipelineBucket(lead.status)][i]++;
      const open = lead.status !== 'Closed Won' && lead.status !== 'Lost';
      if (open && lead.due_date && lead.due_date < today) overdue[i]++;

      if (!inPeriod(lead.created_at, from)) continue;
      newLeads[i]++;
      if (lead.status === 'Closed Won') won[i]++;
      if (lead.status === 'Lost') lost[i]++;
      const cost = lead.annual_cost == null ? 0 : Number(lead.annual_cost);
      if (cost > 0) {
        moneyAll[i] += cost;
        if (lead.status === 'Closed Won') moneyWon[i] += cost;
      }
    }

    for (const act of activities) {
      const i = index.get(act.engineer_id);
      if (i === undefined) continue;
      if (inPeriod(act.created_at, from)) {
        if (act.type === 'visit') visits[i]++; else calls[i]++;
      }
      const w = weekIndex(act.created_at, weeks);
      if (w >= 0) weekly[i][w]++;
    }

    for (const client of clients) {
      const i = index.get(client.engineer_id);
      if (i === undefined) continue;
      if (inPeriod(client.converted_at || client.created_at, from)) converted[i]++;
    }

    // null, not 0, when nobody closed anything — "no data" is not "0%".
    const winRate = people.map((_: any, i: number) => {
      const closed = won[i] + lost[i];
      return closed === 0 ? null : Math.round((won[i] / closed) * 100);
    });

    const round2 = (n: number) => Math.round(n * 100) / 100;

    return json({
      period, from, today,
      includeAdmins,
      weeks: weeks.map(w => w.label),
      engineers: people.map((e: any) => ({
        id: e.id,
        name: e.full_name || '',
        role: e.role,
        code: e.engineer_code ?? null,
      })),
      calls, visits, newLeads, won, lost, winRate, converted, overdue,
      pipeline,
      pipelineStatuses: PIPELINE_STATUSES,
      weekly,
      money: {
        all: moneyAll.map(round2),
        won: moneyWon.map(round2),
        totalAll: round2(moneyAll.reduce((a, b) => a + b, 0)),
        totalWon: round2(moneyWon.reduce((a, b) => a + b, 0)),
      },
    }, 200, cors);
  } catch (err) {
    console.error('stats function error:', err);
    const msg = (err as any)?.message || String(err);
    if (msg.includes('relation') && msg.includes('does not exist')) {
      return json({ error: 'setup_required' }, 503, cors);
    }
    if (msg.includes('annual_cost')) {
      return json({ error: 'setup_required' }, 503, cors);
    }
    return json({ error: 'Server error' }, 500, cors);
  }
});
