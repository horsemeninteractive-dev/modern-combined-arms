-- Phase 4D: full-campaign completion records.
--
-- A campaign is recorded once per account. Awards themselves remain derived
-- from career_achievements; this table is the durable campaign milestone the
-- achievement evaluator reads, not an inventory or a second XP ledger.
CREATE TABLE IF NOT EXISTS career_campaigns (
  account_id TEXT NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  campaign_id TEXT NOT NULL,
  completed_at INTEGER NOT NULL,
  PRIMARY KEY (account_id, campaign_id)
);

CREATE INDEX IF NOT EXISTS career_campaigns_by_account_time
  ON career_campaigns (account_id, completed_at DESC);
