CREATE TABLE IF NOT EXISTS installations (id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS mailboxes (id TEXT PRIMARY KEY, installation_id TEXT NOT NULL REFERENCES installations(id) ON DELETE CASCADE, identity_id TEXT NOT NULL, address TEXT UNIQUE NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL, UNIQUE(installation_id, identity_id));
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, mailbox_id TEXT NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, provider_id TEXT NOT NULL, sender TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL, received_at INTEGER NOT NULL, UNIQUE(mailbox_id,provider_id));
CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS mailbox_expiry ON mailboxes(expires_at);
CREATE INDEX IF NOT EXISTS mailbox_owner ON mailboxes(installation_id,created_at);
CREATE INDEX IF NOT EXISTS mailbox_messages ON messages(mailbox_id,received_at);
