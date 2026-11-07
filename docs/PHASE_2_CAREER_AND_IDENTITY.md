# Phase 2 — Persistent Career, Player Identity and Authoritative Online Results

This document describes the implemented Phase 2 account/career system: what
already existed, what was added, how a finished online match becomes career XP,
and what remains out of scope.

## 1. Audit summary

### Retained from the earlier account work

- Google and Discord OAuth, account linking and unlinking.
- Opaque server sessions with rotation, expiry and "sign out everywhere".
- Guest profiles, guest-to-account migration ledger and conflict rules.
- Worker account API (`src/accounts/router.ts`), D1 store (`src/accounts/d1Store.ts`)
  and an in-memory store used by the whole test suite.
- Local guest career ledger (`src/accounts/localCareer.ts`).
- Multiplayer rooms, seat tokens, signed identity tickets and the authoritative
  room simulation (Durable Object + room match).
- Visual identity, HUD and existing career/account screens.

### Gaps Phase 2 closes

- Online matches now pay career XP, decided by the account service from the
  room's own report rather than by either browser.
- Result processing is idempotent, auditable and retry-safe.
- Player identity (callsign, avatar) is created, validated and unique per account;
  it is presented in the 1v1 lobby with the career rank the seat was verified at.
- The service record aggregates mode and nation statistics from the ledger.
- Match history is paged, has a detail view, and carries opponent/map/reward data.
- A limited public profile is readable by signed-in players from the lobby.
- The post-match card reads the authoritative award (pending, awarded or
  unavailable) instead of submitting a client-side result.

## 2. Result lifecycle

```
room simulation finishes
  -> room derives NeutralMatchResult (winner, reason, tick)
  -> room builds the career payload from its own game state and seat snapshots
  -> POST /api/account/internal/mp-result  (X-MCA-Result-Token)
       -> validate body (ids, timestamps, two opposite seats, bounded stats)
       -> for each seated account: eligibility -> mpReward -> career record
       -> write ledger row + match report + audit row in one store call
  -> browser result card polls GET /api/account/career/results/:matchId
       -> pending until the room's report lands
       -> recorded: award, xpBefore/xpAfter, rankBefore/rankAfter, promotion
```

The match reference is `mp:<roomId>:<startedAtMs>`. It is derived from the room
and its start time, embedded in the result message the room broadcasts, and is
the uniqueness key for the ledger and audit rows. A retry, reconnect, room
restart or duplicate callback therefore returns the existing award; it can never
pay twice.

The browser cannot submit a multiplayer result: `POST /matches` refuses
`mode: "multiplayer"`, and `provenance` cannot be claimed by a client. The intake
endpoint requires the shared service secret and is never exposed to players.

## 3. Reward formula

`src/accounts/matchCareer.ts` is the single definition, shared by the room (only
for shaping), the account service (for the decision) and the tests.

```
xp = round( (120 participation
          +  40 completion
          +  min(60, whole minutes played)
          +  min(30, 5 × strategic sites captured)
          +  min(25, units destroyed / 8)) × outcome )

outcome factor: victory 1.0, draw 0.6, defeat 0.4
hard ceiling: 300 XP per match
```

Eligibility:

- both seats on opposite teams with bounded, plausible statistics and timestamps;
- at least 3 minutes of play;
- some activity (units destroyed, structures built, sites captured or objectives);
- at most 12 rewarded online matches per UTC day per account.

Short, inactive, capped or guest-seat matches are still recorded in history with
`rewardStatus` and a human-readable reason, and pay 0. A defeat always pays
something so abandoning a losing match is never profitable.

Reports store `xp_before` and `xp_after` as they were at the time of processing,
so a later formula change cannot rewrite history and the result card and service
record agree.

## 4. Rank ladder

The existing 16-step ladder is kept as the initial career ladder. It is a single
universal ladder, independent of nation; the insignia are generic compositions of
chevrons, rockers, bars, stars and a wreath and do **not** claim to be an authentic
badge set from any one army. Final insignia artwork still needs an approved
military reference system.

| # | Rank | Abbr. | Grade | XP |
|---|------|-------|-------|----|
| 1 | Private | PVT | OR-1 | 0 |
| 2 | Corporal | CPL | OR-4 | 400 |
| 3 | Sergeant | SGT | OR-5 | 1,100 |
| 4 | Staff Sergeant | SSG | OR-6 | 2,300 |
| 5 | Sergeant First Class | SFC | OR-7 | 3,900 |
| 6 | Master Sergeant | MSG | OR-8 | 6,000 |
| 7 | Sergeant Major | SGM | OR-9 | 8,600 |
| 8 | Second Lieutenant | 2LT | OF-1 | 11,800 |
| 9 | First Lieutenant | 1LT | OF-1 | 15,600 |
| 10 | Captain | CPT | OF-2 | 20,000 |
| 11 | Major | MAJ | OF-3 | 25,000 |
| 12 | Lieutenant Colonel | LTC | OF-4 | 30,500 |
| 13 | Colonel | COL | OF-5 | 36,500 |
| 14 | Brigadier | BRIG | OF-6 | 43,000 |
| 15 | Major General | MG | OF-7 | 50,000 |
| 16 | General | GEN | OF-9 | 58,000 |

