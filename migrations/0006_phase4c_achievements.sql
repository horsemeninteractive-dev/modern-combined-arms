-- Phase 4C: earned commendations.
--
-- One row per account and achievement. The primary key is the duplicate
-- prevention: an achievement can never be awarded twice, even if two result
-- deliveries race or a room retries a match. `match_ref` is nullable because a
-- migrated guest ledger may satisfy a cumulative award without a new match.
CREATE TABLE IF NOT EXISTS career_achievements (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  awarded_at INTEGER NOT NULL,
  match_ref TEXT,
  PRIMARY KEY (account_id, achievement_id)
);

CREATE INDEX IF NOT EXISTS career_achievements_by_account_time
  ON career_achievements (account_id, awarded_at DESC);

CREATE INDEX IF NOT EXISTS career_achievements_by_match
  ON career_achievements (account_id, match_ref);
