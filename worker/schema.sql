PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, email_verified_at INTEGER,
  credits INTEGER NOT NULL DEFAULT 0 CHECK(credits >= 0), plan TEXT NOT NULL DEFAULT 'free',
  monthly_credits INTEGER NOT NULL DEFAULT 0, subscription_status TEXT NOT NULL DEFAULT 'none',
  stripe_customer_id TEXT UNIQUE, subscription_id TEXT, subscription_interval TEXT,
  trial_used INTEGER NOT NULL DEFAULT 0, period_start INTEGER, period_end INTEGER,
  next_refill_at INTEGER, refill_index INTEGER NOT NULL DEFAULT 0,
  paid_period_start INTEGER, paid_period_end INTEGER, billing_event_created INTEGER NOT NULL DEFAULT 0,
  checkout_session_id TEXT, checkout_expires_at INTEGER, checkout_plan TEXT, checkout_interval TEXT, checkout_lease INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS password_resets (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL, consumed_at INTEGER
);
CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS credit_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), amount INTEGER NOT NULL,
  reason TEXT NOT NULL, external_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS ledger_user ON credit_ledger(user_id,created_at);
-- All money-like changes pass through this append-only ledger. D1 executes a
-- batch as one SQLite transaction, so failed debits also undo job creation.
CREATE TRIGGER IF NOT EXISTS credit_balance_guard BEFORE INSERT ON credit_ledger
WHEN NEW.amount < 0
  AND NOT EXISTS (SELECT 1 FROM credit_ledger WHERE external_key=NEW.external_key)
  AND (SELECT credits FROM users WHERE id=NEW.user_id) + NEW.amount < 0
BEGIN SELECT RAISE(ABORT, 'INSUFFICIENT_CREDITS'); END;
CREATE TRIGGER IF NOT EXISTS credit_balance_apply AFTER INSERT ON credit_ledger
BEGIN UPDATE users SET credits=credits+NEW.amount WHERE id=NEW.user_id; END;
CREATE TRIGGER IF NOT EXISTS ledger_no_update BEFORE UPDATE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete BEFORE DELETE ON credit_ledger
BEGIN SELECT RAISE(ABORT, 'IMMUTABLE_LEDGER'); END;
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL,
  aspect TEXT NOT NULL, duration INTEGER NOT NULL, latest_version_id TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS projects_user ON projects(user_id,updated_at);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
  media_type TEXT NOT NULL, size INTEGER NOT NULL, r2_key TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS assets_user ON assets(user_id);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), html TEXT NOT NULL, storyboard TEXT NOT NULL,
  prompt TEXT NOT NULL, asset_ids TEXT NOT NULL, mp4_key TEXT, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS versions_project ON versions(project_id,created_at);
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  prompt TEXT NOT NULL, aspect TEXT NOT NULL, duration INTEGER NOT NULL, asset_ids TEXT NOT NULL,
  previous_version_id TEXT, selected_shot TEXT, cost INTEGER NOT NULL CHECK(cost > 0),
  status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
  progress TEXT NOT NULL DEFAULT 'Queued', error TEXT, version_id TEXT, ai_attempted INTEGER NOT NULL DEFAULT 0,
  idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS jobs_status ON jobs(status,updated_at);
CREATE TABLE IF NOT EXISTS stripe_events (id TEXT PRIMARY KEY, type TEXT NOT NULL, processed_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS audio_assets (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL, media_type TEXT NOT NULL, size INTEGER NOT NULL CHECK(size>0 AND size<=10485760),
  r2_key TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audio_assets_user ON audio_assets(user_id,project_id);
CREATE TRIGGER IF NOT EXISTS audio_storage_guard BEFORE INSERT ON audio_assets
WHEN (SELECT COUNT(*) FROM audio_assets WHERE user_id=NEW.user_id)>=50
  OR (SELECT COALESCE(SUM(size),0) FROM audio_assets WHERE user_id=NEW.user_id)+NEW.size>209715200
BEGIN SELECT RAISE(ABORT, 'AUDIO_STORAGE_FULL'); END;
CREATE TABLE IF NOT EXISTS project_audio (
  project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id), settings TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL
);
-- Keep paid request tombstones even after project/audio deletion.
CREATE TABLE IF NOT EXISTS speech_requests (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), project_id TEXT NOT NULL,
  request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),
  asset_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS speech_requests_status ON speech_requests(status,updated_at);
CREATE TRIGGER IF NOT EXISTS speech_project_guard BEFORE INSERT ON speech_requests
WHEN NOT EXISTS(SELECT 1 FROM projects WHERE id=NEW.project_id AND user_id=NEW.user_id)
BEGIN SELECT RAISE(ABORT, 'PROJECT_NOT_FOUND'); END;
CREATE TABLE IF NOT EXISTS magic_links (
  token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE,
  callback_path TEXT NOT NULL, expires_at INTEGER NOT NULL,
  consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS magic_links_expiry ON magic_links(expires_at);
CREATE TABLE IF NOT EXISTS support_messages (
  id TEXT PRIMARY KEY, user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL, body TEXT NOT NULL, page TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','sent','failed')),
  provider_message_id TEXT, created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX IF NOT EXISTS support_messages_created ON support_messages(created_at);
CREATE TABLE IF NOT EXISTS google_oauth_states (
  state_hash TEXT PRIMARY KEY, code_verifier TEXT NOT NULL, nonce TEXT NOT NULL, callback_path TEXT NOT NULL,
  expires_at INTEGER NOT NULL, consumed_at INTEGER, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS google_oauth_states_expiry ON google_oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS oauth_identities (
  provider TEXT NOT NULL, provider_subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, PRIMARY KEY(provider,provider_subject), UNIQUE(provider,user_id)
);
CREATE INDEX IF NOT EXISTS oauth_identities_user ON oauth_identities(user_id);
