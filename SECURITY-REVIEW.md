# MCA — Security Review

**Project:** Modern Combined Arms (MCA)
**Review type:** read-only multiplayer readiness security review
**Repository:** `C:/Users/aeryt/Documents/Modern Combined Arms` (`master`)
**Date:** 2026-10-29
**Remediation:** MP-05 and the static-shell portion of MP-06 were fixed in a follow-up on 2026-10-29.
**Companion document:** [docs/MULTIPLAYER_READINESS_AUDIT.md](docs/MULTIPLAYER_READINESS_AUDIT.md)

---

## Status and scope

This review was performed against the current tree and the deployed static site
at <https://moderncombinedarms.pages.dev>. The review itself did **not**
implement multiplayer, change source, change configuration, install packages, or
commit anything.

The user's scope for the audit explicitly said:

> Do not change source files, configuration, dependency manifests, lockfiles,
> tests or generated assets. Do not install packages, commit changes.

The Convio pipeline's final stage asks for critical and high findings to be
fixed. That instruction conflicted with the audit's read-only scope, so the
audit only proposed fixes. A **separate follow-up request** then authorised
remediation of the service-worker API-cache risk and the shell security-header
policy. Those two changes are recorded below; every other finding remains open.
The rest of the report is unchanged audit evidence.

The repository already contained unrelated modified and untracked work when the
review began. It was preserved; the only files added by this review are this
document and the companion audit.

---

## Method

- Manual review of the command ingress, state ownership, fog/hidden-information
  projection, save/scenario parsing, service-worker caching, HTTP headers, input
  and lifecycle boundaries.
- Whole-tree search for network, account, room, fetch, WebSocket, storage and
  dangerous DOM sinks.
- `npm audit` (prod and full), current-tree and full-history secret-pattern scan,
  `npx tsc --noEmit`, the full Vitest suite and the measured performance suite.
- Passive header inspection of the deployed Pages site.
- Review of Cloudflare's current free-plan limits and deployment model for the
  proposed zero-cost architecture.

Coverage gaps: Gitleaks, OSV-Scanner, Semgrep, Trivy, Docker and OWASP ZAP were
not installed, and the read-only scope prohibited installing them. These checks
were **not run**; their absence is a gap, not a pass.

---

## Severity definitions

| Severity | Meaning |
|---|---|
| **Critical** | The feature is unsafe to expose in this form; exploitation gives another player control, hidden information or a false result. |
| **High** | A likely exploit, data exposure or account compromise once the feature exists; must be fixed before any public online launch. |
| **Medium** | A correctness, privacy or operational defect that should be fixed before launch but is not immediately exploitable in the current static build. |
| **Low** | Hardening or defence-in-depth. |

---

## Summary

| ID | Finding | Severity | Status |
|---|---|---|---|
| MP-01 | Client owns the authoritative simulation and command queue | Critical | Open — architectural |
| MP-02 | Full hidden state and original scenario would leak to clients | Critical | Open — architectural |
| MP-03 | Command envelope is spoofable and unbounded | Critical | Open — architectural |
| MP-04 | No identity, session or room layer | High (gap) | Open — new subsystem |
| MP-05 | Service worker caches API responses | High | **Fixed** — worker v4 + regression tests |
| MP-06 | No security headers; wildcard CORS on the shell | High before accounts | **Partially fixed** — shell headers added; API Function still owns `/api/*` CORS |
| MP-07 | Save/scenario parsing is not a hostile-input boundary | High if shared | Open — do not accept network saves |
| MP-08 | Victory is computed from one local perspective | High (correctness) | Open — server result needed |
| MP-09 | Fog and teams are fixed at two | Medium | Open — scope to 1v1/2v2 |
| MP-10 | No reconnect/snapshot/anti-desync protocol | Medium | Open — Phase 3 |
| MP-11 | Room discovery abuse and privacy rules | Medium | Open — Phase 2 |
| MP-12 | Guest/account data minimisation | Medium | Open — Phase 4 |
| MP-13 | Elevation parser cap 4 vs editor cap 8 | Medium (current bug) | Open — independent fix |
| MP-14 | No build/protocol handshake | Medium | Open — Phase 3 |

MP-05 is fixed and the static-shell portion of MP-06 is implemented. The other
Critical and High findings (MP-01, MP-02, MP-03, MP-04, MP-07 and MP-08) remain
open; they are the blockers for server-authoritative play, not shell hardening.