Early steps are short and later ones lengthen gradually; the last rank is
reachable through long-term play rather than an unreachable grind wall. A future
50-level structure can insert sub-levels between these milestone ranks without
changing any stored XP.

## 5. Identity and lobby

- Callsign: 3–20 characters, letters/digits/spaces/hyphens/underscores, trimmed
  and space-folded for uniqueness; reserved names and a short blocklist; at most
  3 changes per UTC day. The account id remains the stable key.
- Avatar: one of six fixed emblems. No uploads in this phase.
- The lobby shows callsign, avatar, rank insignia and rank title for each seat
  when the seat was verified by a signed ticket. A guest is labelled as a guest,
  never as an opponent with an invented identity.
- The signed ticket (v2) now carries the rank id alongside callsign and avatar.
  The room stores that seat snapshot at claim time; a rename during a match does
  not rewrite the match's recorded identity.
- `SERVICE RECORD` on a verified opponent opens `GET /players/:callsign`, which
  requires a session and publishes only callsign, avatar, rank, XP, matches,
  win rate, playtime, multiplayer totals and nation lines.

## 6. Statistics and history

- Ledger row: XP, mode, outcome, difficulty, duration, nation, kills, losses,
  reference, provenance, recorded time.
- Match report: map, opponent callsign/nation, structures destroyed/lost/built,
  sites captured, superweapons, objectives, reward version/status/breakdown and
  XP before/after.
- Aggregates are grouped from these rows by `buildCareerStats` into overall,
  per-mode (campaign/skirmish/multiplayer) and per-nation blocks. A mode or
  nation with no matches is absent rather than shown as a played zero.
- History is paged (`limit`/`offset`, capped at 50) and has a per-match detail
  view. Public profiles cannot read private account data, provider identifiers,
  sessions or the account id.
- Statistics that the simulation cannot measure (superweapons, objectives in
  online play) are reported as zero and excluded from rewards rather than
  estimated.

## 7. Guest migration

Guest XP remains local and is never accepted as a value. Import sends only the
match facts; the server recomputes XP. Migration is keyed by guest id, records a
profile digest and migration key, refuses a second account importing the same
guest, refuses importing twice into one account, and never overwrites a more
advanced authenticated career — on conflict the existing account career is
returned unchanged.

## 8. API surface

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/api/account/career` | session | Totals, rank, stats, identity, recent matches |
| GET | `/api/account/career/matches?limit&offset` | session | Paged history |
| GET | `/api/account/career/matches/:ref` | session | One match and its report |
| GET | `/api/account/career/results/:ref` | session | Post-match award or `pending` |
| POST | `/api/account/matches` | session | Local PvE result (multiplayer refused) |
| POST | `/api/account/identity` | session | Callsign/avatar update |
| GET | `/api/account/players/:callsign` | session | Limited public profile |
| POST | `/api/account/multiplayer/ticket` | session | Signed seat identity (with rank) |
| POST | `/api/account/internal/mp-result` | service secret | Authoritative match intake |

## 9. Security measures

- Server-authoritative result, XP and eligibility; the client submits neither.
- Idempotency on the match reference at the ledger and audit level.
- Shared-secret intake, constant-time comparison, no CORS exposure.
- Ownership checks on every career, history, detail and result read.
- Callsign uniqueness, validation, rate limiting and reserved-name protection.
- Guest migration conflict rules and no value trust.
- Public profiles deliberately separate from private account data.
- Bounded, validated result bodies; no unbounded history requests.

## 10. Verification

Run for this phase:

- `npx tsc --noEmit` — clean.
- `npx vitest run` — 172 files, 2523 tests passed.
- `npm run build` — production build succeeds (existing >500 kB chunk warning).

Added `tests/phase2-mp-career.test.ts`: two-seat award, defeat still pays less
than victory, duplicate intake cannot pay twice, short match recorded without XP,
forged intake token rejected, client-authored multiplayer result rejected, and the
signed ticket carries the rank computed from the ledger. Extended
`tests/phase2b2-lobby-client.test.ts` for seat identity/rank surfacing and the
result reference.

## 11. Known limitations / next phase

- No competitive rating or rating-based matchmaking (career XP is not a skill
  rating).
- No replays, spectator mode, friends, clans, parties or messaging.
- Ranking is a single universal 16-rank ladder; final insignia artwork needs an
  approved reference system, and a 50-level extension is future work.
- Online statistics for superweapons and objectives are not yet measured by the
  simulation, so they are recorded as zero and excluded from rewards.
