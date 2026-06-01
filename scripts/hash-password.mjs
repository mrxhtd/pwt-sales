#!/usr/bin/env node
// Generate a bcrypt hash for an admin/engineer password WITHOUT writing the
// plaintext anywhere it can leak (no argv, no shell history).
//
// Usage (recommended — piped, nothing echoed to the terminal scrollback):
//   printf '%s' 'your-strong-password' | node scripts/hash-password.mjs
//
// Or via an environment variable:
//   PWT_ADMIN_PASSWORD='your-strong-password' node scripts/hash-password.mjs
//
// The output is a bcrypt hash (cost 10) plus a ready-to-paste SQL line. Paste it
// into seed-admin.sql (gitignored), run it in Supabase, then delete the file.
//
// NOTE: passing the password as a CLI argument is intentionally NOT supported —
// arguments are visible in `ps` and your shell history.

import bcrypt from 'bcryptjs';

const COST = 10;

function readStdin() {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve('');
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
  });
}

const password = (process.env.PWT_ADMIN_PASSWORD ?? (await readStdin())).replace(/\r?\n$/, '');

if (!password) {
  console.error(
    'No password provided.\n' +
      "  printf '%s' 'your-strong-password' | node scripts/hash-password.mjs\n" +
      "  PWT_ADMIN_PASSWORD='your-strong-password' node scripts/hash-password.mjs",
  );
  process.exit(1);
}

if (password.length < 12) {
  console.error('Refusing: choose a password of at least 12 characters.');
  process.exit(1);
}

const hash = await bcrypt.hash(password, COST);

console.log('\nbcrypt hash (cost %d):\n%s\n', COST, hash);
console.log('Paste into seed-admin.sql (replace the username/full name):');
console.log(
  "  UPDATE engineers SET password = '%s', updated_at = now() WHERE username = 'CHANGE_ME_USERNAME';\n",
  hash,
);