---

## Critical findings

### MP-01 — Client-authoritative simulation

**Evidence**

- `src/app.ts:1752-1759` — the browser's `requestAnimationFrame` loop is the only
  caller of `game.tick()`.
- `src/sim/game.ts:602-604` — `enqueueCommand(cmd: Command)` pushes the object
  without checking who sent it.
- `src/sim/game.ts:606-689` — `processCommands` dispatches `cmd.team` as the
  owner; `ownedEntities` checks that the entity belongs to that same supplied
  owner.
- `src/app.ts:1653-1660` — `startBattle` always creates the game with
  `localPlayerId: 0`.

**Impact.** A client that controls the command object controls any player id it
names. In a relay or client-hosted design, a modified client can command the
opponent's units, change resources, reveal the map or fabricate a result. There
is no independent state to contradict it.

**Fix.** Run the simulation only in the room Durable Object. Authenticate a
session, map it to a seat and player id server-side, rewrite the command owner,
and send the client a read-only projection. Never accept a client-supplied
`team`, `owner`, `playerId` or `localPlayerId` as authority.

**Regression tests.** A command from seat A naming seat B's entity ids is
rejected; a command with a spoofed `team` is rewritten or rejected; a command
after `matchEnd` is rejected; a flood over the per-seat rate limit is rejected
without affecting the room tick.

**Phase.** 1 (gate), 3 (live match).

---

### MP-02 — Hidden-state and scenario leak

**Evidence**

- `src/sim/types.ts:710-739` — `GameState` contains both teams' entities,
  `fog: Uint8Array[]`, `contacts`, `charted` and `ai`.
- `src/sim/game.ts:5106-5140` — `toSave()` serializes those fields, including
  `localPlayerId`.
- `src/sim/scenario.ts` — the authored `Scenario` contains both teams'
  `units` and `structures`; `App.startBattle` clones and passes it to `Game`.
- `src/render/combatFx.ts:5-40` — current visibility gating is a presentation
  filter, not a data boundary.

**Impact.** A joining client that receives a save, a `Game` object or the raw
scenario can read the enemy base, enemy units, AI target and the whole map,
regardless of what the renderer draws. A modified client can exfiltrate it.

**Fix.** Add a server-only `projectForTeam(game, team)` returning a sanitized
snapshot:

- own/allied entities in full;
- enemy entities only while `isVisibleTo(team, id)`;
- remembered structures without live HP;
- only that team's fog, contacts and charted set;
- only that team's resources;
- filtered events;
- no AI state, no original scenario units/structures, no enemy queues or
  contacts, no save `localPlayerId`.

The client should render a read-only replica, not a ticking `Game`.

**Regression tests.** Serialize a team-0 snapshot and assert it contains no
hidden enemy id, coordinate, AI target, enemy resource or original scenario
enemy unit/structure. Repeat for team 1 and for a remembered-only structure.

**Phase.** 1.

---

### MP-03 — Spoofable and unbounded command envelope

**Evidence**

- `src/sim/types.ts:605-621` — every `Command` variant carries `team`.
- `src/sim/game.ts:602-604`, `606-689` — no shape, size, target-visibility or
  rate validation.
- `src/app.ts` — UI commands are built with `team: this.localPlayerId` in many
  methods (`commandMove`, `commandAttack`, `commandCapture`, `commandGarrison`,
  `commandRepair`, `commandProduce`, etc.).

**Impact.** A modified client can issue orders for another player, send
unbounded id arrays, target hidden entity ids, place buildings without authority,
or burn room CPU with a command flood. `Game`'s ownership checks are a useful
second line of defence, not a substitute for an authenticated ingress.

**Fix.** A versioned server-side `CommandGate`:

- resolve session → seat → player id; discard `team`;
- reject unknown keys and payloads over 4 KiB;
- cap `ids` at 48, require unique integers;
- require finite, in-bounds coordinates and a known `targetId`;
- for hostile targets, require current visibility or charted knowledge;
- let `Game` re-check ownership, production, placement and rally legality;
- rate-limit per seat (20 msg/s, burst 60) and batch per 100 ms;
- reject all commands after the result is decided.

**Regression tests.** See MP-01; additionally, an out-of-bounds move, an
oversized id array, a hidden target and an unknown `defId` must each fail with a
typed error and no state mutation.

