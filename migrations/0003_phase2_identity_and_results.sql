-- MCA accounts — Phase 2: persistent player identity and authoritative results.
--
-- Append-only. `career_matches` (0002) remains the XP ledger and the only place
-- career XP is summed from; nothing here duplicates the balance. Two new tables
-- sit beside it:
--
--   account_profiles       the player's presentable identity (callsign, avatar)
--   career_match_details   the match report behind a ledger row: opponent, map,
--                          extended statistics, reward version and status
--   mp_result_players      the room service's own record of who played what, so
--                          a result is auditable independently of the ledger
--
-- Every statement is idempotent, and no existing column is altered, so a run
-- against a partially applied database is safe.

CREATE TABLE IF NOT EXISTS account_profiles (
  account_id TEXT PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  callsign TEXT NOT NULL,
  -- Case- and space-folded form. Uniqueness is on the key, so two players
  -- cannot present the same name in a lobby while the displayed spelling
  -- remains whatever the player chose.
  callsign_key TEXT NOT NULL UNIQUE,
  avatar TEXT NOT NULL DEFAULT 'insignia'
    CHECK (avatar IN ('insignia', 'shield', 'eagle', 'anchor', 'bolt', 'star')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  callsign_changed_at INTEGER
);

CREATE INDEX IF NOT EXISTS account_profiles_by_account
  ON account_profiles (account_id);

CREATE TABLE IF NOT EXISTS career_match_details (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  match_ref TEXT NOT NULL,
  -- The mode is held in the ledger; it is repeated here so a single query can
  -- page the service record without joining the ledger for presentation only.
  mode TEXT NOT NULL CHECK (mode IN ('campaign', 'skirmish', 'multiplayer')),
  map_id TEXT,
  opponent_account_id TEXT,
  opponent_callsign TEXT,
  opponent_nation TEXT,
  duration_seconds INTEGER NOT NULL DEFAULT 0,
  units_destroyed INTEGER NOT NULL DEFAULT 0,
  units_lost INTEGER NOT NULL DEFAULT 0,
  structures_destroyed INTEGER NOT NULL DEFAULT 0,
  structures_lost INTEGER NOT NULL DEFAULT 0,
  structures_built INTEGER NOT NULL DEFAULT 0,
  sites_captured INTEGER NOT NULL DEFAULT 0,
  superweapons_used INTEGER NOT NULL DEFAULT 0,
  objectives_completed INTEGER NOT NULL DEFAULT 0,
  -- The reward as it was decided, not as it would be recomputed today: a later
  -- formula change must not rewrite history.
  reward_version INTEGER NOT NULL DEFAULT 0,
  reward_status TEXT NOT NULL DEFAULT 'awarded'
    CHECK (reward_status IN ('awarded', 'capped', 'ineligible', 'local')),
  reward_breakdown TEXT,
  xp_before INTEGER NOT NULL DEFAULT 0,
  xp_after INTEGER NOT NULL DEFAULT 0,
  recorded_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, match_ref)
);

CREATE INDEX IF NOT EXISTS career_match_details_by_account_time
  ON career_match_details (account_id, recorded_at DESC);

-- The authoritative result as the room service reported it. One row per
-- (match, player), written with the ledger row in the same batch so a match
-- cannot be half-recorded for one side.
CREATE TABLE IF NOT EXISTS mp_result_players (
  match_id TEXT NOT NULL,
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  team INTEGER NOT NULL CHECK (team >= 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('victory', 'defeat', 'draw')),
  nation TEXT,
  reward_version INTEGER NOT NULL,
  xp_awarded INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('awarded', 'capped', 'ineligible')),
  processed_at INTEGER NOT NULL,
  PRIMARY KEY (match_id, account_id)
);

CREATE INDEX IF NOT EXISTS mp_result_players_by_account_time
  ON mp_result_players (account_id, processed_at DESC);
