// Thin helpers over the D1 binding.

export function useDb(env) {
  const stmt = (sql, ...args) => env.DB.prepare(sql).bind(...args);
  return {
    stmt,
    all: async (sql, ...args) => (await stmt(sql, ...args).all()).results,
    one: (sql, ...args) => stmt(sql, ...args).first(),
    run: (sql, ...args) => stmt(sql, ...args).run(),
    batch: (list) => env.DB.batch(list),
  };
}

export async function sha256Hex(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const randomHex = (bytes) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');

// Fixed-window rate limiter stored in D1. Returns true while the caller is within the limit.
export async function withinLimit(db, key, max, windowMs) {
  const now = Date.now();
  await db.run(
    `INSERT INTO rate (k, n, reset) VALUES (?, 1, ?)
     ON CONFLICT(k) DO UPDATE SET
       n = CASE WHEN reset < ? THEN 1 ELSE n + 1 END,
       reset = CASE WHEN reset < ? THEN ? ELSE reset END`,
    key, now + windowMs, now, now, now + windowMs,
  );
  const row = await db.one('SELECT n FROM rate WHERE k = ?', key);
  return row.n <= max;
}
