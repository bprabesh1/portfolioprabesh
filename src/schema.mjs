// Database schema (D1 / SQLite) and the admin-editable resource definitions.

export const TABLES = [
  'rate', 'events', 'file_chunks', 'files', 'messages', 'sections', 'skills',
  'projects', 'certificates', 'milestones', 'sessions', 'admins', 'settings',
];

export const DDL = `
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super','editor')),
  pass_hash TEXT NOT NULL,
  must_change INTEGER NOT NULL DEFAULT 1,
  sec_q TEXT NOT NULL DEFAULT '',
  sec_a_hash TEXT NOT NULL DEFAULT '',
  failed INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  admin_id INTEGER NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
  csrf TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX sessions_admin ON sessions(admin_id);
CREATE TABLE milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('education','training','experience')),
  title TEXT NOT NULL,
  org TEXT NOT NULL DEFAULT '',
  date_label TEXT NOT NULL DEFAULT '',
  start_date TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  skills TEXT NOT NULL DEFAULT '[]',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE certificates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  issuer TEXT NOT NULL DEFAULT '',
  date_label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  file_id TEXT NOT NULL DEFAULT '',
  link TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  image_id TEXT NOT NULL DEFAULT '',
  repo_url TEXT NOT NULL DEFAULT '',
  live_url TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  visible INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  message TEXT NOT NULL,
  is_read INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE file_chunks (
  file_id TEXT NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (file_id, idx)
);
CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  path TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  ref TEXT NOT NULL DEFAULT '',
  device TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT '',
  visitor TEXT NOT NULL
);
CREATE INDEX events_ts ON events(ts);
CREATE TABLE rate (k TEXT PRIMARY KEY, n INTEGER NOT NULL, reset INTEGER NOT NULL);
`;

// Field types: s=text, e=enum, l=list of text, b=boolean, u=http(s) url, f=uploaded file id.
const text = (max, req = 0, extra = {}) => ({ t: 's', max, req, ...extra });
const flag = { t: 'b' };

export const RES = {
  milestones: {
    group: 'kind',
    cols: {
      kind: { t: 'e', v: ['education', 'training', 'experience'], req: 1 },
      title: text(160, 1),
      org: text(200),
      date_label: text(60),
      start_date: text(7, 0, { re: /^(\d{4}(-(0[1-9]|1[0-2]))?)?$/ }),
      description: text(1500),
      skills: { t: 'l', n: 12, max: 60 },
      visible: flag,
    },
  },
  certificates: {
    cols: {
      title: text(160, 1), issuer: text(160), date_label: text(60), description: text(600),
      file_id: { t: 'f' }, link: { t: 'u' }, visible: flag,
    },
  },
  projects: {
    cols: {
      title: text(160, 1), description: text(1200), tags: { t: 'l', n: 12, max: 40 },
      image_id: { t: 'f' }, repo_url: { t: 'u' }, live_url: { t: 'u' }, status: text(40), visible: flag,
    },
  },
  skills: {
    group: 'category',
    cols: { category: text(60, 1), name: text(80, 1), visible: flag },
  },
  sections: {
    cols: { title: text(80, 1), tagline: text(160), body: text(4000), visible: flag },
  },
};
