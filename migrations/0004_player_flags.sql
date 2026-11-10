-- MCA accounts — Phase 4: personal command flags and profile presentation.
--
-- Append-only. Nothing here duplicates the career ledger or the profile: a flag
-- design is presentation, and the active design plus equipped cosmetics are one
-- small row so a profile read costs one extra query at most.
--
-- Compositions are stored as validated JSON text. The account service parses and
-- validates them again on every write and on read, so a row that predates a
-- renderer change degrades to a dropped design rather than a broken screen.
--
-- `revision` is optimistic concurrency: a client submits the revision it last
-- read, and a stale submission is refused instead of overwriting a newer edit
-- made on another device.

CREATE TABLE IF NOT EXISTS player_flags (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  design_id TEXT NOT NULL,
  name TEXT NOT NULL,
  composition TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, design_id)
);

CREATE INDEX IF NOT EXISTS player_flags_by_account_time
  ON player_flags (account_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS player_presentation (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  active_design_id TEXT,
  frame TEXT,
  background TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
