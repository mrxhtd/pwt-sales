// Server-side password policy. Mirrored in the client; this is the source of truth.
//
// Rules (intentionally strict but practical for a CRM):
//   - 12+ characters, ≤ 200
//   - At least 3 of 4 classes: lowercase, uppercase, digit, symbol
//   - No single character makes up > 60% of the password (kills "aaaaaaaaaaaa")
//   - Not in a tiny denylist of obvious passwords

const COMMON_PASSWORDS = new Set([
  'pwt123', 'password', 'password1', 'password123', 'qwerty', 'qwerty123',
  'letmein', 'welcome123', 'admin', 'admin123', '123456789012', 'abc123',
  'iloveyou', 'monkey', 'dragon', 'master', 'football', 'baseball',
]);

export type PasswordCheck = { ok: true } | { ok: false; reason: string };

export function checkPasswordStrength(password: string): PasswordCheck {
  if (typeof password !== 'string') return { ok: false, reason: 'Password must be a string' };
  if (password.length < 12) return { ok: false, reason: 'Password must be at least 12 characters' };
  if (password.length > 200) return { ok: false, reason: 'Password too long' };

  const lower = password.toLowerCase();
  if (COMMON_PASSWORDS.has(lower)) {
    return { ok: false, reason: 'Password is too common' };
  }

  const classes = [
    /[a-z]/.test(password),
    /[A-Z]/.test(password),
    /\d/.test(password),
    /[^A-Za-z0-9]/.test(password),
  ].filter(Boolean).length;

  if (classes < 3) {
    return { ok: false, reason: 'Password must include 3 of: lowercase, uppercase, digit, symbol' };
  }

  // Reject passwords that are basically one repeated character.
  const counts = new Map<string, number>();
  for (const c of password) counts.set(c, (counts.get(c) || 0) + 1);
  const maxRepeat = Math.max(...counts.values());
  if (maxRepeat / password.length > 0.6) {
    return { ok: false, reason: 'Password has too little variety' };
  }

  // Reject obvious sequences.
  if (/(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer|asdf|zxcv)/i.test(password)) {
    return { ok: false, reason: 'Password contains a common sequence' };
  }

  return { ok: true };
}
