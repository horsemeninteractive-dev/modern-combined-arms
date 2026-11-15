# Phase 0 — Reconciliation and quality baseline

**Build:** `0.5.4 BETA` (`package.json`, `src/version.ts` compiled identity)
**Date:** 5 November 2026
**Scope:** bring the documentation and the verification story into line with the
code that ships, and record what a clean run actually looks like.

This document is the reference for "is this tree releasable?". It states the
version metadata, the documents that are authoritative, the real Cloudflare
deployment shape, the measured verification baseline, and the deviations that are
known and accepted. Numbers in it are measured on this host (8 cores, 15 GB,
Windows + Git Bash); a slower host changes durations, not outcomes.

---

## 1. Version metadata

| Place | Value | Rule |
| --- | --- | --- |
| `package.json` → `version`, `releaseStage` | `0.5.4`, `BETA` | Source of truth. |
| `package-lock.json` → root `version` | `0.5.4` | Must match `package.json`. |
| `CHANGELOG.md` → first `## [x.y.z STAGE]` heading | `## [0.5.4 BETA]` | `tools/release.mjs` reads this heading. |
| `index.html` → `#menu-build` | `v0.5.4 BETA · BUILD` | `tools/release.mjs` reads this line. |
| Build number | repository commit count | Compiled in by `vite.config.ts`; `BUILD_NUMBER` overrides. |

`tools/release.mjs` refuses to ship when those three disagree, so the version is
checked by the release path rather than by hand. The lockfile was re-synced with
`npm install --package-lock-only` and a clean install was verified (see §5).

---

## 2. Documents that are authoritative

| Document | Owns | Status after this pass |
| --- | --- | --- |
| [Modern_Combined_Arms_RTS_GDD_v0.1.md](../Modern_Combined_Arms_RTS_GDD_v0.1.md) | Design intent, and an explicit implementation-status section per area. | Header now names `0.5.4`; §0.5 records what is built, partial or design-only. |
| [README.md](../README.md) | How to run, build, test and ship it; limitations. | Test counts and the economy description corrected; a duplicated network-play paragraph removed. |
| [CHANGELOG.md](../CHANGELOG.md) | Release notes per version. | Adds an `Unreleased` section for the economy gate below. |
| [docs/PLAN.md](PLAN.md) | Implementation history and architecture notes. | Unchanged (historical record). |
| [docs/ACCOUNTS_STAGE_0_ARCHITECTURE.md](ACCOUNTS_STAGE_0_ARCHITECTURE.md) | Account service design and stages. | Unchanged; stage status still matches the code. |
| This document | Verification baseline and deployment architecture. | New. |

Relative links in `README.md`, the GDD and every `docs/*.md` were checked
mechanically for a resolvable target. The cross-references that were written from
the repository root while sitting in `docs/` (for example `src/sim/game.ts` inside
docs/MCA_MAP_ROSTER_REPORT.md, and the `docs/phase2b1-lifecycle.svg` image) now use
real relative paths, and the two `SECURITY-REVIEW.md` references point at the copy
that exists (`docs/SECURITY-REVIEW.md`). Nothing in those documents links to a
missing file.

### 2.1 The economy rule this pass reconciled

The 0.5.2 notes described the headquarters trickle as "never subsidised at an
ordinary opening". The code did not hold that line: the stripped-base branch was
selected on `harvesters === 0 && factories === 0`, which is true of every match
that opens with only a Command Post, so both sides were paid 4 mats/s from the
first tick. Eight tests in `tests/infrastructure.test.ts`,
`tests/unit-upgrade-smoke.test.ts` and `tests/economy-rebuild.test.ts` encoded the
old 1-per-second opening, which is how the drift surfaced as a red suite.

The rule now reads: **the Command Post pays nothing until the side owns a
materials plant** (a Material Refinery standing or under construction) or a
completed land production facility that can field a hauler. After that it pays
1 mat/s, or the 4 mat/s stripped rate when no hauler and no production line
remain. An opening is therefore paid from its authorised starting bank alone.

---

## 3. Cloudflare deployment architecture (as it is)

Three deployments of one project. Nothing runs on the game client except the
static bundle.

```
                    ┌──────────────────────────────────────────────┐
Browser ──────────► │ Cloudflare Pages  project: moderncombinedarms│
(one origin)        │  static bundle (dist/), _headers, sw.js      │
                    │                                              │
                    │  functions/api/account/[[path]].ts           │
                    │   └─ service binding MCA_ACCOUNT ─┐          │
                    └───────────────┬───────────────────┼──────────┘
                                    │ wss/https         │ forward
                                    ▼                   ▼
                    ┌───────────────────────┐  ┌──────────────────────────┐
                    │ Worker                │  │ Worker mca-accounts      │
                    │ mca-multiplayer-      │  │  /api/account/*          │
                    │ staging               │  │  D1 binding DB           │
                    │ ROOMS  (MatchRoom DO) │  └────────────┬─────────────┘
                    │ CAPACITY (Capacity DO)│               │
                    └───────────────────────┘               ▼
                                                  D1 database mca-accounts
                                                  migrations/0001, 0002
```

