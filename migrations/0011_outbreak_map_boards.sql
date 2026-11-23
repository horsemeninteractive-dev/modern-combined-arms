-- MCA accounts — Outbreak boards per battlefield.
--
-- The mode now ships four authored theatres, and a run on the city compound is
-- not comparable with a run in the open basin: the ground decides what a wave
-- costs. So the map joins the board key, and every board is one map, one mode
-- and one difficulty.
--
-- SQLite cannot alter a primary key, so the table is rebuilt: the new shape is
-- created, the old rows are copied with the basin as their map (they were all
-- fought there), and the placeholder table is dropped and renamed back. The
-- copy and the rename run in one migration, which D1 applies atomically.
--
-- `callsign` is kept with the run so a board still renders if the profile row is
-- missing; reads prefer the profile's current callsign, so a rename follows the
-- player.

CREATE TABLE IF NOT EXISTS outbreak_runs_by_map (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  mode TEXT NOT NULL CHECK (mode IN ('solo', 'coop')),
  map TEXT NOT NULL CHECK (
    map IN (
      'outbreak-relay-basin',
      'outbreak-civic-square',
      'outbreak-tidewall-quay',
      'outbreak-frostline-junction'
    )
  ),
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
  PRIMARY KEY (account_id, map, mode, difficulty)
);

INSERT INTO outbreak_runs_by_map (
  account_id, mode, map, difficulty, wave, waves_completed, zombies_killed,
  duration_seconds, structures_lost, units_lost, players, nations, callsign, recorded_at
)
SELECT
  account_id, mode, 'outbreak-relay-basin', difficulty, wave, waves_completed,
  zombies_killed, duration_seconds, structures_lost, units_lost, players, nations,
  callsign, recorded_at
FROM outbreak_runs;

DROP TABLE outbreak_runs;

ALTER TABLE outbreak_runs_by_map RENAME TO outbreak_runs;

-- The board read: one map, mode and difficulty, best wave first, then the
-- tiebreaks the ranking uses.
CREATE INDEX IF NOT EXISTS outbreak_runs_by_board
  ON outbreak_runs (map, mode, difficulty, wave DESC, waves_completed DESC, zombies_killed DESC, duration_seconds DESC);
