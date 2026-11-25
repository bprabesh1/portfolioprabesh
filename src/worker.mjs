// Cloudflare Worker entry: routes /api/* (everything else is served as static assets).
import { useDb, randomHex } from './db.mjs';
import { HttpError, fail, json, readJson, sameOrigin } from './http.mjs';
import { login, recover, recoveryQuestion, startSession, endCookie, currentAdmin, checkCsrf } from './auth.mjs';
import { siteData, serveFile, submitContact, track } from './public.mjs';
import { adminRoute } from './admin.mjs';

async function secretOf(db) {
  const row = await db.one("SELECT value FROM settings WHERE key = '_secret'");
  if (row) return row.value;
  const value = randomHex(32);
  await db.run("INSERT OR IGNORE INTO settings (key, value) VALUES ('_secret', ?)", value);
  return (await db.one("SELECT value FROM settings WHERE key = '_secret'")).value;
}

async function handle(env, req) {
  const db = useDb(env);
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // drop "api"
  const [area, ...rest] = parts;
  const method = req.method;
  if (method !== 'GET' && method !== 'POST' && method !== 'PUT' && method !== 'DELETE') fail(405, 'Method not allowed');
  if (method !== 'GET') sameOrigin(req);

  if (area === 'site' && method === 'GET') {
    return json(await siteData(db), 200, { 'cache-control': 'no-cache' });
  }
  if (area === 'file' && method === 'GET' && rest.length === 1) return serveFile(db, rest[0]);
  if (area === 'contact' && method === 'POST') return submitContact(db, req, await secretOf(db));
  if (area === 'track' && method === 'POST') return track(db, req, await secretOf(db));

  if (area === 'auth') {
    const secret = await secretOf(db);
    if (rest[0] === 'login' && method === 'POST') {
      const admin = await login(db, req, secret, await readJson(req, 2048));
      const { csrf, cookie } = await startSession(db, admin.id);
      return json({ ok: true, csrf, must_change: !!admin.must_change }, 200, { 'set-cookie': cookie });
    }
    if (rest[0] === 'logout' && method === 'POST') {
      const me = await currentAdmin(db, req);
      if (me) await db.run('DELETE FROM sessions WHERE token_hash = ?', me.token_hash);
      return json({ ok: true }, 200, { 'set-cookie': endCookie() });
    }
    if (rest[0] === 'question' && method === 'POST') {
      return json({ question: await recoveryQuestion(db, (await readJson(req, 1024)).username) });
    }
    if (rest[0] === 'recover' && method === 'POST') {
      await recover(db, req, secret, await readJson(req, 2048));
      return json({ ok: true });
    }
    fail(404, 'Not found');
  }

  if (area === 'admin') {
    const me = await currentAdmin(db, req);
    if (!me) fail(401, 'Please sign in');
    if (method !== 'GET') checkCsrf(req, me);
    return adminRoute(db, req, url, me, rest);
  }
  return fail(404, 'Not found');
}

export default {
  async fetch(req, env) {
    try {
      return await handle(env, req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error('Unhandled error:', err && err.message);
      return json({ error: 'Something went wrong' }, 500);
    }
  },
};
