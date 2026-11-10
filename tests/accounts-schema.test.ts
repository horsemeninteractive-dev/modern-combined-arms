import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The D1 schema is not executed by the Node test suite (there is no Miniflare in
 * the unit run), so the guarantees that must live in the database rather than in
 * application code are asserted against the migration text itself.
 */
const migrationsDir = 'migrations';
const sql = readdirSync(migrationsDir)
  .filter((name) => name.endsWith('.sql'))
  .sort()
  .map((name) => readFileSync(`${migrationsDir}/${name}`, 'utf8'))
  .join('\n');

describe('account migrations', () => {
  it('are numbered, append-only files', () => {
    const files = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) expect(file).toMatch(/^\d{4}_[a-z0-9_]+\.sql$/);
  });

  it('defines every Stage 1 table with idempotent statements', () => {
    for (const table of [
      'accounts',
      'account_identities',
      'account_sessions',
      'guest_migration_records',
      'auth_rate_limits',
      'career_achievements',
    ]) {
      expect(sql).toMatch(new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
    }
  });

  it('enforces provider identity uniqueness in the database', () => {
    expect(sql).toMatch(/PRIMARY KEY \(provider, provider_subject\)/);
    expect(sql).toMatch(/provider TEXT NOT NULL CHECK \(provider IN \('google', 'discord'\)\)/);
  });

  it('stores only hashed session tokens, uniquely', () => {
    expect(sql).toMatch(/token_hash TEXT NOT NULL UNIQUE/);
    expect(sql).not.toMatch(/\btoken TEXT NOT NULL/);
    expect(sql).toMatch(/revoked_at INTEGER/);
  });

  it('protects references and the guest ledger with foreign keys and uniqueness', () => {
    expect(sql).toMatch(/REFERENCES accounts \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/guest_id TEXT PRIMARY KEY/);
    expect(sql).toMatch(/UNIQUE \(account_id\)/);
    expect(sql).toMatch(/state TEXT NOT NULL CHECK \(state IN \('pending', 'complete', 'conflict'\)\)/);
  });

  it('stores the identity document on the revision row for atomic saves', () => {
    expect(sql).toMatch(/ALTER TABLE player_presentation ADD COLUMN document TEXT/);
  });

  it('makes every achievement award unique per account', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS career_achievements/);
    expect(sql).toMatch(/PRIMARY KEY \(account_id, achievement_id\)/);
    expect(sql).toMatch(/account_id TEXT NOT NULL REFERENCES accounts \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS career_achievements_by_match/);
  });

  it('constrains account status and rate-limit windows', () => {
    expect(sql).toMatch(/status TEXT NOT NULL DEFAULT 'active'/);
    expect(sql).toMatch(/CHECK \(status IN \('active', 'suspended', 'deleted'\)\)/);
    expect(sql).toMatch(/PRIMARY KEY \(bucket, window_start\)/);
  });
});

describe('Phase 4D campaign records', () => {
  it('records one campaign completion per account, keyed and indexed', () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS career_campaigns\b/);
    expect(sql).toMatch(/PRIMARY KEY \(account_id, campaign_id\)/);
    expect(sql).toMatch(/REFERENCES accounts \(id\) ON DELETE CASCADE/);
    expect(sql).toMatch(/career_campaigns_by_account_time/);
  });
});