### 3.1 Static app — Pages

- `npm run build` runs `tsc --noEmit`, `vite build` into `dist/`, then
  `tools/build-sw.mjs` which stamps the service-worker precache list.
- `npm run release` deploys `dist/` to the Pages project `moderncombinedarms`
  (branch `main`) and then polls the live site until it serves the new bundle.
- [public/_headers](../public/_headers) is copied verbatim: CSP (single origin,
  `connect-src` allows the room worker's `https`/`wss` origins), HSTS, no framing,
  `no-store` for `/api/*`, and revalidation for `/sw.js`.
- No environment variable reaches the browser except the ones compiled in:
  `VITE_MULTIPLAYER_URL` from [.env.production](../.env.production), plus the
  version/stage/build/commit defines from `vite.config.ts`.

### 3.2 Room worker — `mca-multiplayer-staging`

- Code: `dist-mp-room/roomWorker.js`, built by `mp-room-vite.config.ts`.
- Bindings: Durable Objects `ROOMS` (`MatchRoomDurableObject`) and `CAPACITY`
  (`CapacityCoordinatorDurableObject`), both SQLite-backed, migration tag `v1`.
  Room state, seats and capacity leases live in Durable Object storage, not D1.
- Vars: `MP_ONLINE_ENABLED`, `MP_DEFAULT_MATCH_SECONDS`, `MP_MAX_MATCH_SECONDS`,
  `MP_ABANDON_AFTER_MS`, `MP_ALLOWED_ORIGINS` (exact Pages origin plus one
  wildcard label for deployment previews, and the worker's own origin).
- Secrets: `MP_ADMIN_TOKEN`, `MCA_RESERVATION_TOKEN`, `MCA_IDENTITY_TICKET_SECRET`.
- Two configs, one worker: [mp-room-wrangler.jsonc](../mp-room-wrangler.jsonc) for
  local `npm run rooms:dev` (development mode on, loopback admitted) and
  [mp-room-wrangler.live.jsonc](../mp-room-wrangler.live.jsonc) for
  `npm run rooms:deploy` (development mode off, no probe route).
- The worker refuses an unlisted `Origin` on both the HTTP surface and the socket
  upgrade, before it touches a room.

### 3.3 Account worker — `mca-accounts`

- Code: `dist-account/accountWorker.js`, built by `account-vite.config.ts`.
- D1 binding `DB` → database `mca-accounts`, schema from
  [migrations/](../migrations) (`0001_accounts.sql`, `0002_career.sql`), applied
  with `npm run accounts:migrate` (remote) or `npm run accounts:migrate:local`.
- Vars: `APP_ORIGIN`, `ALLOWED_ORIGINS`, `SESSION_TTL_DAYS`, the OAuth client ids.
  Secrets: the OAuth client secrets and `MCA_IDENTITY_TICKET_SECRET`. Client ids
  are public; client secrets never enter the repository.
- Served on the player's own origin through the Pages Function, so the session
  cookie stays first-party and no CORS path exists. The Function forwards the
  request untouched and returns the Worker's response, `Set-Cookie` included.

### 3.4 Who trusts whom

- The browser holds an `HttpOnly` session cookie for `mca-accounts` only.
- For a room, the client asks the account service for a short-lived identity
  ticket (HMAC). The room worker strips any identity headers the browser sent,
  verifies the ticket against `MCA_IDENTITY_TICKET_SECRET`, and re-adds
  `X-MCA-Verified-Account` for the Durable Object. No ticket means guest, which
  is a supported state.
- Simulation never reads identity: `playerId` is an index into
  `Game.state.players`. A room seat is authorised by its own bearer token.
- A match result is written to a career only for local battles. Room results are
  computed (`matchResult.ts`) but not yet recorded against an account — that is
  what `MULTIPLAYER_FEATURE.accountLinking: false` means now.

### 3.5 Local development

| Piece | Command | Address |
| --- | --- | --- |
| Game client | `npm run dev` | `http://127.0.0.1:5173` |
| Room worker | `npm run rooms:dev` | `http://127.0.0.1:8791` |
| Account worker | `npm run accounts:dev` | `http://127.0.0.1:8792` (proxied by the dev server at `/api/account`) |

`npm run accounts:dev` needs a local D1 (`npm run accounts:migrate:local`) and a
gitignored `.dev.vars` for OAuth credentials; without it the account endpoints
answer `503 accounts-unavailable` and guest play is unaffected.

---

## 4. Verification baseline

Run from a clean checkout, in this order:

```bash
npm ci                 # clean install, lockfile honoured
npm run typecheck      # tsc --noEmit
npm test               # vitest run, 163 files
npm run build          # typecheck + vite build + service-worker stamp
```

| Check | Result on this host |
| --- | --- |
| `npm ci` | clean install from the lockfile; `node_modules` rebuilt |
| `npm run typecheck` | exit 0 |
| `npm test` | 163 files, 2,402 tests, all passing, 411 s, exit 0 (§4.1) |
| `npm run build` | exit 0; `dist/assets/index-*.js` ≈ 1.6 MB; `sw.js` precaches 13 files |
| `npm run bench` | simulation, save and pathfinding numbers printed; not asserted tightly (§4.2) |
| `npm run ai:matchups` | 48 full-length matches; the ladder margins in §4.2 |

### 4.1 Suite shape

- `vitest run` starts one isolate worker per file: 163 files on 8 cores, 411 s
  wall clock on this host for a clean pass.
- `testTimeout` is 90 s. These are whole simulated battles timed by CPU speed, so
  a ten-second test can take forty while its neighbours run. The limit guards a
  hang; it is not a performance assertion.
- Two tests dominate the clock and are deliberately budgeted for it:
  `tests/ai-matchups.test.ts` (48 matches, ~576,000 simulated ticks, 20-minute
  budget) and the air/naval branch test in `tests/ai.test.ts` (26,000 ticks,
  120-second budget). Before this pass both used budgets below their own runtime
  and failed on any loaded host.
- `tests/perf.test.ts` measures wall-clock cost, so its thresholds are
  catastrophe guards rather than targets: the 163-entity stress run measures ~13
  ms/tick idle, ~31 ms/tick with a few neighbours and 57 ms/tick with the whole
  suite in flight, and the guard sits at 150 ms/tick. Before this pass the same
  test asserted a 40 ms/tick provisional target and failed on a busy host three
  runs out of four without measuring a regression. The numbers above are the
  record; `npm run bench` alone on an idle host is what compares to
  [docs/PLAN.md](PLAN.md).

### 4.2 Recorded measurements

| Measurement | Value |
| --- | --- |
| Baseline tick cost (authored island, 24 entities) | ~0.44 ms/tick |
| Stress tick cost (163 entities, first contact) | ~13 ms/tick idle, ~31 ms/tick with a few neighbours, 57 ms/tick with the full suite running |
| Pathfinding batch (100 attack-move orders) | ~133 ms |
| Save/restore (133 entities) | ~12 ms serialise, ~22 ms restore, ~309 KiB |
| Ladder margins (48 matches, mirrored arena) | Recruit vs Veteran **−30,911** (7–9), Elite vs Recruit **+116,863** (13–3), Elite vs Veteran **+90,182** (11–5); 525 s wall clock |

The Recruit-versus-Veteran margin clears its −30,000 floor by about 900 points, which
is inside the run-to-run noise of a 48-match ladder: it is the pairing to re-measure
before any commander change, and a result between −30,000 and −29,000 should be read
as "unchanged", not as a pass with headroom.

### 4.3 Determinism fixtures

`tests/phase2a7-first-tick-profiling.test.ts` and
`tests/phase2a8-simulation-equivalence.test.ts` pin the state hash and the paths of
the pre-optimisation reference run. They are re-anchored whenever the hash gains
authoritative content. In this pass:

- All checksums moved, because the headquarters bank figures in every recorded
  state changed (economy gate above). Paths, unit counts, event counts, RNG state
  and the scaling probes are unchanged — those are re-asserted.
- One authored path exception is now recorded in the fixture: an artillery hull's
  final route takes three legs around a standing structure where it used to drive
  straight through, which is the building-avoidance fix. The fixture comment names
  it so a future reader does not read it as drift.

---

## 5. Release verification checklist

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run release -- --dry-run     # version agreement, clean tree, tests, build; stops before upload
npm run release                  # uploads dist/ to Pages and polls until live
```

- `npm run release` refuses a dirty tree (the build stamp is the commit count) and
  refuses a version that `package.json`, `CHANGELOG.md` and the `#menu-build`
  footer do not agree on.
- `--dry-run` is the exact same checks without the upload; use it before every
  release commit.
- Worker changes are separate: `npm run rooms:deploy` and
  `npm run accounts:deploy`. Applying account migrations
  (`npm run accounts:migrate`) is a data change and is not part of the Pages
  release. The three room-origin values in §3.2/§3.1 must move in one commit.
- Credentials: `npx wrangler login` once per machine. No secret is read from or
  written to the repository.

## 6. Not verified by this baseline

- No human playtest of the balance changes recorded above; they are covered by
  fixtures and the ladder only.
- The mobile result screen was unusable at small viewports in this baseline;
  HUD-11 and the HUD-10/HUD-12 layout-rebuild defects were fixed on 2026-11-15
  (see [docs/AUDIT_FINDINGS.md](AUDIT_FINDINGS.md) §9.4).
- Gamepad support, physical touch devices and audio have never been exercised on
  hardware.
- The account service's live OAuth round trip needs real client secrets and is
  not part of the automated suite; its logic is covered against an in-memory
  harness (`tests/accounts-harness.ts`).
