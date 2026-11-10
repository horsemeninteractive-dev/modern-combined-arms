# Phase 4E — Identity, Career and Multiplayer Integration Audit

Date: 2026-11-09  
Build audited: MCA 0.6.1 BETA (`package.json`), working tree including the
unreleased Phase 4C–4E work.  
Nature of the phase: audit, hardening, regression tests and documentation. No
feature was added, and no existing account, cosmetic, achievement or multiplayer
behaviour was redesigned.

Nothing in this report is inferred from an earlier completion note: every
"verified" line below was read in the current source or exercised by a test in
this tree. Anything that needs a deployed environment is listed as external.

---

## 1. Implementation inventory

| Area | Status | Evidence |
| --- | --- | --- |
| OAuth sign-in (Google, Discord), PKCE, state/nonce | Implemented, source-verified | `src/accounts/oauth.ts`, `router.ts` callback; `tests/accounts-oauth.test.ts`, `accounts-session.test.ts` |
| Sessions: HttpOnly cookie, hashed token, rotation, revoke-all | Implemented, source-verified | `src/accounts/session.ts`; `tests/accounts-session.test.ts` |
| Guest identity and local career | Implemented, tested | `src/accounts/guest.ts`, `localCareer.ts`, `localAchievements.ts`; `tests/accounts-guest.test.ts`, `local-career.test.ts` |
| Guest → account migration | Implemented; **race gap fixed in this phase** | `router.ts` `migrateGuest`; `tests/phase4e-audit.test.ts` |
| Callsign, avatar, uniqueness, rename budget | Implemented, tested | `src/accounts/identity.ts`; `tests/accounts-identity.test.ts` |
| Command flag designs, active flag, equipped cosmetics | Implemented, tested | `src/identity/flag*.ts`, `router.ts` `/flags`; `tests/account-flags.test.ts`, `accounts-flags-api.test.ts` |
| Cosmetic catalogue and ownership | Implemented, tested | `src/identity/cosmetics.ts`; `tests/phase4c-career.test.ts`, `phase4e-cosmetics-inventory.test.ts` |
| Cosmetics inventory UI (frames, backgrounds, camo, emblems) | Implemented, tested | `src/ui/cosmeticsInventory.ts`, `accountPanel.ts`; `tests/phase4e-cosmetics-inventory.test.ts` |
| Server equips validation | Implemented, tested | `validateEquip` in `cosmetics.ts`, applied by `parseFlagSubmission` |
| Signed multiplayer identity ticket | Implemented, tested | `src/accounts/tickets.ts`, `src/multiplayer/roomIdentity.ts`; `tests/phase2b*-lobby-*.test.ts` |
| Match-start identity snapshot and reconnect restore | Implemented, tested | `src/multiplayer/roomMatch.ts`, `roomSnapshot.ts`; `tests/phase4b-identity-integration.test.ts` |
| Authoritative multiplayer result intake | Implemented, tested | `src/accounts/matchCareer.ts`, `router.ts` `/internal/mp-result`; `tests/phase2-mp-career.test.ts` |
| Career ledger, XP, levels, ranks | Implemented, tested | `src/accounts/career.ts`, `levels.ts`, `ranks.ts`; `tests/phase4c-career.test.ts` |
| Achievements (42 definitions) and awards | Implemented, tested | `src/accounts/achievements.ts`; `tests/phase4c-career.test.ts` |
| Campaign completion and Commander Legacy | Implemented, tested | `src/accounts/campaignLegacy.ts`; `tests/phase4d-legacy.test.ts` |
| D1 migrations 0001–0008 | Implemented; **applied locally only** | `migrations/`; see §6 |
| Live two-account multiplayer identity | **Unverified** — needs two signed-in accounts and the deployed room Worker | see §7 |
| Remote D1 migration state and production secrets | **External** | see §6–§7 |

---

## 2. Defects found and fixed

