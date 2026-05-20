import { neon } from '@neondatabase/serverless';

let _sql = null;
let initialized = false;

export function getSql() {
  if (_sql) return _sql;
  const conn =
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_PRISMA_URL;
  if (!conn) {
    throw new Error('Database not configured. Set DATABASE_URL.');
  }
  _sql = neon(conn);
  return _sql;
}

export async function ensureSchema() {
  if (initialized) return;
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      equipment TEXT DEFAULT '',
      specs TEXT DEFAULT '',
      location TEXT DEFAULT '',
      status TEXT DEFAULT '',
      next_action TEXT DEFAULT '',
      due_date TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `;
  initialized = true;
}
