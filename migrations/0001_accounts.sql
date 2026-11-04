-- MCA accounts — initial schema (Stage 1).
--
-- Append-only: never edit an applied migration, add a new numbered file. Every
-- statement is idempotent so a re-run on a partially applied database is safe.
--
-- Session tokens and OAuth access tokens are never stored. Only the SHA-256 of a
-- session token is kept, and provider profile metadata is limited to what a
-- profile needs to render.

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'deleted')),
  last_auth_at INTEGER
);

CREATE TABLE IF NOT EXISTS account_identities (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google', 'discord')),
  provider_subject TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  linked_at INTEGER NOT NULL,
  -- The primary key is the uniqueness guarantee: one provider login belongs to
  -- exactly one MCA account, enforced by the database rather than by a check
  -- that a concurrent request could race.
  PRIMARY KEY (provider, provider_subject)
);

CREATE INDEX IF NOT EXISTS account_identities_by_account
  ON account_identities (account_id);

CREATE TABLE IF NOT EXISTS account_sessions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS account_sessions_by_account
  ON account_sessions (account_id);

CREATE INDEX IF NOT EXISTS account_sessions_by_expiry
  ON account_sessions (expires_at);

CREATE TABLE IF NOT EXISTS guest_migration_records (
  guest_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('pending', 'complete', 'conflict')),
  migration_key TEXT NOT NULL,
  -- Digest of the guest payload as submitted. Not the payload itself: at Stage 1
  -- there is no progression to import, and storing raw local profiles would
  -- collect personal data with no use.
  profile_digest TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  completed_at INTEGER,
  -- One guest profile per account until explicit conflict resolution exists.
  UNIQUE (account_id)
);

CREATE TABLE IF NOT EXISTS auth_rate_limits (
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, window_start)
);

CREATE INDEX IF NOT EXISTS auth_rate_limits_by_window
  ON auth_rate_limits (window_start);
