// Generates d1/setup.sql (fresh schema + starter content + first admin).
// Usage: ADMIN_PASSWORD='a-strong-password' node scripts/build-sql.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { TABLES, DDL } from '../src/schema.mjs';
import { SEED } from '../src/content.mjs';
import { hashSecret, checkPassword } from '../src/auth.mjs';
import { randomHex } from '../src/db.mjs';

const password = process.env.ADMIN_PASSWORD;
const username = process.env.ADMIN_USERNAME || 'prabesh';
checkPassword(password, username);

const q = (v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table, cols, values) => `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${values.map(q).join(', ')});`;
const now = Date.now();

const out = [
  '-- Prabesh portfolio: fresh database. This DELETES any existing tables with the same names.',
  ...TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`),
  DDL.trim(),
  insert('settings', ['key', 'value'], ['_secret', randomHex(32)]),
  insert('admins', ['username', 'name', 'role', 'pass_hash', 'must_change', 'created_at'],
    [username, 'Prabesh Bhusal', 'super', await hashSecret(password), 1, now]),
];
SEED.milestones.forEach((m, i) => out.push(insert('milestones',
  ['kind', 'title', 'org', 'date_label', 'start_date', 'description', 'skills', 'sort_order'],
  [m[0], m[1], m[2], m[3], m[4], m[5], JSON.stringify(m[6]), i + 1])));
SEED.projects.forEach((p, i) => out.push(insert('projects',
  ['title', 'description', 'tags', 'sort_order'], [p[0], p[1], JSON.stringify(p[2]), i + 1])));
let order = 0;
for (const [category, names] of Object.entries(SEED.skills)) {
  for (const name of names) out.push(insert('skills', ['category', 'name', 'sort_order'], [category, name, ++order]));
}
mkdirSync(new URL('../d1/', import.meta.url), { recursive: true });
writeFileSync(new URL('../d1/setup.sql', import.meta.url), out.join('\n') + '\n');
console.log(`d1/setup.sql written. First sign-in: ${username} (password you supplied; you must change it at first login).`);
