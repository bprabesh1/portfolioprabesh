// Admin API (every route here requires a signed-in admin; see worker.mjs).
import { RES } from './schema.mjs';
import { SETTINGS, IMAGE_KEYS } from './content.mjs';
import { fail, json, readJson, readBytes } from './http.mjs';
import { randomHex } from './db.mjs';
import { hashSecret, verifySecret, checkPassword, normalizeAnswer } from './auth.mjs';
import { settingsMap } from './public.mjs';

const FILE_ID = /^[0-9a-f]{32}$/;
const DAY = 86400000;
const OFFSET = 20700000; // Nepal time, UTC+5:45

// ---------- validation ----------
async function cleanValue(db, name, def, v) {
  if (def.t === 'b') return v ? 1 : 0;
  if (def.t === 'l') {
    const list = Array.isArray(v) ? v : String(v ?? '').split(/[\n,]/);
    const out = list.map((x) => String(x).trim()).filter(Boolean);
    if (out.length > def.n || out.some((x) => x.length > def.max)) fail(400, `${name}: too many or too long items`);
    return JSON.stringify(out);
  }
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : fail(400, `${name}: invalid value`);
  if (def.t === 's') {
    if (s.length > def.max) fail(400, `${name}: too long`);
    if (def.req && !s) fail(400, `${name} is required`);
    if (def.re && !def.re.test(s)) fail(400, `${name}: invalid format`);
    return s;
  }
  if (def.t === 'e') return def.v.includes(s) ? s : fail(400, `${name}: invalid choice`);
  if (def.t === 'u') {
    if (!s) return '';
    let u; try { u = new URL(s); } catch { fail(400, `${name}: invalid link`); }
    if (!/^https?:$/.test(u.protocol) || s.length > 300) fail(400, `${name}: link must start with http:// or https://`);
    return s;
  }
  if (def.t === 'f') {
    if (!s) return '';
    if (!FILE_ID.test(s) || !(await db.one('SELECT 1 AS x FROM files WHERE id = ?', s))) fail(400, `${name}: unknown file`);
    return s;
  }
  return fail(400, 'Invalid field');
}

async function cleanRow(db, def, data, partial) {
  const out = {};
  for (const [name, d] of Object.entries(def.cols)) {
    if (partial && !(name in data)) continue;
    out[name] = await cleanValue(db, name, d, d.t === 'b' && !(name in data) ? 1 : data[name]);
  }
  return out;
}

// ---------- generic resources ----------
const rows = (db, table) => db.all(`SELECT * FROM ${table} ORDER BY sort_order, id`);

async function orphanFiles(db) {
  await db.run(`DELETE FROM files WHERE created_at < ? AND id NOT IN (
    SELECT file_id FROM certificates WHERE file_id != '' UNION SELECT image_id FROM projects WHERE image_id != ''
    UNION SELECT value FROM settings WHERE key IN (${IMAGE_KEYS.map(() => '?').join(',')}))`,
  Date.now() - 3600000, ...IMAGE_KEYS);
  await db.run('DELETE FROM file_chunks WHERE file_id NOT IN (SELECT id FROM files)');
}

async function renumber(db, table, ids) {
  await db.batch(ids.map((id, i) => db.stmt(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, i + 1, id)));
}