**Phase.** 1.

---

## High findings

### MP-04 — No identity, session or room layer

**Evidence.** `index.html:191-195` says multiplayer is unavailable. A whole-tree
search finds no runtime `fetch`, `WebSocket`, account table, session cookie,
lobby or room code. `Screen = 'menu' | 'battle' | 'editor'` has no online state
(`src/app.ts:86-104`).

**Impact.** Guest play, optional accounts, public/private rooms and discovery
have no substrate. Bolting them onto `startBattle` would couple network state to
the single-player lifecycle.

**Fix.** New subsystem: Pages Function API, D1 directory, one `GameRoom` DO per
room, a client transport and a lobby UI. Keep `startBattle` for single-player.

**Phase.** 2–4.

---

### MP-05 — Service worker caches same-origin API responses

**Evidence.** `public/sw.js:92-110` intercepts every same-origin GET and applies
stale-while-revalidate; it caches any `response.ok` response. `src/main.ts:11-18`
registers it in production. There is no `/api/` exclusion.

**Impact.** Once `/api/rooms` or `/api/session` exists on the same origin, the
worker can serve a stale directory, a previous user's response, or a cached
authenticated payload after logout. The Cache API key does not include cookies
by default. This is a correctness and data-exposure bug.

**Fix.** In the fetch handler, return early for `url.pathname.startsWith('/api/')`
and for `Authorization` requests. Never cache `Set-Cookie`, `Cache-Control:
no-store` or `Vary: Cookie` responses. Keep the offline shell for navigation and
hashed assets only. Add a test that asserts `/api/*` never enters a cache.

**Remediation (2026-10-29, follow-up).** `public/sw.js` now bypasses `/api`,
`/api/*`, `Authorization` requests and `cache: 'no-store'` requests. Its response
guard refuses redirected responses (a redirect can land on a personalized route
while the cache key stays the original URL), `Set-Cookie`, `no-store`, `private`,
`Vary: Cookie` and `Vary: Authorization`. The cache version is `mca-v4`, so old
entries are dropped on activate. `tests/service-worker.test.ts` exercises each
boundary and passes. The built `dist/sw.js` contains the guard.

**Phase.** 2, before the API is exposed. Done before Phase 2.

---

### MP-06 — Missing security headers and wildcard CORS

**Evidence.** Passive inspection of the deployed site found
`X-Content-Type-Options` and `Referrer-Policy`; it found **no CSP, HSTS,
frame protection or Permissions-Policy**, and found
`Access-Control-Allow-Origin: *`. `public/_headers` only declares the manifest
MIME type and `sw.js` revalidation.

**Impact.** No CSP containment for a future XSS; no clickjacking protection for
room creation/join; a wildcard CORS policy would be dangerous if API responses
ever allowed credentials. The static site has no accounts today, so this is not
an immediate account compromise; it becomes High as soon as sessions exist.

**Fix.** Add an explicit Pages `_headers` policy before the API ships:

- CSP: `default-src 'self'`; `script-src 'self'` after moving the inline boot
  script out of `index.html`; `style-src 'self' 'unsafe-inline'` only while
  inline styles remain; `img-src 'self' data: blob:`;
  `media-src 'self' blob:`; `connect-src 'self'
  wss://moderncombinedarms.pages.dev`; `frame-ancestors 'none'`;
  `base-uri 'none'`; `object-src 'none'`; `form-action 'self'`.
- `Strict-Transport-Security: max-age=31536000` (do not add
  `includeSubDomains` until every subdomain is HTTPS-only).
- `X-Frame-Options: DENY` for older browsers.
- `Permissions-Policy: geolocation=(), camera=(), microphone=()`.
- `/api/*`: `Cache-Control: no-store`, `Vary: Cookie`, no wildcard CORS.
- Do not add COEP casually; it can break audio, media and workers.

**Remediation (2026-10-29, follow-up).** `public/_headers` now ships the CSP,
HSTS, `X-Frame-Options`, `Permissions-Policy`, `Referrer-Policy` and
`X-Content-Type-Options` policy for the shell, plus `no-store`, `Pragma`,
`Vary: Cookie`, `Referrer-Policy: no-referrer` and
`Cross-Origin-Resource-Policy: same-origin` for `/api/*`. The only inline handler
in the boot path was replaced with an event listener, so `script-src 'self'` does
not break the fatal-error reload. `tests/security-headers.test.ts` parses the
policy and checks the critical directives and the absence of inline handlers.

