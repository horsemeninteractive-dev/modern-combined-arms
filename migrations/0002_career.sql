-- MCA accounts — career progression (Stage 2).
--
-- One row per completed match. This table *is* the XP ledger: the totals shown
-- in the career view are aggregated from it, so a total can never drift from the
-- matches that justify it, and no separate balance column needs repairing.
--
-- Uniqueness on (account_id, match_ref) makes submission idempotent: a retried
-- request, a double-clicked acceptance or a reload cannot pay twice.
--
-- Provenance records where a result came from:
--   'local'         client-submitted PvE result (campaign, skirmish)
--   'guest'         imported from a guest ledger during account migration
--   'authoritative' reserved for a result the room service itself owns
-- Only the server decides provenance; it is never taken from the request body.

CREATE TABLE IF NOT EXISTS career_matches (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  match_ref TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('campaign', 'skirmish', 'multiplayer')),
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'draw')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('recruit', 'veteran', 'elite')),
  nation TEXT,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
  units_lost INTEGER NOT NULL DEFAULT 0 CHECK (units_lost >= 0),
  xp INTEGER NOT NULL CHECK (xp >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('local', 'guest', 'authoritative')),
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, match_ref)
);

-- The service record reads newest-first; the aggregate reads the whole set.
CREATE INDEX IF NOT EXISTS career_matches_by_account_time
  ON career_matches (account_id, recorded_at DESC);
