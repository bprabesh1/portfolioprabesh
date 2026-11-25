// Small HTTP helpers: responses, body parsing, cookies and origin checks.

const SECURITY = {
  'x-content-type-options': 'nosniff',
  'cache-control': 'no-store',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
};

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...SECURITY, 'content-type': 'application/json; charset=utf-8', ...headers },
  });
}

export function raw(bytes, headers) {
  return new Response(bytes, { headers: { ...SECURITY, ...headers } });
}

// Reads a JSON object body with a hard size cap.
export async function readJson(req, max = 32768) {
  if (!(req.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) fail(415, 'Expected JSON');
  const text = await readText(req, max);
  let data;
  try { data = JSON.parse(text || '{}'); } catch { fail(400, 'Invalid JSON'); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Invalid body');
  return data;
}

// Reads the body as a stream and stops as soon as it exceeds `max` bytes.
async function readLimited(req, max, message) {
  if (Number(req.headers.get('content-length') || 0) > max) fail(413, message);
  const out = new Uint8Array(max);
  let used = 0;
  if (req.body) {
    const reader = req.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (used + value.length > max) { await reader.cancel(); fail(413, message); }
      out.set(value, used);
      used += value.length;
    }
  }
  return out.subarray(0, used);
}

export const readText = async (req, max) => new TextDecoder().decode(await readLimited(req, max, 'Request too large'));
export const readBytes = (req, max) => readLimited(req, max, 'File too large');

export function getCookie(req, name) {
  for (const part of (req.headers.get('cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

export const sessionCookie = (token, maxAge) =>
  `__Host-sid=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;

// State-changing requests must come from this site's own origin.
export function sameOrigin(req) {
  const origin = req.headers.get('origin');
  if (!origin || origin !== new URL(req.url).origin) fail(403, 'Forbidden');
}

export const clientIp = (req) => req.headers.get('cf-connecting-ip') || '0.0.0.0';