The policy is in the built `dist/_headers`; it has **not been deployed** by this
follow-up. The `/api/*` block is static-host configuration only: once a Pages
Function exists, the Function must emit those headers itself. The static site's
platform-level `Access-Control-Allow-Origin: *` is harmless for public assets but
must not be inherited by API responses.

**Phase.** 2. Shell policy done; API response headers still to do with the Function.

---

### MP-07 — Save/scenario parsing is not a hostile-input boundary

**Evidence.** `parseScenario` is fairly strict (`src/sim/scenario.ts:190-338`):
format/version, 16–256 dimensions, exact tile count, known terrain/factions/
buildings/units, full hex colours. `Game.fromSave` is looser
(`src/sim/game.ts:5147-5220`): it checks `format`, version, arrays, content ids
and faction ids, then casts most of `state`. `migrateSave` supplies defaults for
missing values.

**Impact.** A crafted save could contain negative or non-finite positions, huge
arrays, impossible owner ids or inconsistent map/fog lengths. That is tolerable
for a local file the user chose; it is not tolerable for a file received from
another player or a room host.

**Fix.** Never accept a save over the network. If map sharing is added, parse on
the server with `parseScenario` and `validateScenario`, cap body/tile sizes and
reject unknown fields. If replays are shared, give them a separate validated
schema. Never feed a shared save into an authoritative client.

**Phase.** Before any map/replay sharing; not needed for Phase 2 built-in maps.

---

### MP-08 — Victory computed from one local perspective

**Evidence.** `Game.evaluateVictory` reads `this.localPlayerId` and `Game.finish`
marks only that perspective's enemies defeated
(`src/sim/game.ts:4931-4985`). `Game.fromSave` restores `localPlayerId` from the
save (`src/sim/game.ts:5183`).

**Impact.** A room with one `Game` and several seats cannot use the
single-player finish path. Player 2 can be shown "victory" because player 1's
local perspective won, or the room can end with the wrong loser. A
save-derived `localPlayerId` must not be trusted online.

**Fix.** Add a neutral `MatchResult` evaluator over all players/teams and
broadcast it. Map the result to each seat in the client for the existing
victory/defeat UI. Leave single-player `evaluateVictory` unchanged.

**Phase.** 1 (result), 3 (UI).

---

## Medium findings

### MP-09 — Two-team ceiling

`MAX_TEAMS = 2` (`src/sim/constants.ts`); `refreshVision` loops `team < 2` and
`state.fog` is `[0, 1]`. 1v1 and 2v2 are supported; 3-team/FFA is not. Scope the
first release to two teams and up to four players. Generalising fog arrays,
colour masks and result evaluation is a separate phase with tests.

### MP-10 — No reconnect or snapshot protocol

The only state format is `toSave`/`fromSave`, which includes the whole scenario
and both teams. There is no room snapshot, delta, ack or reconnect path. Define a
server snapshot separate from saves; send a full projection on reconnect; use
10 Hz deltas, 100 ms interpolation and backpressure. Do not send a save to a
client.

### MP-11 — Room discovery abuse and privacy

No room table/code/invite exists. Public names and display names are untrusted.
Private rooms must never be listed; use a 10-character code (≈50 bits) stored as
an HMAC, 10 attempts/minute/session, generic failures, and 32-byte invite tokens
in the URL fragment so they do not hit Referer or request logs. Cap room
creation and joins; no global chat in v1.

### MP-12 — Guest/account data minimisation

A guest id is pseudonymous personal data. Use an opaque 256-bit session token in
a `__Host-` cookie and store only its hash. For accounts, use an OAuth subject and
display name; do not request email unless needed. Do not store raw IPs; use a
keyed, short-TTL hash only if abuse limiting requires it. Publish a retention and
deletion policy. Keep single-player localStorage local.

### MP-13 — Elevation parser bug (current tree)

`parseScenario` caps elevation at 4 (`src/sim/scenario.ts:206`) while
`MAX_ELEVATION = 8` (`src/sim/constants.ts:29`), the editor paints up to 8
(`src/ui/editor.ts:957`), and `tests/terrain-props.test.ts` asserts the 8-level
ceiling. `cloneScenario` calls `parseScenario`, and `App.startBattle` clones the
scenario, so a high-relief map can fail to load or start. This is independent of
multiplayer but directly relevant to map sharing. Fix the bound to
`MAX_ELEVATION` and add a round-trip test at the maximum.

