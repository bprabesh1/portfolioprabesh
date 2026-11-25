// Password hashing, sessions and the login / recovery flows.
import { fail, getCookie, sessionCookie, clientIp } from './http.mjs';
import { sha256Hex, randomHex, withinLimit } from './db.mjs';

const ITER = 100000; // the maximum PBKDF2 iteration count the Workers runtime allows
const SESSION_MS = 8 * 3600 * 1000;
const LOCK_AFTER = 5;
const LOCK_MS = 15 * 60 * 1000;
const enc = new TextEncoder();
const b64 = (u8) => btoa(String.fromCharCode(...u8));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function derive(secret, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}

export async function hashSecret(secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64(salt)}$${b64(await derive(secret, salt, ITER))}`;
}

function same(a, b) {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

export async function verifySecret(secret, stored) {
  const [scheme, iter, salt, hash] = String(stored).split('$');
  if (scheme !== 'pbkdf2' || !hash) return false;
  return same(await derive(secret, unb64(salt), Number(iter)), unb64(hash));
}

// Unknown usernames are verified against this so they cost the same time as known ones.
let dummy;
const getDummy = async () => (dummy ??= await hashSecret(randomHex(8)));

export function checkPassword(pw, username = '') {
  if (typeof pw !== 'string' || pw.length < 10 || pw.length > 128) fail(400, 'Password must be 10 to 128 characters.');
  if (!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) fail(400, 'Password needs at least one letter and one number.');
  if (username && pw.toLowerCase().includes(username.toLowerCase())) fail(400, 'Password must not contain the username.');
}

export const normalizeAnswer = (a) => String(a || '').trim().toLowerCase().replace(/\s+/g, ' ');

export const ipKey = async (req, secret) => (await sha256Hex(secret + clientIp(req))).slice(0, 24);

export async function startSession(db, adminId) {
  const token = randomHex(32);
  const csrf = randomHex(16);
  await db.run('DELETE FROM sessions WHERE expires < ?', Date.now());
  await db.run('INSERT INTO sessions (token_hash, admin_id, csrf, expires) VALUES (?, ?, ?, ?)',
    await sha256Hex(token), adminId, csrf, Date.now() + SESSION_MS);
  return { csrf, cookie: sessionCookie(token, SESSION_MS / 1000) };
}

export const endCookie = () => sessionCookie('', 0);

export async function currentAdmin(db, req) {
  const token = getCookie(req, '__Host-sid');
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  return db.one(
    `SELECT a.id, a.username, a.name, a.role, a.must_change, a.sec_q, s.csrf, s.token_hash
     FROM sessions s JOIN admins a ON a.id = s.admin_id WHERE s.token_hash = ? AND s.expires > ?`,
    await sha256Hex(token), Date.now());
}

export function checkCsrf(req, admin) {
  const sent = req.headers.get('x-csrf') || '';
  if (!sent || !same(enc.encode(sent), enc.encode(admin.csrf))) fail(403, 'Forbidden');
}

// Records a failed attempt and locks the account after repeated failures.
async function registerFailure(db, admin) {
  const failed = admin.failed + 1;
  await db.run('UPDATE admins SET failed = ?, locked_until = ? WHERE id = ?',
    failed >= LOCK_AFTER ? 0 : failed, failed >= LOCK_AFTER ? Date.now() + LOCK_MS : 0, admin.id);
}

export async function login(db, req, secret, { username, password }) {
  const ip = await ipKey(req, secret);
  if (!(await withinLimit(db, `login:${ip}`, 10, LOCK_MS))) fail(429, 'Too many attempts. Try again later.');
  const user = typeof username === 'string' ? username.trim().slice(0, 40) : '';
  const pass = typeof password === 'string' ? password.slice(0, 128) : '';
  const admin = user ? await db.one('SELECT * FROM admins WHERE username = ?', user) : null;
  const ok = await verifySecret(pass, admin ? admin.pass_hash : await getDummy());
  if (!admin || admin.locked_until > Date.now()) fail(401, 'Invalid username or password.');
  if (!ok) { await registerFailure(db, admin); fail(401, 'Invalid username or password.'); }
  await db.run('UPDATE admins SET failed = 0, locked_until = 0 WHERE id = ?', admin.id);
  return admin;
}

export async function recoveryQuestion(db, username) {
  const admin = await db.one('SELECT sec_q FROM admins WHERE username = ?', String(username || '').trim().slice(0, 40));
  return (admin && admin.sec_q) || 'What is the name of your first school?';
}

export async function recover(db, req, secret, { username, answer, password }) {
  const ip = await ipKey(req, secret);
  if (!(await withinLimit(db, `recover:${ip}`, 5, 3600 * 1000))) fail(429, 'Too many attempts. Try again later.');
  const admin = await db.one('SELECT * FROM admins WHERE username = ?', String(username || '').trim().slice(0, 40));
  const given = normalizeAnswer(answer);
  const ok = await verifySecret(given, admin && admin.sec_a_hash ? admin.sec_a_hash : await getDummy());
  if (!admin || !admin.sec_a_hash || admin.locked_until > Date.now()) fail(400, 'Recovery failed.');
  if (!ok) { await registerFailure(db, admin); fail(400, 'Recovery failed.'); }
  checkPassword(password, admin.username);
  await db.batch([
    db.stmt('UPDATE admins SET pass_hash = ?, must_change = 0, failed = 0, locked_until = 0 WHERE id = ?', await hashSecret(password), admin.id),
    db.stmt('DELETE FROM sessions WHERE admin_id = ?', admin.id),
  ]);
}
