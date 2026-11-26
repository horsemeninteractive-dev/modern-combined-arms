-- MCA accounts — survival earns career XP.
--
-- A finished Outbreak run is a career match: the ledger keeps the waves held and
-- the infected killed as one row, so rank, level and the service record advance
-- from the same sums as every other operation. Two vocabularies are widened:
--
--   mode        'outbreak' joins the three operation modes
--   difficulty  the survival scale ('easy' … 'nightmare') is kept as-is, because
--               a Nightmare run that read as Veteran would be a false record
--
-- SQLite cannot alter a CHECK constraint, so the ledger is rebuilt: the new
-- shape is created, the rows are copied, and the old table is dropped and
-- renamed back. D1 applies the migration atomically, and `0011` rebuilt the
-- Outbreak boards the same way.
--
-- `career_match_details` is deliberately untouched. A survival run has no
-- opponent, no objectives and no structures destroyed, so it writes no report
-- row; the statistics query reads `career_matches` with a LEFT JOIN and still
-- counts the run toward matches, XP, kills and time.

CREATE TABLE IF NOT EXISTS career_matches_outbreak (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  match_ref TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('campaign', 'skirmish', 'multiplayer', 'outbreak')),
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'draw')),
  difficulty TEXT NOT NULL CHECK (
    difficulty IN ('recruit', 'veteran', 'elite', 'easy', 'normal', 'hard', 'nightmare')
  ),
  nation TEXT,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  kills INTEGER NOT NULL DEFAULT 0 CHECK (kills >= 0),
  units_lost INTEGER NOT NULL DEFAULT 0 CHECK (units_lost >= 0),
  xp INTEGER NOT NULL CHECK (xp >= 0),
  provenance TEXT NOT NULL CHECK (provenance IN ('local', 'guest', 'authoritative')),
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, match_ref)
);

INSERT INTO career_matches_outbreak (
  account_id, match_ref, mode, outcome, difficulty, nation,
  duration_seconds, kills, units_lost, xp, provenance, recorded_at
)
SELECT
  account_id, match_ref, mode, outcome, difficulty, nation,
  duration_seconds, kills, units_lost, xp, provenance, recorded_at
FROM career_matches;

DROP TABLE career_matches;

ALTER TABLE career_matches_outbreak RENAME TO career_matches;

-- The service record reads newest-first; the aggregate reads the whole set.
CREATE INDEX IF NOT EXISTS career_matches_by_account_time
  ON career_matches (account_id, recorded_at DESC);
