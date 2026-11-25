// Emergency access: generates d1/reset-password.sql for one admin (run it in the D1 console).
// Usage: ADMIN_USERNAME=prabesh NEW_PASSWORD='a-strong-password' node scripts/reset-password-sql.mjs
import { writeFileSync } from 'node:fs';
import { hashSecret, checkPassword } from '../src/auth.mjs';

const username = process.env.ADMIN_USERNAME;
const password = process.env.NEW_PASSWORD;
if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username || '')) throw new Error('Set ADMIN_USERNAME');
checkPassword(password, username);
const hash = await hashSecret(password);
writeFileSync(new URL('../d1/reset-password.sql', import.meta.url),
  `UPDATE admins SET pass_hash = '${hash}', must_change = 1, failed = 0, locked_until = 0 WHERE username = '${username}';\n` +
  `DELETE FROM sessions WHERE admin_id IN (SELECT id FROM admins WHERE username = '${username}');\n`);
console.log('d1/reset-password.sql written.');
