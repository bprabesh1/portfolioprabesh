// Public (visitor-facing) API: site content, files, contact form and analytics beacons.
import { SETTINGS } from './content.mjs';
import { fail, json, raw, readJson, getCookie, clientIp } from './http.mjs';
import { sha256Hex, withinLimit } from './db.mjs';
import { ipKey } from './auth.mjs';

export async function settingsMap(db) {
  const out = {};
  for (const [k, d] of Object.entries(SETTINGS)) out[k] = d[2];
  for (const r of await db.all("SELECT key, value FROM settings WHERE key NOT LIKE '\\_%' ESCAPE '\\'")) {
    if (r.key in SETTINGS) out[r.key] = r.value;
  }
  return out;
}

const parseList = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch { return []; } };

export async function siteData(db) {
  const [settings, milestones, certificates, projects, skills, sections] = await Promise.all([
    settingsMap(db),
    db.all('SELECT id, kind, title, org, date_label, description, skills FROM milestones WHERE visible = 1 ORDER BY sort_order, id'),
    db.all('SELECT c.id, c.title, c.issuer, c.date_label, c.description, c.file_id, c.link, f.mime FROM certificates c LEFT JOIN files f ON f.id = c.file_id WHERE c.visible = 1 ORDER BY c.sort_order, c.id'),
    db.all('SELECT id, title, description, tags, image_id, repo_url, live_url, status FROM projects WHERE visible = 1 ORDER BY sort_order, id'),
    db.all('SELECT id, category, name FROM skills WHERE visible = 1 ORDER BY sort_order, id'),
    db.all('SELECT id, title, tagline, body FROM sections WHERE visible = 1 ORDER BY sort_order, id'),
  ]);
  for (const m of milestones) m.skills = parseList(m.skills);
  for (const p of projects) p.tags = parseList(p.tags);
  return { settings, milestones, certificates, projects, skills, sections };
}

const MIME_OK = /^[a-z]+\/[a-z0-9.+-]+$/;

export async function serveFile(db, id) {
  if (!/^[0-9a-f]{32}$/.test(id)) fail(404, 'Not found');
  const file = await db.one('SELECT mime, name FROM files WHERE id = ?', id);
  if (!file || !MIME_OK.test(file.mime)) fail(404, 'Not found');
  const chunks = await db.all('SELECT data FROM file_chunks WHERE file_id = ? ORDER BY idx', id);
  const bin = atob(chunks.map((c) => c.data).join(''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const safeName = file.name.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 80) || 'file';
  return raw(bytes, {
    'content-type': file.mime,
    'content-disposition': `inline; filename="${safeName}"`,
    'cache-control': 'public, max-age=31536000, immutable',
    // images are sandboxed; a sandbox CSP would stop the browser's PDF viewer from opening PDFs
    'content-security-policy': file.mime === 'application/pdf' ? "default-src 'none'" : "default-src 'none'; sandbox",
  });
}

const EMAIL = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}\.[A-Za-z]{2,}$/;
const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max) : '');

export async function submitContact(db, req, secret) {
  const d = await readJson(req, 8192);
  if (clean(d.website, 50)) return json({ ok: true }); // honeypot: bots fill this in
  const ip = await ipKey(req, secret);
  if (!(await withinLimit(db, `contact:${ip}`, 5, 3600 * 1000)) || !(await withinLimit(db, 'contact:all', 100, 3600 * 1000))) {
    fail(429, 'Too many messages. Please try again later.');
  }
  const name = clean(d.name, 80);
  const email = clean(d.email, 120);
  const phone = clean(d.phone, 30);
  const subject = clean(d.subject, 120);
  const message = clean(d.message, 3000);
  if (!name) fail(400, 'Please enter your name.');
  if (!EMAIL.test(email)) fail(400, 'Please enter a valid email address.');
  if (phone && !/^[0-9+()\-\s]{5,30}$/.test(phone)) fail(400, 'Please enter a valid phone number or leave it empty.');
  if (message.length < 5) fail(400, 'Please write a message.');
  await db.run('INSERT INTO messages (name, email, phone, subject, message, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    name, email, phone, subject, message, Date.now());
  return json({ ok: true });
}

// ---- Cookieless analytics ----
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|headless|lighthouse|preview|monitor|curl|wget|python|axios|node-fetch/i;
const seen = new Map(); // per-isolate burst limiter
const TARGET = /^[a-z0-9:_ \-]{1,60}$/i;
const PATH = /^\/(journey)?$/;

export async function track(db, req, secret) {
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOT.test(ua) || getCookie(req, '__Host-sid')) return new Response(null, { status: 204 });
  const ip = await ipKey(req, secret);
  const minute = Math.floor(Date.now() / 60000);
  const rec = seen.get(ip);
  if (!rec || rec.m !== minute) seen.set(ip, { m: minute, n: 1 });
  else if (++rec.n > 40) return new Response(null, { status: 204 });
  if (seen.size > 5000) seen.clear();

  const d = await readJson(req, 1024);
  const kind = d.t === 'click' ? 'click' : d.t === 'view' ? 'view' : '';
  if (!kind || typeof d.p !== 'string' || !PATH.test(d.p)) fail(400, 'Bad event');
  const target = kind === 'click' ? clean(d.x, 60) : '';
  if (kind === 'click' && !TARGET.test(target)) fail(400, 'Bad event');
  let ref = '';
  if (kind === 'view' && typeof d.r === 'string') {
    try { const u = new URL(d.r); if (/^https?:$/.test(u.protocol) && u.host !== new URL(req.url).host) ref = u.host.slice(0, 80); } catch { /* ignore */ }
  }
  const device = /ipad|tablet/i.test(ua) ? 'tablet' : /mobi|android|iphone/i.test(ua) ? 'mobile' : 'desktop';
  const day = new Date(Date.now() + 20700000).toISOString().slice(0, 10);
  const visitor = (await sha256Hex(`${secret}|${clientIp(req)}|${ua}|${day}`)).slice(0, 16);
  await db.run('INSERT INTO events (ts, kind, path, target, ref, device, country, visitor) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    Date.now(), kind, d.p, target, ref, device, String(req.cf?.country || '').slice(0, 2), visitor);
  if (Math.random() < 0.01) await db.run('DELETE FROM events WHERE ts < ?', Date.now() - 180 * 86400000);
  return new Response(null, { status: 204 });
}
