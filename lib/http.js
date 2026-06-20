// Small shared HTTP helpers for the serverless API handlers.

/**
 * Safely read a JSON body whether Vercel pre-parsed it or handed us a string.
 * Throws a tagged error (statusCode 400) on malformed JSON so handlers can
 * return a clean 400 instead of leaking a raw SyntaxError as a 500.
 */
export function readBody(req) {
  const b = req.body;
  if (b == null || b === '') return {};
  if (typeof b !== 'string') return b;
  try {
    return JSON.parse(b);
  } catch {
    const err = new Error('Invalid JSON body');
    err.statusCode = 400;
    throw err;
  }
}

// Record ids are server-style slugs/uuids: letters, digits, dash, underscore.
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** True if `id` is a well-formed record id (prevents oversized/odd keys). */
export function isValidId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}