| Id | Severity | Defect | Fix |
| --- | --- | --- | --- |
| 4E-01 | High (integrity) | Guest migration imported career rows **before** writing the migration record. Two accounts presenting the same guest profile could both copy that career into their own ledger; the only guard was the final insert, after the damage. An interrupted import also left no record at all. | Reserve the guest as `pending` before any import; only the reserved account can import; the reservation is flipped to `complete` at the end and a retry resumes it. New store method `completeGuestMigration` on `AccountStore`, `MemoryAccountStore` and `D1AccountStore`. Regression: `tests/phase4e-audit.test.ts`. |
| 4E-02 | Medium (configuration) | Both room Worker configs defaulted a match to **60 seconds**, while `MP_MIN_DURATION_SECONDS` is **180**: any room created without an explicit duration could never award career XP, by construction. | Default raised to **600 s** (the client's own ten-minute default) in `mp-room-wrangler.jsonc`, `mp-room-wrangler.live.jsonc` and the hardcoded fallback in `roomDurableObject.durationBounds`. Regression test pins both configs to the reward floor. |
| 4E-03 | Low (documentation) | Two evidence READMEs linked `../MULTIPLAYER_PHASE_2A_1x_SOAK_REPORT.md`, which does not exist at the repository root. | Links corrected to `../docs/…`; the repository-wide link scan now reports zero broken relative links. |
| 4E-04 | Low (documentation) | README advertised a 163-file suite; the tree has 189 test files. | Count corrected. |

No defect was found in the revision guard, the cosmetic entitlement check, the
ticket signature/expiry path, the origin/host checks or the authoritative result
validation, so none of those was changed.

---

## 3. Verified without modification

### Account and guest lifecycle

- A guest profile is created on demand, invalid records are replaced, and the
  digest excludes `migratedAccountId` so marking a profile migrated cannot look
  like a changed profile on retry (`guest.ts`).
- Session resolution treats unknown, revoked, expired and suspended identically;
  a sign-in callback revokes a different account's stale cookie (`session.ts`,
  `router.ts`).
- Guest migration is idempotent per match reference and refuses another
  account's reserved or completed guest; the account-level unique row prevents a
  second guest import (`migrations/0001`, `router.ts`).
- Repeated migration returns `already-migrated` with no extra XP.

### Synchronisation

- Change detection includes `frame`, `background`, `camo`, the active design and
  every design (`documentsDiffer` in `sync.ts`).
- A save is one conditional SQL statement guarded by `revision`; a stale client
  receives `409 stale-write` **and** the newest document, and the client rebases
  additions before retrying once (`d1Store.savePlayerIdentityDocument`,
  `sync.pushFlags`).
- A failed push leaves the local document dirty with its revision, so it is
  retried rather than marked synchronised (`pushFlags` returns `offline`).
- A browser last used by another account adopts the signed-in account's document
  instead of importing the previous player's designs (`syncFlags`).

### Cosmetics and entitlement

- `validateEquip` rejects unknown ids, wrong-category ids and locked items for
  frames, backgrounds and camos; emblem ownership is checked inside every
  submitted design by `parseFlagSubmission`, so a modified payload cannot smuggle
  a locked emblem.
- Ownership progress comes from the account's own ledger and awards; the request
  never supplies XP, matches, wins or achievements.
- Unit camo is presentation only: it is a renderer uniform set from the local
  identity document, applied before the team-colour mix, and never enters the
  simulation, the wire protocol or another player's view. This is deliberate —
  only a player sees their own units — so camo is intentionally **not** part of
  the signed multiplayer identity, unlike the frame and background that a lobby
  displays.

### Multiplayer identity

- The room strips `X-MCA-Identity-Ticket`, `X-MCA-Verified-Account` and the
  trusted identity header from every request before verifying, so a browser
  cannot spoof a verified identity.
- Tickets are HMAC-signed over audience, version, account id, issue time and the
  encoded identity; identity is re-validated before sealing, and verification
  rejects malformed, future-dated, expired and unverifiable tickets. TTL is two
  minutes.
- The match freezes seat identities at start; later account edits cannot change a
  running match or a restored snapshot, and unknown cosmetics are dropped on
  validation (`phase4b-identity-integration.test.ts`).
- Result intake requires the shared secret, recomputes every award from the
  reported facts, and refuses client-claimed provenance; a replay returns the
  existing award rather than a second one.

### Career, achievements and campaign awards

- XP totals are aggregated from the ledger; there is no balance column to drift.
- Achievement awards are insert-only on `(account_id, achievement_id)`; a
  retried result replays no notification.
- Campaign completion is derived from winning ledger rows for every authored
  operation plus the final mission, never from a client flag.
- A retried local result still re-runs campaign completion and achievement
  evaluation, so a process failure after the ledger write is repaired by the
  client's retry.

---

## 4. Checks executed in this phase

| Check | Command | Result |
| --- | --- | --- |
| TypeScript | `npx --no-install tsc --noEmit` | pass, exit 0 (final run after the last edit) |
| Focused audit suites | `npx --no-install vitest run tests/phase4e-audit.test.ts tests/accounts-guest.test.ts tests/phase4c-career.test.ts tests/account-flags.test.ts tests/phase4d-legacy.test.ts` | 5 files, 79 tests, pass |
| Production build | `npm run build` | pass, exit 0 (`sw.js` precaches 13 files) |
| Full suite | `npx vitest run` | **190 files / 2,734 tests passed**, exit 0, 521.59 s |
| Relative documentation links | repository-wide link scan | 0 broken across 118 Markdown files |
| Local migration state | `npx wrangler d1 migrations list mca-accounts --local …` | "No migrations to apply" — 0001–0008 present |