### MP-14 — No build/protocol handshake

The client build stamp exists (`vite.config.ts`, `src/version.ts`), but no server
handshake exists. A room must record game build, commit and protocol version, and
reject incompatible clients with a clear reload message. Do not auto-upgrade a
live room across a rules change.

---

## What is already safe or reusable

- **Deterministic rules core.** `tests/determinism-save.test.ts` proves identical
  hashes for identical seeds/commands, batch invariance and save continuation.
- **Fog knowledge discipline.** `tests/fog-integrity.test.ts` proves unseen
  structures cannot steer AI, contacts are sightings rather than maps, and team
  vision is shared only within a team.
- **Pure simulation imports.** `Game` and its data modules do not import DOM or
  network APIs; they are suitable for a Worker/DO runtime after a server build.
- **Input separation.** `InputController` owns devices; commands are a small set
  of `App` methods that can be routed through a sink.
- **Event-driven presentation.** Audio and effects consume ordered simulation
  events and already gate on fog; server-side event filtering preserves this.
- **Static offline shell.** Single-player can continue if every online service is
  unavailable, provided the API is not added to the service-worker cache.
- **Existing escapers.** Authored text rendered by the HUD/modal is generally
  passed through `escapeHtml`; new user-controlled room/display names still need
  explicit treatment and tests.

---

## Fix order

1. **MP-05, MP-06** — service-worker API bypass and headers. **MP-05 done;
   shell headers done.** The API Function must still emit the `/api/*` headers
   when it is added.
2. **MP-01, MP-03** — server authority and command gate. This is the core safety
   boundary; do it before any match can start.
3. **MP-02** — per-team projection and leak tests. No network match without it.
4. **MP-08** — neutral match result, so the room cannot report the wrong winner.
5. **MP-04, MP-11, MP-12** — rooms, discovery, guest/account privacy; build on
   the safe command/projection core.
6. **MP-10, MP-14** — reconnect, snapshot format and build handshake.
7. **MP-07, MP-09, MP-13** — scope/sharing hardening and the independent
   elevation bug.

Do not deploy Phase 2 (rooms/API) before items 1–3 are green.

---

## Verification performed

| Check | Result |
|---|---|
| `npm audit --omit=dev` | 0 vulnerabilities |
| `npm audit` (all) | 0 vulnerabilities |
| Current-tree secret-pattern scan | 0 hits; no tracked `.env`/`.dev.vars` |
| Full-history secret-pattern scan | 0 hits |
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 761 passed across 69 files at audit time |
| `npx vitest run tests/perf.test.ts` | baseline 0.230 ms/tick; stress 5.371 ms/tick at 163 entities; save 5.0/10.0 ms; 308 KiB |
| Deployed headers at audit time | HTTPS redirect, `nosniff`, `Referrer-Policy` present; no CSP/HSTS/frame protection/Permissions-Policy; `Access-Control-Allow-Origin: *` |
| Follow-up: `npx vitest run tests/first-paint.test.ts tests/service-worker.test.ts tests/security-headers.test.ts` | 21 passed |
| Follow-up: `npx tsc --noEmit` | exit 0 |
| Follow-up: `npm run build` | exit 0; `dist/_headers` and the guarded `dist/sw.js` are present; not deployed |
| Gitleaks / OSV / Semgrep / Trivy / ZAP | Not installed; not run (coverage gap) |

The audit itself changed no source, configuration, dependency manifest, lockfile,
test or generated asset; it only added this report and the companion audit. The
follow-up remediation changed `public/sw.js`, `public/_headers`, `src/main.ts`,
the Node type shim and two regression tests. It was built locally but was not
deployed.

---

## Residual risk statement

Until MP-01, MP-02 and MP-03 are fixed, MCA must not expose a network match,
including a "friends only" relay, a public room, or a client-hosted listen server.
The current static build is a single-player game and remains within its existing
local trust model. The zero-cost architecture is viable at hobby scale under
Cloudflare's current published free limits, but those limits are not a
contractual guarantee and the deployment must fail closed rather than fall back
to a paid plan.
