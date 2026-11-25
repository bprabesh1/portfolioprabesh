# Prabesh Bhusal: portfolio

Static pages plus one Cloudflare Worker (`src/`) and a D1 database. No runtime dependencies, no build step.

| Path | What it is |
|---|---|
| `/` | Home: hero, About, Education, Training, Certificates, Experience, Projects, Skills, extra sections, Contact |
| `/journey/` | Animated climb through every checkpoint |
| `/prabeshadmin/` | Admin panel |

## Deploy (Cloudflare, free plan)

1. Push this folder to GitHub (the existing `portfoliomine` repo; replace its files, keep nothing from the old version).
2. In `wrangler.toml` set `database_id` to the id of your D1 database (Cloudflare dashboard > Storage & Databases > D1).
3. Cloudflare dashboard > D1 > your database > Console: paste the whole of `d1/setup.sql` (sent separately, never commit it) and run it. **This deletes the tables it recreates**, so export anything you want to keep first.
4. Workers & Pages > your project > Deployments: the push deploys automatically.
5. Open `/prabeshadmin/`, sign in as `prabesh` with the temporary password, and choose a new one when asked.

Regenerate `setup.sql` yourself: `ADMIN_PASSWORD='your-temporary-password' node scripts/build-sql.mjs` (Node 20+).

## Lost your password

- Security question: set one under My account, then use "Forgot password?" on the sign-in page.
- Otherwise: `ADMIN_USERNAME=prabesh NEW_PASSWORD='new-temporary-password' node scripts/reset-password-sql.mjs`, then run `d1/reset-password.sql` in the D1 console.

## Editing content

Everything is editable in the admin panel: names, taglines and section headings (Site content), Education / Training / Experience (arrows reorder, "Sort by start date" orders automatically), Certificates, Projects, Skills, extra sections, messages, admins. A section with no entries is hidden from the site and the menu.

## Security notes

- Strict CSP (no inline scripts or styles), HSTS, nosniff, frame denial, COOP/CORP.
- Passwords: PBKDF2-SHA256 (100k iterations, the Workers maximum), per-user salt; 10+ characters with letters and numbers. Sessions: random 256-bit token, only its hash is stored, `__Host-` HttpOnly Secure SameSite=Strict cookie, 8 hours.
- CSRF: per-session token header plus strict same-origin check on every write.
- Login: per-IP rate limit and 15-minute account lock after 5 failures; unknown users take the same time as known ones.
- Contact form: honeypot, per-IP and global hourly limits, strict validation, stored and displayed as plain text only.
- Uploads: signature-checked PNG/JPEG/WebP/GIF/PDF only (no SVG), size-capped, served with a locked-down CSP and `nosniff`.
- All SQL is parameterised; column and table names come from fixed whitelists.
- Analytics are cookieless; visitor ids are daily salted hashes, IPs are never stored.

## Free-plan limits

100,000 Worker requests/day, D1 5 million reads and 100,000 writes/day, 5 GB storage. Each page view costs one write. Uploads are stored in D1: keep images under 1.5 MB and PDFs under 4 MB.

Fonts: Anton and DM Sans (SIL Open Font License, see `public/assets/fonts`).
