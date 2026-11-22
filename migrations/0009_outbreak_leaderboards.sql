-- MCA accounts — Phase 4F: online Outbreak leaderboards.
--
-- One row per (account, board, difficulty): a player's best run. Keeping only
-- the best is what makes the table a leaderboard rather than a log, and it means
-- a read is one indexed range scan instead of a grouped aggregate over history.
--
-- Solo and duo are separate boards (`mode`), and difficulty is part of the key,
-- so a normal solo run can never sit beside a nightmare duo run. `callsign` is
-- stored with the run so a board still renders if the profile row is missing;
-- reads prefer the profile's current callsign, so a rename follows the player.
--
-- The values are the run's own record: wave reached, waves held, kills, the
-- clock and the losses. The account service bounds all of them (see
-- src/accounts/outbreakBoard.ts); nothing here duplicates career XP or the
-- ledger.

CREATE TABLE IF NOT EXISTS outbreak_runs (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('solo', 'coop')),
  difficulty TEXT NOT NULL CHECK (difficulty IN ('easy', 'normal', 'hard', 'nightmare')),
  wave INTEGER NOT NULL CHECK (wave >= 1),
  waves_completed INTEGER NOT NULL CHECK (waves_completed >= 0),
  zombies_killed INTEGER NOT NULL CHECK (zombies_killed >= 0),
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds >= 0),
  structures_lost INTEGER NOT NULL DEFAULT 0,
  units_lost INTEGER NOT NULL DEFAULT 0,
  players INTEGER NOT NULL CHECK (players IN (1, 2)),
  nations TEXT NOT NULL,
  callsign TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, mode, difficulty)
);

-- The board read: one mode and difficulty, best wave first, then the tiebreaks
-- the ranking uses.
CREATE INDEX IF NOT EXISTS outbreak_runs_by_board
  ON outbreak_runs (mode, difficulty, wave DESC, waves_completed DESC, zombies_killed DESC, duration_seconds DESC);
