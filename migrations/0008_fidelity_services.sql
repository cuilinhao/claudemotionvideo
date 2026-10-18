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