Tests added: `tests/phase4e-audit.test.ts` (3 tests) covering the room duration
floor, a foreign account's refusal to import a reserved guest, and resumption of
an interrupted import without a duplicate match.

---

## 5. Release state

The full `vitest` run after the final edits: **190 test files, 2,734 tests,
all passing**, exit 0, 521.59 s. `npx tsc --noEmit` exit 0, `npm run build`
exit 0, and the documentation link scan found 0 broken links in 118 files.

What did **not** run on this machine is named in §7 rather than presented as a
pass: remote migrations, Worker secrets, a deploy and a live two-account match.

---

## 6. Migration and deployment readiness

Local: `mca-accounts` has migrations 0001–0008 applied
(`account-wrangler.jsonc`, `.dev/accounts`). The schema is append-only; 0005 and
0008 only add nullable columns, 0006 and 0007 only add tables, so an older row
keeps working and a re-run is safe.

| Environment | Source ready | Migrations | Secrets / bindings |
| --- | --- | --- | --- |
| Local | Yes | 0001–0008 applied | `.dev.vars`; dev-mode host exemption |
| Staging account Worker (`mca-accounts-staging`) | Yes | **Unknown** — run `npm run accounts:migrate` with the live config only when approved | `GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET`, `MCA_IDENTITY_TICKET_SECRET`, `MCA_MP_RESULT_TOKEN` |
| Production account Worker (`mca-accounts`) | Yes | **Unknown** — the remote D1 state was not queried in this phase | Same four secrets, plus the Pages `MCA_ACCOUNT` service binding |
| Staging room Worker (`mca-multiplayer-staging`) | Yes | n/a (Durable Objects) | `MP_ADMIN_TOKEN`, `MCA_RESERVATION_TOKEN`, `MP_CAREER_TOKEN`, `MCA_IDENTITY_TICKET_SECRET` (shared with the account Worker) |
| "Live" room Worker | Yes | n/a | Same as staging; `mp-room-wrangler.live.jsonc` deploys to the **same** worker name as staging, so a live deploy replaces staging |

External actions that require the owner's approval and cannot be done from this
tree:

1. Confirm which remote D1 database each config points at, then apply pending
   migrations with `npm run accounts:migrate` (remote, live config).
2. Set or rotate the worker secrets named above with `wrangler secret put` —
   seven values across the two Workers, because `MCA_IDENTITY_TICKET_SECRET`
   must be identical on both. The ordered procedure, including how to verify
   remote migration state before applying anything, is
   [DEPLOYMENT_RUNBOOK.md](DEPLOYMENT_RUNBOOK.md).
3. Deploy the account Worker and the room Worker, then the Pages bundle.
4. Play a real two-account match to verify ticket issue, lobby identity, a
   reconnect and result delivery on the deployed origins.

The authoritative `MP_MAX_MATCH_SECONDS` is 1800 and the default is now 600; the
client's own default is also 600 (`DEFAULT_MATCH_DURATION_MS`), so the two agree
without relying on the server fallback.

---

## 7. Outstanding risks and unverified items

1. **Live two-account multiplayer identity was not exercised.** The in-tree room
   and account tests cover ticketing, snapshots, reconnect and result intake, but
   no two real accounts were signed in against a deployed Worker in this phase.
2. **Remote migration state is unknown.** Local D1 is fully migrated; staging and
   production were not queried, and nothing was applied remotely.
3. **A ticket can be replayed within its two-minute life.** Signatures and expiry
   are enforced and the room consumes a seat token, but there is no per-ticket
   nonce. Accepted for this phase; a replay still cannot take a seat already held
   by its owner.
4. **Achievement/campaign writes are not one transaction with the ledger.** They
   are idempotent and repaired by retry, but a crash between the ledger and the
   award write is only reconciled when the client retries the result. Verified by
   reading the code path, not by fault injection.
5. **Camo is local-only presentation.** That is the intended design, not a gap,
   but it means an opponent never sees another player's camo.
6. **The two Worker configurations share the `mca-multiplayer-staging` name.**
   A live room deploy overwrites staging; this is pre-existing and documented in
   the config comments, not changed here.

---

## 8. Phase 4 status

Phase 4A–4D behaviour is preserved and re-verified by the existing suites. Phase
4E closes the integration and security gaps above in source:

- identity synchronisation is revision-safe and includes camo;
- guest migration is reserved, resumable and idempotent;
- cosmetic ownership is enforced server-side for every category;
- multiplayer identity is signed, frozen at match start and restored on reconnect;
- career, achievement and campaign records are idempotent and derived from
  server-owned data;
- documentation and migration notes reflect the current implementation.

**Phase 4E is complete in source and test.** It is not complete in deployment:
items 1–4 in §6 remain external and are the only gates left before the phase can
be called released.
