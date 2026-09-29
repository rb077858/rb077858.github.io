-- reem.bi SSO — D1 schema
-- Apply with:  npx wrangler d1 execute reem-sso --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS users (
  id              TEXT PRIMARY KEY,
  email           TEXT NOT NULL UNIQUE,
  name            TEXT NOT NULL DEFAULT '',
  avatar          TEXT NOT NULL DEFAULT '',
  password_hash   TEXT,
  google_sub      TEXT UNIQUE,
  email_verified  INTEGER NOT NULL DEFAULT 0,
  role            TEXT NOT NULL DEFAULT 'user',      -- 'user' | 'admin'
  disabled        INTEGER NOT NULL DEFAULT 0,
  notes           TEXT NOT NULL DEFAULT '',
  created_at      INTEGER NOT NULL,
  last_login_at   INTEGER
);

-- client_id NULL = session on login.reembir.com itself (cookie);
-- otherwise a bearer token handed to that site.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,                     -- sha256(token)
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id   TEXT,
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER NOT NULL,
  user_agent  TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- One-time tokens sent by email: magic links, password resets, email verification.
CREATE TABLE IF NOT EXISTS email_tokens (
  id          TEXT PRIMARY KEY,                     -- sha256(token)
  type        TEXT NOT NULL,                        -- 'magic' | 'reset' | 'verify'
  email       TEXT NOT NULL,
  data        TEXT NOT NULL DEFAULT '{}',
  expires_at  INTEGER NOT NULL,
  used_at     INTEGER
);

CREATE TABLE IF NOT EXISTS auth_codes (
  id              TEXT PRIMARY KEY,                 -- sha256(code)
  user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id       TEXT NOT NULL,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,
  expires_at      INTEGER NOT NULL
);

-- Every site / project that signs in through login.reembir.com.
CREATE TABLE IF NOT EXISTS sites (
  id             TEXT PRIMARY KEY,                  -- client_id, e.g. 'neverlost'
  name           TEXT NOT NULL,
  description    TEXT NOT NULL DEFAULT '',
  url            TEXT NOT NULL DEFAULT '',
  redirect_uris  TEXT NOT NULL DEFAULT '[]',        -- JSON array of allowed URL prefixes
  access_mode    TEXT NOT NULL DEFAULT 'open',      -- 'open' | 'approval' | 'invite'
  default_plan   TEXT,                              -- plans.id
  created_at     INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS plans (
  id          TEXT PRIMARY KEY,                     -- e.g. 'neverlost:pro'
  site_id     TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  features    TEXT NOT NULL DEFAULT '{}',           -- JSON, read by the site (e.g. {"tag_limit":50})
  sort        INTEGER NOT NULL DEFAULT 0
);

-- What each user may do on each site.
CREATE TABLE IF NOT EXISTS access (
  user_id            TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  site_id            TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  status             TEXT NOT NULL DEFAULT 'active', -- 'active' | 'pending' | 'blocked'
  plan_id            TEXT,                           -- NULL = site's default plan
  plan_expires_at    INTEGER,                        -- NULL = never expires
  features_override  TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL,
  last_used_at       INTEGER,
  PRIMARY KEY (user_id, site_id)
);

CREATE TABLE IF NOT EXISTS wall (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id     TEXT NOT NULL,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message     TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS wall_site ON wall(site_id, id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key           TEXT PRIMARY KEY,
  count         INTEGER NOT NULL,
  window_start  INTEGER NOT NULL
);

-- ---------- Seed: the sites that exist today ----------
INSERT OR IGNORE INTO sites (id, name, description, url, redirect_uris, access_mode, default_plan, created_at) VALUES
  ('reembir', 'reem.bi', 'האתר הראשי', 'https://reembir.com/',
   '["https://reembir.com/","https://www.reembir.com/"]', 'open', NULL, unixepoch()),
  ('neverlost', 'NeverLost', 'תגי QR לחפצים אבודים', 'https://reembir.com/neverlost/',
   '["https://reembir.com/neverlost/","https://rb077858.github.io/neverlost/"]', 'open', 'neverlost:free', unixepoch());

INSERT OR IGNORE INTO plans (id, site_id, name, features, sort) VALUES
  ('neverlost:free',      'neverlost', 'Free',      '{"tag_limit":5}',   0),
  ('neverlost:pro',       'neverlost', 'Pro',       '{"tag_limit":50}',  1),
  ('neverlost:unlimited', 'neverlost', 'Unlimited', '{"tag_limit":-1}',  2);

-- Emails sent from the admin dashboard (also created automatically on first use).
CREATE TABLE IF NOT EXISTS email_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, sent_by TEXT NOT NULL, from_addr TEXT NOT NULL, reply_to TEXT,
  subject TEXT NOT NULL, body TEXT NOT NULL, button_text TEXT, button_url TEXT,
  audience TEXT NOT NULL, recipients TEXT NOT NULL, count INTEGER NOT NULL,
  status TEXT NOT NULL, error TEXT, created_at INTEGER NOT NULL
);

-- ---------- Passkeys (also created automatically on first use) ----------
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  name TEXT NOT NULL DEFAULT '', device_type TEXT, backed_up INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
CREATE TABLE IF NOT EXISTS webauthn_challenges (
  id TEXT PRIMARY KEY, challenge TEXT NOT NULL, user_id TEXT, type TEXT NOT NULL, expires_at INTEGER NOT NULL
);

-- ---------- Payment requests (also created automatically on first use) ----------
CREATE TABLE IF NOT EXISTS pay_requests (
  id TEXT PRIMARY KEY, amount_cents INTEGER NOT NULL, currency TEXT NOT NULL, description TEXT NOT NULL,
  user_id TEXT, email TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER,
  paid_at INTEGER, paypal_order_id TEXT, paypal_capture_id TEXT, paypal_payer_email TEXT,
  otp_hash TEXT, otp_expires INTEGER, otp_attempts INTEGER NOT NULL DEFAULT 0, emailed_at INTEGER
);
CREATE TABLE IF NOT EXISTS pay_tokens (id TEXT PRIMARY KEY, request_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
INSERT OR IGNORE INTO sites (id, name, description, url, redirect_uris, access_mode, default_plan, created_at) VALUES
  ('pay', 'תשלומים', 'תשלום מאובטח ל-reem.bi', 'https://pay.reembir.com/', '["https://pay.reembir.com/r/"]', 'open', NULL, unixepoch());