async function resource(db, req, name, rest) {
  const def = RES[name];
  const id = rest[0] && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null;
  const method = req.method;

  if (method === 'GET' && !rest.length) return json(await rows(db, name));

  if (method === 'POST' && !rest.length) {
    const row = await cleanRow(db, def, await readJson(req), false);
    const max = await db.one(`SELECT COALESCE(MAX(sort_order), 0) AS m FROM ${name}`);
    const cols = [...Object.keys(row), 'sort_order'];
    const res = await db.run(`INSERT INTO ${name} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`, ...Object.values(row), max.m + 1);
    return json({ id: res.meta.last_row_id }, 201);
  }

  if (name === 'milestones' && method === 'POST' && rest[0] === 'sort-by-date') {
    const all = await db.all('SELECT id, start_date FROM milestones ORDER BY sort_order, id');
    all.sort((a, b) => (a.start_date || '9999').localeCompare(b.start_date || '9999') || a.id - b.id);
    await renumber(db, 'milestones', all.map((r) => r.id));
    return json({ ok: true });
  }

  if (name === 'skills' && method === 'POST' && rest[0] === 'bulk') {
    const d = await readJson(req);
    const category = await cleanValue(db, 'category', def.cols.category, d.category);
    const names = String(d.names || '').split(/[\n,]/).map((x) => x.trim()).filter(Boolean).slice(0, 60);
    if (!names.length) fail(400, 'Enter at least one skill');
    const max = await db.one('SELECT COALESCE(MAX(sort_order), 0) AS m FROM skills');
    await db.batch(names.map((n, i) => db.stmt('INSERT INTO skills (category, name, sort_order) VALUES (?, ?, ?)',
      category, n.slice(0, 80), max.m + i + 1)));
    return json({ added: names.length }, 201);
  }

  if (id === null) fail(404, 'Not found');
  const existing = await db.one(`SELECT * FROM ${name} WHERE id = ?`, id);
  if (!existing) fail(404, 'Not found');

  if (method === 'PUT' && rest.length === 1) {
    const row = await cleanRow(db, def, await readJson(req), true);
    const cols = Object.keys(row);
    if (cols.length) await db.run(`UPDATE ${name} SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, ...Object.values(row), id);
    await orphanFiles(db);
    return json({ ok: true });
  }

  if (method === 'DELETE' && rest.length === 1) {
    await db.run(`DELETE FROM ${name} WHERE id = ?`, id);
    await orphanFiles(db);
    return json({ ok: true });
  }

  if (method === 'POST' && rest[1] === 'move') {
    const { dir } = await readJson(req);
    if (dir !== 'up' && dir !== 'down') fail(400, 'Invalid direction');
    const group = def.group;
    const list = group
      ? await db.all(`SELECT id FROM ${name} WHERE ${group} = ? ORDER BY sort_order, id`, existing[group])
      : await db.all(`SELECT id FROM ${name} ORDER BY sort_order, id`);
    const ids = list.map((r) => r.id);
    const i = ids.indexOf(id);
    const j = dir === 'up' ? i - 1 : i + 1;
    if (j >= 0 && j < ids.length) {
      // swap the two positions, keeping the group's existing set of sort values
      const orders = (await db.all(`SELECT id, sort_order FROM ${name} WHERE id IN (?, ?)`, ids[i], ids[j]));
      const so = Object.fromEntries(orders.map((r) => [r.id, r.sort_order]));
      const a = so[ids[i]], b = so[ids[j]];
      if (a === b) { await renumber(db, name, (await db.all(`SELECT id FROM ${name} ORDER BY sort_order, id`)).map((r) => r.id)); return json({ ok: true, again: true }); }
      await db.batch([db.stmt(`UPDATE ${name} SET sort_order = ? WHERE id = ?`, b, ids[i]), db.stmt(`UPDATE ${name} SET sort_order = ? WHERE id = ?`, a, ids[j])]);
    }
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

// ---------- settings ----------
async function settings(db, req) {
  if (req.method === 'GET') {
    const values = await settingsMap(db);
    return json(Object.entries(SETTINGS).map(([key, d]) => ({ key, group: d[0], label: d[1], max: d[3], kind: d[4] || 'line', value: values[key] })));
  }
  if (req.method !== 'PUT') fail(405, 'Method not allowed');
  const data = await readJson(req, 65536);
  const stmts = [];
  for (const [key, v] of Object.entries(data)) {
    const d = SETTINGS[key];
    if (!d) fail(400, `Unknown setting: ${key}`);
    let value = typeof v === 'string' ? v.replace(/\r\n/g, '\n').trim() : fail(400, `${key}: invalid value`);
    if (value.length > d[3]) fail(400, `${key}: too long`);
    if (d[4] === 'image' || d[4] === 'pdf') await cleanValue(db, key, { t: 'f' }, value);
    if (/^contact_(github|linkedin|website)$/.test(key)) await cleanValue(db, key, { t: 'u' }, value);
    stmts.push(db.stmt('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, value));
  }
  if (stmts.length) await db.batch(stmts);
  await orphanFiles(db);
  return json({ ok: true });
}

// ---------- uploads ----------
const SIGNATURES = [
  ['image/png', (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47],
  ['image/jpeg', (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ['image/webp', (b) => b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50],
  ['image/gif', (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38],
  ['application/pdf', (b) => b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46 && b[4] === 0x2d],
];
const CHUNK = 400000;

async function upload(db, req, url) {
  if (req.method !== 'POST') fail(405, 'Method not allowed');
  const kind = url.searchParams.get('kind');
  if (kind !== 'image' && kind !== 'doc') fail(400, 'Invalid kind');
  const bytes = await readBytes(req, kind === 'image' ? 1500000 : 4000000);
  const sig = SIGNATURES.find(([, test]) => bytes.length > 12 && test(bytes));
  if (!sig || (kind === 'image' && sig[0] === 'application/pdf')) fail(400, kind === 'image' ? 'Please upload a PNG, JPG, WebP or GIF image.' : 'Please upload a PDF or an image.');
  if (sig[0] === 'application/pdf' && bytes.length > 4000000) fail(413, 'File too large');
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) bin += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const data = btoa(bin);
  const id = randomHex(16);
  const name = (url.searchParams.get('name') || 'file').replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 80);
  await db.run('INSERT INTO files (id, mime, name, size, created_at) VALUES (?, ?, ?, ?, ?)', id, sig[0], name, bytes.length, Date.now());
  for (let i = 0, n = 0; i < data.length; i += CHUNK, n++) {
    await db.run('INSERT INTO file_chunks (file_id, idx, data) VALUES (?, ?, ?)', id, n, data.slice(i, i + CHUNK));
  }
  return json({ id, mime: sig[0] }, 201);
}

// ---------- messages ----------
async function messages(db, req, url, rest) {
  if (req.method === 'GET' && !rest.length) {
    const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const list = await db.all(
      `SELECT * FROM messages WHERE (? = '' OR name LIKE ? ESCAPE '\\' OR email LIKE ? ESCAPE '\\' OR subject LIKE ? ESCAPE '\\' OR message LIKE ? ESCAPE '\\')
       ORDER BY id DESC LIMIT 500`, q, like, like, like, like);
    return json(list);
  }
  if (req.method === 'POST' && rest[0] === 'bulk') {
    const { ids, action } = await readJson(req);
    if (!Array.isArray(ids) || ids.length > 200 || !ids.every((n) => Number.isInteger(n))) fail(400, 'Invalid selection');
    if (!['read', 'unread', 'delete'].includes(action)) fail(400, 'Invalid action');
    const sql = action === 'delete' ? 'DELETE FROM messages WHERE id = ?' : `UPDATE messages SET is_read = ${action === 'read' ? 1 : 0} WHERE id = ?`;
    if (ids.length) await db.batch(ids.map((i) => db.stmt(sql, i)));
    return json({ ok: true });
  }
  fail(404, 'Not found');
}

// ---------- admins ----------
async function admins(db, req, me, rest) {
  if (me.role !== 'super') fail(403, 'Only the super admin can manage admins');
  const id = rest[0] && /^\d+$/.test(rest[0]) ? Number(rest[0]) : null;
  const cleanName = (v) => { const s = String(v || '').trim(); if (!s || s.length > 60) fail(400, 'Name is required (60 characters max)'); return s; };
  const cleanRole = (v) => (v === 'super' || v === 'editor' ? v : fail(400, 'Invalid role'));

  if (req.method === 'GET' && id === null) {
    return json(await db.all('SELECT id, username, name, role, must_change, created_at FROM admins ORDER BY id'));
  }
  if (req.method === 'POST' && id === null) {
    const d = await readJson(req);
    const username = String(d.username || '').trim();
    if (!/^[A-Za-z0-9_.-]{3,30}$/.test(username)) fail(400, 'Username: 3 to 30 letters, numbers, dot, dash or underscore');
    checkPassword(d.password, username);
    if (await db.one('SELECT 1 AS x FROM admins WHERE username = ?', username)) fail(409, 'That username already exists');
    await db.run('INSERT INTO admins (username, name, role, pass_hash, must_change, created_at) VALUES (?, ?, ?, ?, 1, ?)',
      username, cleanName(d.name), cleanRole(d.role), await hashSecret(d.password), Date.now());
    return json({ ok: true }, 201);
  }
  if (id === null) fail(404, 'Not found');
  const target = await db.one('SELECT * FROM admins WHERE id = ?', id);
  if (!target) fail(404, 'Not found');
  const supers = (await db.one("SELECT COUNT(*) AS n FROM admins WHERE role = 'super'")).n;

  if (req.method === 'PUT') {
    const d = await readJson(req);
    const role = cleanRole(d.role);
    if (target.role === 'super' && role !== 'super' && supers <= 1) fail(400, 'There must be at least one super admin');
    await db.run('UPDATE admins SET name = ?, role = ? WHERE id = ?', cleanName(d.name), role, id);
    if (role !== target.role) await db.run('DELETE FROM sessions WHERE admin_id = ?', id);
    return json({ ok: true });
  }
  if (req.method === 'POST' && rest[1] === 'password') {
    const d = await readJson(req);
    checkPassword(d.password, target.username);
    await db.batch([
      db.stmt('UPDATE admins SET pass_hash = ?, must_change = 1, failed = 0, locked_until = 0 WHERE id = ?', await hashSecret(d.password), id),
      db.stmt('DELETE FROM sessions WHERE admin_id = ?', id),
    ]);
    return json({ ok: true });
  }
  if (req.method === 'DELETE') {
    if (id === me.id) fail(400, 'You cannot delete your own account');
    if (target.role === 'super' && supers <= 1) fail(400, 'There must be at least one super admin');
    await db.run('DELETE FROM admins WHERE id = ?', id);
    return json({ ok: true });
  }
  return fail(404, 'Not found');
}

// ---------- own account ----------
export async function changePassword(db, me, d) {
  const row = await db.one('SELECT pass_hash FROM admins WHERE id = ?', me.id);
  if (typeof d.current !== 'string' || !(await verifySecret(d.current, row.pass_hash))) fail(400, 'Current password is incorrect');
  checkPassword(d.password, me.username);
  if (d.password === d.current) fail(400, 'Choose a different password');
  await db.batch([
    db.stmt('UPDATE admins SET pass_hash = ?, must_change = 0 WHERE id = ?', await hashSecret(d.password), me.id),
    db.stmt('DELETE FROM sessions WHERE admin_id = ? AND token_hash != ?', me.id, me.token_hash),
  ]);
}

async function account(db, req, me) {
  const d = await readJson(req);
  const name = String(d.name || '').trim();
  if (!name || name.length > 60) fail(400, 'Name is required (60 characters max)');
  const q = String(d.sec_q || '').trim().slice(0, 120);
  const a = normalizeAnswer(d.sec_a);
  if (a && (!q || a.length < 4)) fail(400, 'Security answer must be at least 4 characters and needs a question');
  if (a) await db.run('UPDATE admins SET name = ?, sec_q = ?, sec_a_hash = ? WHERE id = ?', name, q, await hashSecret(a), me.id);
  else await db.run('UPDATE admins SET name = ? WHERE id = ?', name, me.id);
  return json({ ok: true });
}

// ---------- dashboard ----------
async function dashboard(db) {
  const now = Date.now();
  const since = (days) => now - days * DAY;
  const [online, daily, pages, refs, devices, countries, clicks, unread, msgs] = await Promise.all([
    db.one("SELECT COUNT(DISTINCT visitor) AS n FROM events WHERE ts > ?", now - 5 * 60000),
    db.all(`SELECT date((ts + ${OFFSET}) / 1000, 'unixepoch') AS day, COUNT(*) AS views, COUNT(DISTINCT visitor) AS visitors
            FROM events WHERE kind = 'view' AND ts > ? GROUP BY day ORDER BY day`, since(30)),
    db.all("SELECT path AS label, COUNT(*) AS n FROM events WHERE kind = 'view' AND ts > ? GROUP BY path ORDER BY n DESC LIMIT 10", since(30)),
    db.all("SELECT ref AS label, COUNT(*) AS n FROM events WHERE kind = 'view' AND ref != '' AND ts > ? GROUP BY ref ORDER BY n DESC LIMIT 10", since(30)),
    db.all("SELECT device AS label, COUNT(*) AS n FROM events WHERE kind = 'view' AND ts > ? GROUP BY device ORDER BY n DESC", since(30)),
    db.all("SELECT country AS label, COUNT(*) AS n FROM events WHERE kind = 'view' AND country != '' AND ts > ? GROUP BY country ORDER BY n DESC LIMIT 10", since(30)),
    db.all("SELECT target AS label, COUNT(*) AS n FROM events WHERE kind = 'click' AND ts > ? GROUP BY target ORDER BY n DESC LIMIT 15", since(30)),
    db.one('SELECT COUNT(*) AS n FROM messages WHERE is_read = 0'),
    db.one('SELECT COUNT(*) AS n FROM messages'),
  ]);
  const periods = {};
  for (const days of [7, 30, 90]) {
    const r = await db.one(`SELECT SUM(kind = 'view') AS views, COUNT(DISTINCT CASE WHEN kind = 'view' THEN visitor END) AS visitors, SUM(kind = 'click') AS clicks
                            FROM events WHERE ts > ?`, since(days));
    periods[days] = { views: r.views || 0, visitors: r.visitors || 0, clicks: r.clicks || 0 };
  }
  return json({ periods, online: online.n, daily, pages, refs, devices, countries, clicks, unread: unread.n, messages: msgs.n });
}

// ---------- router ----------
export async function adminRoute(db, req, url, me, parts) {
  const [head, ...rest] = parts;
  if (head === 'me' && req.method === 'GET') return json({ id: me.id, username: me.username, name: me.name, role: me.role, must_change: !!me.must_change, sec_q: me.sec_q, csrf: me.csrf });
  if (head === 'password' && req.method === 'POST') { await changePassword(db, me, await readJson(req)); return json({ ok: true }); }
  if (me.must_change) fail(403, 'Please change your password first');
  if (head === 'account' && req.method === 'PUT') return account(db, req, me);
  if (head === 'dashboard' && req.method === 'GET') return dashboard(db);
  if (head === 'settings') return settings(db, req);
  if (head === 'upload') return upload(db, req, url);
  if (head === 'messages') return messages(db, req, url, rest);
  if (head === 'admins') return admins(db, req, me, rest);
  if (Object.hasOwn(RES, head)) return resource(db, req, head, rest);
  return fail(404, 'Not found');
}
