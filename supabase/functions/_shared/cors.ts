const ALLOWED_ORIGINS = [
  'https://sales-tracker-one-lyart.vercel.app',
  'https://pwt-sales.vercel.app',
  'https://sales-tracker-*-mxhtdr-9726s-projects.vercel.app', // preview deployments
  'http://localhost:3000',
  'http://localhost:5173',
];

export function getCorsHeaders(req?: Request): Record<string, string> {
  let origin = req?.headers?.get('origin') || '';
  // Exact match or wildcard preview match
  const allowed = ALLOWED_ORIGINS.some(o => {
    if (o.includes('*')) {
      const regex = new RegExp('^' + o.replace(/\*/g, '[a-z0-9-]+') + '$');
      return regex.test(origin);
    }
    return o === origin;
  });
  if (!allowed) origin = ALLOWED_ORIGINS[0]; // default to production

  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// Backward compat — default headers for non-request contexts
export const corsHeaders = getCorsHeaders();
