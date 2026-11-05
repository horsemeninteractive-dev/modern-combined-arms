# MCA — Multiplayer Readiness Audit and $0 Hosting Architecture

**Status:** audit complete; follow-up remediations applied for MP-05 and the static-shell portion of MP-06
**Repository:** `C:/Users/aeryt/Documents/Modern Combined Arms` (`master`)
**Deployed shell:** <https://moderncombinedarms.pages.dev>
**Audit date:** 2026-10-29
**Scope owner:** project owner

---

## 1. Verdict

The single-player simulation is in good shape for a server-authoritative
multiplayer build. It is a fixed-step, seeded, deterministic 20 Hz simulation
with a pure TypeScript rules core, a single command queue, team-indexed fog and
regression tests for determinism, save round-trips and fog knowledge. Those are
the expensive parts, and they already exist.

Multiplayer itself does not exist. There is no runtime `fetch`, WebSocket,
account, lobby, room or transport code. The menu even labels the mode
"Network play unavailable" (`index.html:191-195`). More importantly, the current
architecture is **client-authoritative**: the browser owns the only `Game`, the
only tick loop and the only command queue, and a command carries its own
`team` value. Nothing in the current tree can be exposed to another player
without turning every client into a trusted server.

The safe path is therefore not peer relay or deterministic lockstep. It is:

1. A **server-authoritative `Game`** running the existing simulation unchanged.
2. A **command gate** that derives the acting player from an authenticated seat
   and ignores any client-supplied owner or team.
3. A **per-team projection** that sends only what that team may know. The full
   `GameState`, the two-team fog arrays, contacts, AI state and the original
   `Scenario` must never be sent to a client.
4. A **Cloudflare-only, free-plan deployment**: Pages for the static shell,
   a Pages Function for the same-origin API, a Durable Object per room for
   authority and a D1 directory for public rooms.

Cloudflare's published free allowances are sufficient for a small public
service, but only at hobby scale. The binding constraint is not requests; it is
Durable Object duration: **13,000 GB-s/day at 128 MB is about 28.2 active
object-hours per day**, roughly 37 full 45-minute matches or 56 half-hour
matches per day across the whole deployment. That is a real ceiling, not an
estimate of infinite scale. When it is reached the free plan returns errors
rather than billing, so multiplayer must fail closed while the static
single-player shell keeps working.

**The audit itself changed no source, configuration, dependency manifest,
lockfile, test or generated asset.** It only added this document and
[`SECURITY-REVIEW.md`](SECURITY-REVIEW.md). A follow-up request then
authorised the shell-hardening changes described under MP-05 and MP-06; those
were built locally but not deployed. The working tree already contained
substantial unrelated work; it was preserved untouched.

---

## 2. What was inspected

The review was performed against the current tree, not against earlier phase
reports or screenshots.

| Area | Evidence inspected |
|---|---|
| Tick scheduling and time | `src/app.ts` frame loop and accumulator; `src/sim/game.ts` `tick()`/`advance()`; `src/sim/constants.ts` `TICK_RATE` |
| Units, combat, paths, construction | `src/sim/game.ts` `updateUnits`, `updateOrderTargeting`, `commandPlaceBuilding`; `src/sim/pathfinding.ts`; `src/sim/combat.ts`; data tables |
| RNG / nondeterminism | `src/core/rng.ts`; `Game.rngState`; AI `aiRng`; `Math.random`/`Date.now` call sites |
| Commands | `src/sim/types.ts` `Command`; `src/sim/game.ts` `enqueueCommand`/`processCommands`; `src/app.ts` command methods; `src/ui/input.ts` |
| State and serialization | `src/sim/types.ts` `GameState`; `Game.toSave`/`fromSave`; `src/sim/save.ts`; `src/sim/saveMigrations.ts` |
| Maps, seeds and initial state | `src/data/scenarios.ts`; `src/data/maps.ts`; `src/data/tutorial.ts`; `src/data/campaign.ts`; `Game.initialize`; `parseScenario` |
| Fog, vision and hidden state | `Game.refreshVision`, `refreshVisibleEntities`, `isVisibleTo`, `visionStateOf`, `fogAt`; `src/render/combatFx.ts` visibility gates |
| Victory and defeat | `Game.evaluateVictory`, `Game.finish`; `App.checkVictory`; HUD victory/defeat markup |
| Saves and local persistence | `SAVE_PREFIX`, `saveToSlot`, `readSlot`, `loadFromSlot`; `localStorage` settings/campaign keys |
| Input | `src/ui/input.ts` pointer/touch/gamepad; `App` command entry points |
| Startup and lifecycle | `src/main.ts`; `App` `Screen`/`MenuView`; `startBattle`, `showMenuView`, `toMenu`, loading screen |
| Audio/presentation | `App.drainEvents`; `src/ui/audio.ts`; `audioSpatial`; `announcer.ts`; `unitVoice.ts` |
| Build and deployment | `package.json`; `vite.config.ts`; `tools/release.mjs`; `public/sw.js`; `public/_headers`; deployed headers |
| Network/accounts/lobby | whole-tree search: none present; only the disabled menu panel |

Checks run during the audit:

- `npm audit --omit=dev` and full `npm audit`: 0 vulnerabilities.
- Current-tree and full-history secret-pattern scan: 0 hits; no tracked `.env` or
  `.dev.vars`.
- `npx tsc --noEmit`: exit 0.
- `npm test`: **761 passed across 69 files** at the audit run.
- `npx vitest run tests/perf.test.ts`: baseline **0.230 ms/tick** (24 entities);
  stress **5.371 ms/tick** (163 entities); 100-order path batch **63.1 ms**;
  save serialise **5.0 ms**, restore **10.0 ms**, **308 KiB** save.
- Passive deployed-header inspection at audit time: HTTPS redirect present;
  `nosniff` and `Referrer-Policy` present; **no CSP, HSTS, frame protection or
  Permissions-Policy**; `Access-Control-Allow-Origin: *` on the static site.
  The follow-up build contains the new `_headers` policy; it has not been
  deployed or re-inspected live.
- Gitleaks, OSV-Scanner, Semgrep, Trivy and ZAP were **not installed** and could
  not be installed under the read-only scope. That is a coverage gap, not a
  clean result.

---

## 3. System map and multiplayer classification

Legend:

- **Ready** — can be reused with no behavioural change.
- **Limited** — suitable after a contained adapter or wrapper.
- **Architectural** — needs a new boundary before it is safe online.
- **Unknown** — needs a measured experiment before committing.

| # | Area | Current implementation | Classification | What that means |
|---|---|---|---|---|
| 1 | Tick schedule and time | `App.frame` adds `dt * speed` to `accumulator` and calls `game.tick()` up to 8 times (`src/app.ts:1752-1759`). `Game.tick` is a fixed 20 Hz step (`src/sim/game.ts:2459-2477`; `TICK_RATE = 20`). | **Limited** | The rules step is reusable as the server clock. The browser must stop being the only authority; online matches run one server tick loop and clients only render snapshots. Pause and speed must be disabled online or made unanimous. |
| 2 | Movement, combat, targeting, pathfinding, construction | `Game.updateUnits`, `updateOrderTargeting`, `moveAlongPath`, `commandPlaceBuilding`; `findPath` in `src/sim/pathfinding.ts`; `src/sim/combat.ts`. No DOM or network dependency. | **Ready** | This is the strongest asset in the repository. Run the same code in the room Durable Object. Do not fork rules for networking. |
| 3 | RNG and nondeterminism | `Rng` is a serialisable Mulberry32 (`src/core/rng.ts`); `Game` persists `rngState`; AI persists `aiRng`. `Math.random` is used in presentation (`particles.ts`, `audio.ts`, menu music) and for a new AI seed in `App.startBattle`; `Date.now` is used for save metadata and generated ids. | **Ready / Limited** | The simulation itself is deterministic. The server must choose the room seed and AI seed with `crypto.getRandomValues`, store them in room state, and pin the build that produced a room. Client `Math.random` never feeds a server command. |
| 4 | Commands | `Command` union in `src/sim/types.ts:605-621`; every variant carries `team`; `Game.enqueueCommand` just pushes (`src/sim/game.ts:602-604`); `processCommands` dispatches and `ownedEntities` trusts the supplied owner (`src/sim/game.ts:606-689`). The UI builds commands with `team: this.localPlayerId` throughout `src/app.ts`. | **Architectural** | Command ingestion is a trust boundary. A networked command must identify a session, not an owner. The server maps session → seat → player id, rewrites or removes `team`, validates every field, then enqueues. The existing `Game` methods are a good second line of defence, not the first. |
| 5 | State ownership, mutation and serialization | `GameState` holds scenario, map arrays, players, entities, projectiles, events, both fog arrays, contacts, charted structures, AI state and command count (`src/sim/types.ts:710-739`). `Game` mutates it in place. `toSave` serialises the whole thing, including `localPlayerId` (`src/sim/game.ts:5106-5140`). | **Architectural** | Never send `GameState` or `toSave()` to a client. A network client needs a projected, per-team snapshot, and the server needs its own compact room snapshot for reconnect. These are different formats from a single-player save. |
| 6 | Map generation, seeds and initial state | `createIslandAssault`, Rust Valley, Kestrel Straits and Foundry District in `src/data/scenarios.ts`/`maps.ts`; tutorial scenario in `src/data/tutorial.ts`; `Game.initialize` spawns every player's starting structures and units. `parseScenario` validates shape, bounds, known factions and known content. | **Limited** | The server should build the room scenario itself from a built-in id, then stamp seats onto it. Do not accept a raw client scenario in the first release. The original `Scenario` contains both teams' `units` and `structures`, so it must be sanitised before it is sent as a "map". |
| 7 | Fog, vision and hidden information | `refreshVision` maintains `state.fog[team]` and a per-team visible entity set; `isVisibleTo`, `visionStateOf`, `fogAt`, `contactsFor`; renderer and audio use `pointVisibleToLocal`/`eventVisibleToLocal` (`src/render/combatFx.ts`). Fog knowledge tests pass. | **Limited** | The per-team rules are sound but the state stores both teams. The server needs a `projectForTeam(game, team)` step that sends own/allied entities, only visible enemies, remembered structures without live HP, that team's fog and contacts, and no AI state. `eventVisibleToLocal` should be generalised to `eventVisibleToTeam`. |
| 8 | Victory, defeat and results | `evaluateVictory` marks players defeated, then decides from `this.localPlayerId` (`src/sim/game.ts:4931-4985`). `finish` writes `state.victory` and marks only the local perspective's enemies defeated. | **Limited** | A room has several local perspectives. The server must compute a neutral `MatchResult` (winner team, defeated teams, reason) from all players and send it to each seat. Do not reuse the single-player `finish` as the room result. The HUD can still display the existing victory/defeat cards by mapping the result to the local seat. |
| 9 | Save/load and persistence | `toSave`/`fromSave`; `migrateSave` v1→v2; localStorage slots, settings and campaign progress (`SAVE_PREFIX`, `SETTINGS_KEY`, `CAMPAIGN_PROGRESS_KEY`). `fromSave` trusts most numeric state after checking arrays and content ids. | **Ready for single-player; not a network format** | Local saves stay local and unchanged. Network reconnect uses a server-owned room snapshot, never a client save. Do not add multiplayer fields to the save schema in the first release. |
| 10 | Input abstraction | `InputController` handles pointer, touch, pinch, keyboard camera and gamepad (`src/ui/input.ts`). It calls `App` command methods, and those call `this.game.enqueueCommand`. | **Limited** | Input devices are already separated from simulation rules. Add one command sink: local implementation calls `game.enqueueCommand`; network implementation serialises to the room socket. Do not let input code know about WebSockets. |
| 11 | Startup, lifecycle and UI navigation | `src/main.ts` boots `App`; `Screen = 'menu' \| 'battle' \| 'editor'`; `MenuView` includes a disabled `multiplayer` panel; `startBattle` always creates `new Game(..., { localPlayerId: 0, enableAI: !isTutorial })` (`src/app.ts:1624-1665`). | **Architectural** | There is no lobby, room or network lifecycle. Add a separate online path; do not overload `startBattle`'s single-player defaults. The menu already has the sidebar-plus-content pattern and a `multiplayer` view placeholder. |
| 12 | Audio and presentation | `App.drainEvents` pulls `eventsAfter`, applies `eventVisibleToLocal`, computes stereo pan and calls `audio.play`; announcer and unit-voice mapping are event-driven (`src/ui/announcer.ts`, `unitVoice.ts`). | **Limited** | Keep the presentation pipeline. The server must filter events per team before sending them, or hidden enemy fire will be audible. Once events are filtered, the existing fog-safe audio path works unchanged. |
| 13 | Dependencies, build and deployment | No runtime dependencies; Vite 8, TypeScript, Vitest. Pages direct upload in `tools/release.mjs`. `public/sw.js` caches the offline shell and public assets; it now bypasses `/api`, `Authorization`, `cache: no-store` and non-public responses. `public/_headers` now carries the shell CSP/HSTS/frame/permissions policy and the `/api/*` no-store rules. | **Architectural for hosting; shell hardening done** | Pages Functions and a separate Durable Object Worker are still new deployment components. The release script must ship both and prove the live bundle, not just the static HTML. The Function must repeat the `/api/*` headers itself; a static `_headers` file is not authoritative for Function responses. |
| 14 | Network, accounts, lobby and rooms | None. No `fetch`, `WebSocket`, `EventSource`, `BroadcastChannel`, service worker API route, account table or room code in `src/`. | **Missing** | This is a new subsystem, not a refactor. Keep it behind a feature flag and keep the static single-player path untouched. |

---

## 4. Trust boundaries and threat model

| Boundary | Trusted? | Current state | Required rule |
|---|---|---|---|
| Browser client | **No** | Owns the whole game and can call `enqueueCommand` with any `team`. | Treat every message as hostile. The server derives identity and authority. |
| Room Durable Object | **Yes**, for its room | Does not exist. | One object per room. It is the only writer of authoritative state. It validates every command and projects every snapshot. |
| Pages Function / API edge | **Yes**, for authentication and routing | Does not exist. | Same-origin only. Validate session, Origin and CSRF on mutations. Never trust a display name or a client-supplied user id. |
| D1 directory | **Yes**, for public metadata | Does not exist. | Public rows only contain public room facts. Private rooms and membership are not discoverable. |
| OAuth provider | **Trusted for the subject assertion only** | Does not exist. | Verify state, PKCE and issuer; map provider subject to a local user. Do not request email unless a feature needs it. |
| Cloudflare platform | **Trusted infrastructure, not a security boundary you control** | Static Pages deployment. | Use bindings and secrets. Do not put credentials in the client. Treat quota exhaustion as an availability event. |
| Single-player local state | **User-owned** | localStorage saves, settings, campaign progress. | Keep working with every online service unavailable. Do not make the boot path depend on the API. |

The most important sentence in this report:

> A client may **request** an action. It may never **assert** who it is, which
> team it controls, what it can see, or what the result was.

---

## 5. Findings

Severity uses the audit's practical scale: **Critical** means the feature is
unsafe to ship in this form; **High** means a likely exploit or data exposure
once the feature exists; **Medium** means a correctness, privacy or operational
defect that should be fixed before public launch; **Low** is hardening.

The full security register, including the read-only status of every item, is in
[`SECURITY-REVIEW.md`](SECURITY-REVIEW.md).

### MP-01 — The client owns the authoritative simulation and command queue

**Severity:** Critical
**Evidence:** `src/app.ts:1752-1759` is the only tick driver. `src/sim/game.ts:602-604` accepts a command object without a session. `src/sim/game.ts:606-689` dispatches `cmd.team` as the owner; `ownedEntities` only checks that the entity belongs to that same caller-supplied owner.
**Impact:** If the current `Game` were moved into a relay or a client-hosted room, any participant could command the other side, edit local resources, reveal the map or fabricate a victory. There is no server-side state to disagree with them.
**Required fix:** Run `Game` only in the room Durable Object. The browser receives a read-only replica. The server maps an authenticated seat to a player id and injects that id; it never reads `cmd.team` from the wire. Client-side prediction, if added later, is cosmetic and reconciled to server snapshots.
**Classification:** Architectural.

### MP-02 — Full hidden state and the original scenario would leak to clients

**Severity:** Critical
**Evidence:** `src/sim/types.ts:710-739` stores both teams' entities, `fog: Uint8Array[]`, `contacts`, `charted` and `ai`. `src/sim/game.ts:5106-5140` serialises all of it. `src/sim/scenario.ts` carries both teams' `units` and `structures`; `App.startBattle` clones that scenario and passes it to `Game`.
**Impact:** Sending a save, a `Game` or the raw scenario to a joining player reveals the enemy base, enemy units, AI target and the entire explored/unexplored map. A modified client can read it even if the renderer hides it.
**Required fix:** Add a server-only projection. It sends:
- static terrain/elevation and the room's public metadata;
- own and allied entities in full;
- enemy entities only while `isVisibleTo(team, id)` is true;
- remembered enemy structures without live HP;
- only that team's fog, contacts and charted set;
- only that team's resource totals;
- filtered events;
- **no AI state, no enemy resources, no original scenario units/structures, no `localPlayerId` from a save.**
**Classification:** Architectural.

### MP-03 — The command envelope is spoofable and unbounded

**Severity:** Critical
**Evidence:** Every `Command` variant carries `team` (`src/sim/types.ts:605-621`). `enqueueCommand` accepts any object; `processCommands` does not check array length, coordinate bounds, target visibility or command rate. `src/app.ts` builds commands with `team: this.localPlayerId`, which is fine locally and unsafe over a wire.
**Impact:** A modified client can issue orders for another player, send ten thousand ids, target a hidden entity id, place buildings outside its authority, or burn the room's CPU with a command flood.
**Required fix:** A server-side `CommandGate` with a versioned schema:
- resolve session → room seat → player id; discard `team`;
- reject unknown fields and payloads over 4 KiB;
- cap `ids` at `MAX_SELECTION` (48), require unique integers;
- require finite `x`/`z` inside the map and a known `targetId`;
- for hostile targets, require current visibility or charted knowledge; never accept an id merely because it exists;
- let `Game` re-check ownership, production lists, placement and rally rules;
- rate-limit per seat (suggest 20 messages/s, burst 60) and batch commands per 100 ms;
- stop accepting commands once the room result is decided.
**Classification:** Architectural.

### MP-04 — There is no identity, session or room layer at all

**Severity:** High (product-blocking gap)
**Evidence:** `index.html:191-195` labels multiplayer "Network play unavailable". Whole-tree search finds no `fetch`, `WebSocket`, account table, session cookie, lobby or room code. `Screen` has no online state (`src/app.ts:86-104`).
**Impact:** The requested guest play, optional accounts, public/private rooms and discovery have no substrate. Adding them ad hoc to `App.startBattle` would couple network state to the single-player lifecycle.
**Required fix:** Build a separate online subsystem: Pages Function API, D1 directory, one `GameRoom` Durable Object per room, a small client transport and a lobby UI. Keep `startBattle` as the single-player path.
**Classification:** Architectural / new subsystem.

### MP-05 — The service worker would cache API responses

**Severity:** High
**Evidence:** `public/sw.js:92-110` intercepts every same-origin GET and applies stale-while-revalidate, caching any successful response. `src/main.ts:11-18` registers it in production.
**Impact:** Once `/api/rooms` or `/api/session` exists on the same origin, the worker can serve a stale room directory, a previous user's session response, or a cache entry after sign-out. Cache API keys do not include cookies by default; this is a data-exposure and correctness bug waiting for the first API route.
**Required fix:** In the fetch handler, return early for `url.pathname.startsWith('/api/')` and for requests with an `Authorization` header. Never cache a response with `Set-Cookie`, `Cache-Control: no-store` or `Vary: Cookie`. Keep the offline shell for navigation and hashed assets only. Add a regression test that asserts `/api/*` is never put into a cache.
**Remediation (2026-10-29):** done. `public/sw.js` (`mca-v4`) bypasses `/api`, `/api/*`, `Authorization` and `cache: 'no-store'`; its response guard rejects redirects, `Set-Cookie`, `no-store`, `private`, `Vary: Cookie` and `Vary: Authorization`. `tests/service-worker.test.ts` covers those cases. The built `dist/sw.js` contains the change; it has not been deployed.
**Classification:** Limited change, landed before Phase 2.

### MP-06 — The deployed shell had no security headers and a wildcard CORS header

**Severity:** High before accounts; Medium today
**Evidence at audit time:** Passive inspection of <https://moderncombinedarms.pages.dev> showed `X-Content-Type-Options` and `Referrer-Policy`, but no CSP, HSTS, frame protection or Permissions-Policy, and `Access-Control-Allow-Origin: *`. `public/_headers` only set the manifest MIME type and `sw.js` revalidation.
**Impact:** Any future XSS has no CSP containment. Session cookies and room actions could be framed or embedded by another site. A wildcard CORS policy on API responses would let any origin read public or, worse, authenticated data if credentials were ever allowed. The current static site has no accounts, so this is not an immediate account compromise; it becomes High the moment sessions exist.
**Required fix:** Add a Pages `_headers` policy before the API ships:
- `Content-Security-Policy` with `default-src 'self'`, `script-src 'self'` after moving the boot script out of inline HTML, `style-src 'self' 'unsafe-inline'` only while inline styles remain, `img-src 'self' data: blob:`, `media-src 'self' blob:`, `connect-src 'self' wss://moderncombinedarms.pages.dev`, `frame-ancestors 'none'`, `base-uri 'none'`, `object-src 'none'`, `form-action 'self'`;
- `Strict-Transport-Security: max-age=31536000` (no `includeSubDomains` until every subdomain is HTTPS-only);
- `X-Frame-Options: DENY` for older browsers;
- `Permissions-Policy: geolocation=(), camera=(), microphone=()`;
- `/api/*`: `Cache-Control: no-store`, `Vary: Cookie`, and no wildcard CORS.
Do not add `Cross-Origin-Embedder-Policy` casually; it can break media and workers.
**Remediation (2026-10-29):** the static-shell policy is in `public/_headers`, and the boot path has no inline handler that `script-src 'self'` would block. `tests/security-headers.test.ts` covers the directives. The policy is in the built `dist/_headers` but is not deployed. API responses still need the Function to emit `/api/*` headers; the platform's wildcard CORS on public static assets must not be inherited by the Function.
**Classification:** Limited configuration change, high value. Static shell done; API headers remain part of Phase 2.

### MP-07 — Save and scenario parsing are not a hostile-input boundary

**Severity:** High if saves or maps are ever shared; Medium today
**Evidence:** `parseScenario` is relatively strict: it checks format/version, 16-256 dimensions, exact tile count, known terrain/faction/building/unit ids and full hex colours (`src/sim/scenario.ts:190-338`). `Game.fromSave` is looser: after checking `format`, version, arrays, content ids and faction ids, it casts the rest of `state` and normalises only a few numeric fields (`src/sim/game.ts:5147-5220`). `migrateSave` treats missing values as defaults.
**Impact:** A crafted save could contain negative or non-finite positions, huge arrays, impossible owner ids, inconsistent fog/map lengths or a `localPlayerId` that claims another seat. That is tolerable for a local file the user chose; it is not tolerable for a file received from another player or a room host.
**Required fix:** Do not accept saves over the network. If map sharing is added later, parse on the server with `parseScenario` plus `validateScenario`, cap the request body and tile count, and reject unknown fields. If replay files are shared, give them their own schema and validate every numeric field; never feed a shared save into `Game.fromSave` on a client with authority.
**Classification:** Limited for maps; Architectural for shared saves.

### MP-08 — Victory is computed from one local perspective

**Severity:** High for correctness; not an exploit by itself
**Evidence:** `Game.evaluateVictory` reads `this.localPlayerId` and `finish` marks only that perspective's enemies defeated (`src/sim/game.ts:4931-4985`). `Game.fromSave` restores `localPlayerId` from the save (`src/sim/game.ts:5183`).
**Impact:** A room running one `Game` cannot use the single-player finish path for every seat. Player 2 can be shown "victory" because player 1's local perspective won, or the room can end with the wrong losing side. A save-derived `localPlayerId` must never be trusted online.
**Required fix:** Add a neutral `MatchResult` evaluation over all players/teams (HQ destroyed, annihilation, time limit, draw). The server broadcasts the result; each client maps it to its own seat for the existing victory/defeat UI. Do not restore `localPlayerId` from a network snapshot.
**Classification:** Limited change to the rules core, with a new server wrapper.

### MP-09 — Fog and teams are fixed at two

**Severity:** Medium
**Evidence:** `MAX_TEAMS = 2` (`src/sim/constants.ts`); `refreshVision` loops `team < 2`; `state.fog` is created as `[0, 1]`; `evaluateVictory` assumes hostile teams. Players can share a team, so 2v2 works, but there is no third team.
**Impact:** The initial requirements do not demand free-for-all, but "available slots" and public rooms can create an expectation of more than 1v1. A 3-team or FFA mode would silently miscompute vision and results.
**Required fix:** Scope the first release explicitly to **two teams, up to four players (1v1 or 2v2)**. If FFA is wanted, generalise `MAX_TEAMS`, fog arrays, team colour masks and result evaluation in a separate phase with tests. Do not fake a third team with player ids.
**Classification:** Ready for 1v1/2v2; Architectural for FFA.

### MP-10 — There is no reconnect, snapshot or anti-desync protocol

**Severity:** Medium
**Evidence:** The only state transfer format is `toSave`/`fromSave`, which includes the whole scenario and both teams. The renderer and HUD take a `Game` directly (`renderer.setGame`, `hud.mount`), and `App` assumes one local `Game` that ticks.
**Impact:** A dropped socket currently has no way to rejoin a room, and a naive full-save-per-tick design would be hundreds of kilobytes per client per second. Reconnect after a long match would either leak hidden state or lose the match.
**Required fix:** Define a room snapshot distinct from a save:
- server-only full snapshot persisted every 5-10 s and on key events;
- per-client delta/full projected snapshot at 10 Hz;
- `welcome` carries static map, room metadata, seat and protocol version;
- reconnect sends a fresh full projection, not a save;
- client interpolates between snapshots with a ~100 ms buffer;
- WebSocket ordering is reliable, so no per-snapshot ack is needed; commands carry a sequence and receive an ack/error event;
- if a client's send buffer grows beyond a threshold, skip deltas and send a fresh full projection when it drains.
**Classification:** Architectural, but contained to the new network layer and a replica view.

### MP-11 — Room discovery needs abuse and privacy rules

**Severity:** Medium
**Evidence:** No room table, code, invite or directory exists. Public room names and display names would be user-controlled and rendered into the existing `innerHTML`-heavy UI; existing authored text is escaped, but new fields must be treated as untrusted.
**Impact:** Public rooms can be used for spam, impersonation, harassment or enumeration. A short room code without rate limiting can be brute-forced. A private room id in a URL can leak through Referer or logs.
**Required fix:**
- Public rooms: name ≤ 40 graphemes, normalise Unicode, strip control characters, render with `textContent`/`escapeHtml`, no HTML.
- Private rooms: never returned by the directory; 10-character Crockford base32 code (≈50 bits) stored only as an HMAC/hash; generic failure for wrong code/room; 10 attempts/minute/session and per-IP gate.
- Invite links: 32-byte random token, hashed at rest, expiry ≤ 24 h or room close; put the token in the URL **fragment** (`#/join/<token>`) so it is not sent in the HTTP request or Referer; the client posts it to the API.
- Rate-limit room creation and joins; cap rooms per session; no global chat in the first release.
- Do not expose account ids, emails, IPs or raw host ids in the directory.
**Classification:** New subsystem; straightforward once the directory exists.

### MP-12 — Guest and account privacy need deliberate data minimisation

**Severity:** Medium
**Evidence:** No accounts exist. The current game stores saves, settings and campaign progress in localStorage. The audit's stated concerns include GDPR/data minimisation for future optional accounts and guest identifiers.
**Impact:** A guest identifier is pseudonymous personal data. Collecting emails, raw IPs, precise location or analytics by default would create retention and consent obligations that are unnecessary for the feature.
**Required fix:**
- Guest: random 256-bit opaque session token in a `__Host-` cookie; store only its hash server-side. Display name is profile data, never an identity.
- Account: OAuth subject + display name + timestamps. Do not request email unless a feature needs it. No passwords, no password reset, no email sending in the first release.
- Do not store raw IPs. If abuse limiting needs an IP signal, store a keyed hash with a short TTL and a rotating secret.
- Publish a short privacy notice, a delete-account path and a retention period (suggest 30 days for finished-room metadata, 24 h for invite tokens).
- Single-player localStorage remains local and is not uploaded by default. Accounts provide identity across devices, not automatic save sync in Phase 4.
**Classification:** New subsystem / policy.

### MP-13 — Elevation is capped at 4 by the scenario parser but 8 by the editor

**Severity:** Medium (current bug, not multiplayer-specific)
**Evidence:** `parseScenario` reads elevation with `asNumber(t.e, ..., 0, 4)` at `src/sim/scenario.ts:206`. `MAX_ELEVATION = 8` at `src/sim/constants.ts:29`; the editor raises/lowers to `MAX_ELEVATION` at `src/ui/editor.ts:957`; `tests/terrain-props.test.ts` asserts the 8-level ceiling.
**Impact:** A map authored with elevation 5-8 cannot be round-tripped through `parseScenario`. `cloneScenario` calls `parseScenario`, and `App.startBattle` clones the selected scenario, so a high-relief map can fail to load or fail to start. This is directly relevant to the recent terrain work and to any future map-sharing feature.
**Required fix:** Make the parser's elevation bound use `MAX_ELEVATION` (and keep it aligned with the renderer's height), add a round-trip test at the maximum, and confirm the editor's save/load path. Do not fix it in this read-only audit; schedule it as a small independent bug fix before map sharing or multiplayer map selection.
**Classification:** Limited, independent of networking.

### MP-14 — There is no build/protocol handshake

**Severity:** Medium
**Evidence:** `vite.config.ts` compiles version, stage, build number and commit into the client. `src/version.ts` formats them. There is no server handshake because there is no server.
**Impact:** A server iterating on sim rules and a stale client can disagree about content ids, command shapes or snapshot fields. A room started on one build can be resumed by another and diverge or crash.
**Required fix:** Every room records `gameVersion`, `build`, `commit` and `protocolVersion`. The WebSocket `hello`/`welcome` rejects incompatible clients with a clear "reload" message. Do not auto-upgrade a live room across a rules change; finish or close it. The existing build stamp is the right source of truth.
**Classification:** Limited.

---

## 6. Zero-cost hosting architecture

### 6.1 Shape

```
Browser (same origin: https://moderncombinedarms.pages.dev)
│
├─ Static shell, audio, icons, service worker          Pages static assets (free, unlimited requests)
│
├─ POST /api/session/*, /api/rooms/*, /api/oauth/*     Pages Function (thin same-origin API/proxy)
│       │
│       └─ service binding / fetch
│
├─ GET  /api/rooms?…                                  D1 directory (public rows only)
│
└─ WS   /api/rooms/:id/socket                         GameRoom Durable Object (one per room)
        ├─ authoritative Game (20 Hz, existing rules)
        ├─ per-team projection (10 Hz snapshots)
        ├─ SQLite room snapshot (every 5–10 s / key events)
        └─ no AI state, no hidden entities, no raw saves to clients
```

**Why a Durable Object per room:** it provides a single-threaded coordination
point for one match, strong consistency for seats and commands, WebSocket
support, and SQLite persistence across eviction. It is exactly the coordination
atom the platform is designed for. A single global object would bottleneck every
room; a stateless Worker cannot own a match.

**Why not peer relay or lockstep:** a relayed command stream still requires every
client to simulate the full world to render it, which gives every client the
enemy state and the AI state. Lockstep also makes one modified client a
desync/cheat source. Server-authoritative snapshots cost more engineering but
are the only design that matches the stated requirement "never treat a
client-supplied identity as authenticated".

**Why not WebRTC data channels initially:** host advantage, NAT traversal,
reconnection complexity and the same authority problem. They are a possible
later transport optimisation, not the first release.

### 6.2 Cloudflare components and current free limits

Facts below are from Cloudflare's published docs retrieved 2026-10-29. Limits can
change; treat them as a current operating budget, not a contract.

| Component | Free-plan allowance (published) | Use in MCA | Exhaustion behaviour |
|---|---|---|---|
| Pages static assets | Unlimited requests; 500 builds/month; 20,000 files; 25 MiB/file | Game shell, audio, icons, offline cache | Static site keeps serving; a new deploy may be blocked by build limits |
| Pages Functions | Counts as Workers requests: **100,000/day**, 10 ms CPU/request, 128 MB | Session, room directory, OAuth callback, WS upgrade proxy | 429/1027-style failure; client disables online and keeps single-player |
| Workers | 100,000 requests/day; 10 ms CPU/HTTP request; 50 subrequests | API Worker if used instead of Pages Functions | Error 1027; no charge on Free |
| Durable Objects (SQLite) | **100,000 requests/day**, **13,000 GB-s/day**, **5 GB storage/account**, 128 MB/object; 30 s CPU/request (DO limits), 15 min alarm wall time | One object per active room; lobby metadata; snapshot | DO operations fail; room closes with a capacity message; no charge on Free |
| D1 | **5,000,000 rows read/day**, **100,000 rows written/day**, **5 GB** | Users, sessions, public room directory, memberships | D1 queries fail; directory/auth unavailable; multiplayer disabled |
| R2 (optional) | 10 GB-month, 1M Class A, 10M Class B, free egress | Not needed for v1; optional replays/avatars later | Not in the critical path |
| OAuth provider | Free authorization-code flow | Optional account login | Login unavailable; guests still play |

The Durable Object duration math is the important one:

```
13,000 GB-s/day ÷ 0.128 GB per active object = 101,562 object-seconds/day
101,562 s ÷ 3,600 = 28.2 active object-hours/day
28.2 h ÷ 0.75 h (45-minute cap) ≈ 37 full matches/day
28.2 h ÷ 0.5 h (30-minute match) ≈ 56 matches/day
```

For a 4-player, 30-minute match, one room uses about **230 GB-s** of the daily
13,000 GB-s. The request budget is separate: four socket connections plus
commands. At one command per player per second for 30 minutes, that is about
7,200 incoming messages per match, which is why command batching and a per-seat
rate limit matter. Outgoing snapshots are not billed as incoming requests, but
they are not free bandwidth on the client; use deltas and a 10 Hz snapshot rate,
not a full save at 20 Hz.

### 6.3 Hard capacity policy (fail closed, never bill)

The app cannot read its own exact remaining free quota reliably enough to run
right up to the edge. Use conservative server-side gates:

- **Room cap:** at most 8 active rooms at once on the initial deployment; this
  keeps one bad day from consuming the whole object-duration allowance.
- **Match cap:** 45 minutes per online match (or the scenario's own time limit,
  whichever is shorter). The room broadcasts a 2-minute warning, then ends as a
  draw/points result rather than being killed mid-tick.
- **Daily budget:** a tiny `Capacity` Durable Object (one per UTC day, not per
  room) tracks started match-minutes against a 24 object-hour budget, leaving
  ~4 hours of headroom for lobby/reconnect overhead. It rejects new rooms with
  `503 capacity` once the budget is reserved.
- **Directory cache:** public room list responses may be cached for 5 seconds at
  the edge; never cache personalized responses.
- **Command batching:** client sends at most one batch per 100 ms; server rate
  limits per seat. This reduces both DO requests and CPU.
- **No automatic paid fallback:** if a binding returns a quota error, mark the
  deployment `online: unavailable`, stop new rooms, keep the static shell and
  single-player working, and show a retry time. Never attach a paid plan or a
  payment method as part of this design.

### 6.4 Why this is "sustainable $0" and where that claim stops

This is a genuinely free configuration at hobby scale because:

- static Pages requests are free and unlimited;
- the API and room layer fit inside the Workers/DO/D1 free allocations for a
  small number of concurrent matches;
- no paid database, email, SMS, auth, analytics or storage service is required;
- OAuth and Cloudflare TLS cost nothing;
- the free plan fails requests instead of silently charging overages.

It is **not** a guarantee of unlimited free hosting:

- Cloudflare can change free limits, deprecate a free-tier feature or require a
  paid plan for a new capability. If Durable Objects stop being available on
  Free, multiplayer must be disabled until the owner chooses to pay; the design
  must not auto-upgrade.
- There is no SLA on the Free plan.
- The active-room ceiling is real: roughly 28 object-hours/day, not "infinite
  rooms because serverless".
- A custom domain costs money; the `pages.dev` hostname does not.

### 6.5 Alternatives considered

| Option | Free-tier reality | Why it is not the primary choice |
|---|---|---|
| **Cloudflare Workers + Durable Objects + D1 + Pages** | Current free allowances above; SQLite DOs, WebSockets, D1, static assets | Chosen: same vendor as the existing deployment, same origin, durable per-room state, no egress bill, fail-closed quotas |
| **Supabase Realtime / Edge Functions** | Free: 200 peak realtime connections, 2M messages/month, 500 MB DB, 5 GB egress, 500k Edge Function invocations; free projects pause after 1 week of inactivity | No long-lived server-authoritative game loop; projects pause when idle; adds a second platform and a second identity/session surface. Useful only if the room state lived in Postgres and the simulation moved elsewhere, which defeats the purpose. |
| **Deno Deploy** | Free: 1M requests/month, 10 h active CPU, 20 GiB egress, 150 GiB-hr memory; apps scale to zero after ~20–30 s | No durable per-room object storage or strong coordination primitive; a long-running authoritative room consumes the 10 h CPU budget quickly and loses in-memory state on scale-to-zero. |
| **Firebase Realtime Database / Functions** | Spark has simultaneous-connection and storage limits; Cloud Functions for Firebase generally requires the Blaze pay-as-you-go plan | The $0 requirement is not compatible with the server-compute path, and client SDK authority/rules are not a substitute for a deterministic game loop. |
| **PartyKit / hosted room platforms** | Availability and pricing have changed; not a stable long-term free assumption | Avoid a dependency whose free tier or product lifecycle is uncertain. A Durable Object is the same primitive without the extra vendor. |

The comparison is deliberately conservative: a service is only "free" here if it
has a published $0 path, no mandatory card, and a failure mode that does not
silently bill.

### 6.6 Deployment shape and release changes

Pages cannot create or deploy a Durable Object inside a Pages project. The
recommended shape is:

1. **Pages project** `moderncombinedarms` keeps serving `dist/` exactly as today.
2. Add `functions/api/[[path]].ts` as a thin same-origin proxy. It forwards to
   the room Worker through a service binding (or calls the DO binding directly
   for the socket route). It does not contain game rules.
3. A **separate Worker** `mca-rooms` exports `GameRoom` (and `Capacity`), built
   with Wrangler and deployed independently. Bind it to the Pages project in the
   dashboard or Pages Wrangler config.
4. Bind **D1** `MCA_DIRECTORY` to both the Pages Function and the room Worker.
   The room Worker owns writes for room status; the Function owns auth and
   directory reads.
5. Set secrets with `wrangler secret put` / Pages environment settings:
   `SESSION_PEPPER`, `OAUTH_CLIENT_SECRET`, `INVITE_PEPPER`, and the OAuth client
   id. Never put a secret in `src/`, `index.html`, `dist/` or a client bundle.
6. Extend `tools/release.mjs` to deploy the room Worker first, then the Pages
   build with Functions, then verify both the static bundle and `/api/health`.
   The current release script only uploads `dist/` and verifies the HTML bundle;
   it would silently ship a client that expects a room API that does not exist.

**Stage 0 gate:** Pages Functions must prove that a WebSocket upgrade can be
proxied to a Durable Object with the cookie and `Origin` intact, and that the
101 response reaches the browser. If that cannot be made reliable, fall back to
a single Worker with static assets on a new `workers.dev` hostname (or a custom
domain, which is not free). Do not discover this after building the lobby.

---

## 7. Data model

### 7.1 D1 (directory and identity)

The exact migration belongs in the implementation phase; this is the shape the
queries and retention rules assume.

```sql
-- A person is a guest or an account. No email required.
CREATE TABLE users (
  id            TEXT PRIMARY KEY,          -- random UUID/ULID
  kind          TEXT NOT NULL CHECK (kind IN ('guest','account')),
  display_name  TEXT NOT NULL,
  provider      TEXT,                      -- 'discord' for accounts
  provider_sub  TEXT,                      -- provider subject, never a client id
  created_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  UNIQUE (provider, provider_sub)
);

-- Opaque session token; only the SHA-256 hash is stored.
CREATE TABLE sessions (
  token_hash    BLOB PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL,
  last_seen_at  INTEGER NOT NULL,
  revoked_at    INTEGER
);

-- One-time OAuth state (state + PKCE verifier hash), short TTL.
CREATE TABLE oauth_states (
  state_hash    BLOB PRIMARY KEY,
  guest_user_id TEXT,
  verifier_hash BLOB NOT NULL,
  created_at    INTEGER NOT NULL,
  expires_at    INTEGER NOT NULL
);

-- Public directory facts only. Private rooms are rows here but never listed.
CREATE TABLE rooms (
  id             TEXT PRIMARY KEY,
  host_user_id   TEXT NOT NULL REFERENCES users(id),
  name           TEXT NOT NULL,
  visibility     TEXT NOT NULL CHECK (visibility IN ('public','private')),
  join_code_hash BLOB,                     -- NULL for public
  map_id         TEXT NOT NULL,
  mode           TEXT NOT NULL,            -- '1v1' | '2v2'
  max_players    INTEGER NOT NULL,
  player_count   INTEGER NOT NULL,
  status         TEXT NOT NULL,            -- 'lobby' | 'in_progress' | 'finished'
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  expires_at     INTEGER NOT NULL
);
CREATE INDEX rooms_public ON rooms(status, visibility, updated_at);

CREATE TABLE room_members (
  room_id   TEXT NOT NULL REFERENCES rooms(id),
  user_id   TEXT NOT NULL REFERENCES users(id),
  seat      INTEGER NOT NULL,
  team      INTEGER NOT NULL,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, user_id),
  UNIQUE (room_id, seat)
);

CREATE TABLE room_invites (
  token_hash BLOB PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

Directory query (indexed, ≤ 50 rows):

```sql
SELECT id, name, map_id, mode, player_count, max_players, status, updated_at
FROM rooms
WHERE visibility = 'public'
  AND status IN ('lobby','in_progress')
  AND expires_at > ?
ORDER BY created_at DESC
LIMIT 50;
```

No query returns `join_code_hash`, `host_user_id`, provider subject, session
hash or invite hash to a browser.

### 7.2 Durable Object storage

One SQLite-backed object per room, keyed by `idFromName(roomId)`:

- `room` — room id, map id, mode, seats, host, visibility, build/protocol,
  created/expires, result.
- `snapshot` — last authoritative `Game` state (server format, not a client
  save), tick, RNG state, event sequence, saved_at.
- `seats` — seat, user id, display name, team, ready, connected, joined_at.
- `invite` — optional hashed invite metadata if the DO owns invite expiry.

Persist a snapshot every 5–10 seconds and on lobby/seat/result changes. A
`toSave()` payload is ~308 KiB for 163 entities; 56 matches/day with one-day
retention is trivial against 5 GB, but do not write it every tick.

---

## 8. Protocol and authority design

### 8.1 HTTP surface

All routes are same-origin on `moderncombinedarms.pages.dev`.

| Method | Route | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/health` | none | `{ok, build, online, capacity}` for release verification |
| `GET` | `/api/session` | optional cookie | Current public profile or `401` |
| `POST` | `/api/session/guest` | none | Create a guest session only if no valid cookie; sets `__Host-` cookie |
| `GET` | `/api/auth/:provider/start` | optional guest cookie | OAuth redirect with state + PKCE |
| `GET` | `/api/auth/:provider/callback` | state cookie | Verify, link/merge, issue account session |
| `POST` | `/api/session/logout` | session | Revoke session, clear cookie |
| `GET` | `/api/rooms` | none | Public directory, no private rows |
| `POST` | `/api/rooms` | session | Create public/private room; rate-limited |
| `GET` | `/api/rooms/:id` | optional | Public summary; private requires membership/invite |
| `POST` | `/api/rooms/:id/join` | session | Join lobby by id (public) or code/token (private) |
| `POST` | `/api/rooms/:id/start` | host | Start when seats are ready |
| `POST` | `/api/rooms/:id/leave` | session | Leave lobby or abandon match |
| `POST` | `/api/rooms/:id/invite` | host | Mint private invite token (returned once) |
| `GET` | `/api/rooms/:id/socket` | session + membership | WebSocket upgrade, proxied to the room DO |

Cookie rules:

```
Set-Cookie: __Host-mca_session=<opaque>; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=...
```

- `Secure`, `HttpOnly`, `SameSite=Lax`, no `Domain`, `Path=/` — the `__Host-`
  prefix enforces this.
- Session token: 32 random bytes from `crypto.getRandomValues`; store only
  SHA-256(token) in D1. Rotate on login and privilege change.
- Mutations require `Origin` exactly equal to the deployment origin (and the
  optional custom domain when configured). Reject `null`, `*` and unknown
  origins. `SameSite=Lax` is defence in depth, not the only check.
- WebSocket handshakes are not protected by SameSite in the same way; validate
  `Origin`, the session cookie and room membership before accepting.

### 8.2 WebSocket messages

Use a versioned envelope. Start with compact JSON for the lobby and a binary
entity/projectile payload for match snapshots; JSON-only snapshots are a
development fallback, not the launch format.

Client → server:

```json
{ "v": 1, "type": "hello", "protocol": 1, "build": "0.1.2+132ccc8", "lastTick": 0 }
{ "v": 1, "type": "command", "seq": 17, "cmd": { "type": "move", "ids": [12,13], "x": 960, "z": 720, "attackMove": true } }
{ "v": 1, "type": "ready", "ready": true }
{ "v": 1, "type": "leave" }
```

Server → client:

```json
{ "v": 1, "type": "welcome", "seat": 1, "playerId": 3, "team": 0, "tickRate": 20, "snapshotRate": 10, "map": { ... }, "room": { ... } }
{ "v": 1, "type": "commandAck", "seq": 17, "tick": 842 }
{ "v": 1, "type": "error", "seq": 17, "code": "not_visible", "message": "Target is not known to your force." }
{ "v": 1, "type": "matchEnd", "winnerTeam": 0, "reason": "hq", "stats": { ... } }
```

Snapshot envelope (header JSON, arrays binary):

```
tick, serverTime, victory, players (public/own resources), fogDelta,
entities[], removedIds[], projectiles[], events[]
```

Rules:

- The client never sends `playerId`, `team`, `owner`, `localPlayerId`, fog,
  resources or a result. If those fields appear, drop the message.
- Server maps the socket → seat → player id. `Game.enqueueCommand` receives the
  rewritten owner. The client's `seq` is echoed; it is not an authority token.
- Commands execute on the next server tick after validation; no rollback in v1.
  The client shows an immediate order marker for responsiveness, but unit
  movement waits for the snapshot.
- Snapshots at 10 Hz; the client renders ~100 ms behind the newest snapshot and
  interpolates positions/facings. Do not run the client `Game.tick()` on
  authoritative state.
- Own and allied entities are always included. Enemy entities are included only
  while visible. Remembered structures carry `remembered: true` and last-known
  hp, never live hp. Projectiles follow the same visibility rule as the current
  `projectileVisibleToLocal`.
- Events are filtered with a team-aware version of `eventVisibleToLocal`.
  Hidden enemy fire, hidden unit voices and hidden battle audio must not be sent.
- No AI state, enemy resource totals, enemy production queues, enemy contacts,
  full fog arrays or original scenario units/structures cross the boundary.

### 8.3 Command validation checklist

- [ ] Session valid, not revoked, not expired.
- [ ] User is a current member of this room and holds this seat.
- [ ] Room is `in_progress`; acting player is not defeated/abandoned.
- [ ] `v` and command shape match the allowlist; no extra keys.
- [ ] Payload ≤ 4 KiB; `ids` length ≤ 48; ids are integers and unique.
- [ ] Every id belongs to the seat's player id (not merely the team).
- [ ] `x`/`z` finite and inside map bounds; tile coordinates integral where
      required.
- [ ] `targetId` exists; hostile targets are visible or charted for that team;
      own/allied/neutral targets obey the existing rule.
- [ ] `defId` is a known unit/building; `produce` targets an owned, completed
      facility that lists it; `placeBuilding` targets an owned engineer and a
      legal, affordable site; `setRally` targets an owned building and legal
      ground/water.
- [ ] Rate limit: ≤ 20 messages/s and ≤ 60 burst per seat; ≤ 1 batch/100 ms.
- [ ] After `matchEnd`, reject all commands except `leave`.

### 8.4 Reconnect and disconnect

- Lobby: a disconnected seat is held for 60 s, then freed. The host transfers
  to the next connected seat if the host disconnects.
- Match: a disconnected seat is held for 90 s. On reconnect, the full projected
  snapshot restores the view. If the grace expires, the seat is marked
  `abandoned` and its player is defeated; units remain in the world but receive
  no new orders. Do not silently replace a human with AI in v1.
- If every seat disconnects, stop the tick loop, persist, and close the room
  after the grace period. Do not keep an empty room burning object duration.
- A room is not joinable in progress in v1; reconnect is allowed only for the
  existing seat. Public rooms may show `in_progress` but the join button is
  disabled.

### 8.5 Pause, speed and time

- Online: fixed 1× speed; no pause. The single-player pause/speed controls stay
  local to `App` and must be disabled for an online room.
- The server clock is the only clock. `Game.state.tick` is authoritative;
  `startedAtTick` drives the scenario time limit; server wall time is used only
  for room expiry, snapshot cadence and graceful shutdown.
- The existing 20 Hz fixed step and `advance()` batch invariance are correct
  foundations. Do not introduce variable-dt movement for networking.

---

## 9. Accounts, guests and room discovery flows

### 9.1 Guest first

1. On opening the multiplayer view, the client calls `GET /api/session`.
2. If `401`, it calls `POST /api/session/guest`. The server creates a `users`
   row with `kind='guest'`, a random display name (editable later), a 256-bit
   session token and an HttpOnly cookie.
3. The client can browse public rooms without a session; joining or creating a
   room requires one. Registration is never required.
4. Guest sessions expire after 30 days of inactivity; the user row is deleted
   after 30 days unless linked to an account or referenced by a live room.
5. A guest display name is profile data. The server never accepts it as a user
   id, and two guests may share a name; the seat is keyed by user id.

### 9.2 Optional account and upgrade

1. The user chooses "Link account"; the client calls
   `GET /api/auth/discord/start`.
2. The server creates a random `state`, stores its hash plus the PKCE verifier
   hash and the current guest user id in `oauth_states`, sets a short-lived
   HttpOnly state cookie, and redirects to the provider with `state` and PKCE.
3. The callback validates state, PKCE, issuer and code, then reads the provider
   subject. It never trusts a display name or user id from the query.
4. If the provider subject already has an account, the guest is linked to it
   through an alias (`user_aliases.guest_id -> account_id`) and the guest
   session is revoked. If not, the existing guest row is upgraded to
   `kind='account'` and the provider columns are set.
5. Issue a new account session, rotate the cookie, and tell the room DO to
   rebind the current seat to the canonical account id. If the user is in a live
   match, the socket stays open and the seat is not lost; if the rebind cannot
   be completed, the seat remains valid until reconnect and is reconciled then.
6. Single-player saves and campaign progress remain in localStorage. Account
   linking provides identity and multiplayer access; cloud save sync is a
   separate feature and is explicitly not part of Phase 4.

### 9.3 Public room

1. Host creates a room with name, map, mode (`1v1`/`2v2`) and `visibility=public`.
2. The API generates a room id, inserts the D1 directory row, and asks the DO to
   create the lobby.
3. The room appears in `GET /api/rooms` with map, mode, `player_count/max` and
   `lobby` status. No host id, IP or account data is exposed.
4. A guest joins by room id; the DO assigns the next free seat and team. The
   directory row is updated best-effort; the DO is authoritative if the row is
   stale.
5. The host starts when at least two seats are filled and all connected seats
   are ready. Empty seats are not filled with AI in v1.
6. The room leaves the public directory when it starts (`in_progress` is still
   visible for status but not joinable) or closes.

### 9.4 Private room

1. Host creates `visibility=private`; the API generates a 10-character code and
   stores only `HMAC-SHA256(code, INVITE_PEPPER)` in D1/DO.
2. The code is shown once to the host. The host can mint an invite link with a
   32-byte token; only its hash is stored, with a 24-hour expiry or room close.
3. The link is `https://moderncombinedarms.pages.dev/#/join/<token>`. The token
   is in the fragment, so it is not sent in the request, Referer or server logs.
4. The client reads the fragment, clears it from the address bar if possible,
   and posts the token to `/api/rooms/:id/join` (or a token-resolve endpoint).
5. Wrong code/token, closed room, full room and expired invite all return the
   same generic failure. Rate-limit attempts; do not reveal whether a room id
   exists.
6. A private room never appears in `GET /api/rooms`; it can be joined only by a
   valid code or invite.

### 9.5 Out of scope for the first release

Ranked matchmaking, skill/ELO, global chat, leaderboards, friends lists,
cross-room parties, spectators, custom map uploads, join-in-progress, AI filling
empty online seats, and cloud save sync. Say "no" explicitly in the UI rather
than leaving dead buttons.

---

## 10. Staged implementation plan

Each phase is a shippable, feature-flagged slice. Do not start the next phase
until the previous exit criteria pass. No phase changes single-player rules.

### Phase 0 — Workerd spike and measured budget

**Goal:** prove the platform before building product.

- Build a minimal `GameRoom` Worker with the existing `Game` imported, a
  four-client WebSocket loop and a projection stub.
- Run under `wrangler dev`/workerd with the same compatibility date, 20 Hz tick,
  10 Hz snapshot cadence, 163 entities and four clients.
- Measure CPU per tick, snapshot serialization cost, outbound bytes/client and
  object duration over a 30-minute soak. Confirm Pages Function → DO WebSocket
  upgrade, cookie and `Origin` preservation.
- Measure the actual free-plan request accounting for WebSocket messages; use
  the conservative actual-message count if the 20:1 billing ratio is ambiguous.

**Exit:** a 30-minute, four-client room stays within the projected 13,000 GB-s
and 100,000 request daily budgets at the intended concurrency, and the
Pages-proxy WebSocket path is proven. If it is not, fall back to the single
Worker/static-assets hosting shape before writing the lobby.

### Phase 1 — Server-safe core and command gate

- Add a server build target for the existing simulation; keep `Game` free of DOM
  and network imports.
- Add `CommandGate` + schema validation and unit tests for spoofed owners,
  oversized ids, out-of-bounds coordinates, hidden targets and rate limits.
- Add `projectForTeam` with a leak test that searches the serialized payload for
  every hidden enemy id, coordinate, AI target and enemy resource value.
- Add neutral `MatchResult` evaluation; leave single-player `evaluateVictory`
  unchanged.
- Add a server room snapshot format separate from `toSave`; test restore and
  determinism against the same tick/command sequence.

**Exit:** no source rule changes; all existing tests pass; new tests prove a
client cannot command another seat and cannot see a hidden entity.

### Phase 2 — Guest rooms, public/private directory, lobby

- D1 schema/migrations; guest sessions; OAuth configuration stub.
- Pages Function API and D1 directory; public listing, private code/invite.
- `GameRoom` lobby state, seats, readiness, host transfer, start.
- Menu/lobby UI in the existing sidebar-plus-content style; online feature flag.
- Service worker bypass for `/api/*`; one `_headers` policy; no wildcard CORS.
- Room creation/join rate limits and generic errors.

**Exit:** two guests can create/join a private room and a public room from two
browsers, see slots/status, and start a lobby. No match simulation is exposed
yet. A wrong code, full room and stale directory row behave correctly.

### Phase 3 — Authoritative match and reconnect

- Run `Game.tick()` in the DO; client receives projected snapshots and renders
  through a read-only `Game` replica.
- Add the command sink; online commands go to the socket, single-player commands
  still go to `enqueueCommand`.
- Add snapshot batching, interpolation, reconnect, disconnect grace, match
  result and the existing victory/defeat UI.
- Disable pause/speed online; fixed 1×.
- Add the capacity guard and 45-minute cap.

**Exit:** a full 1v1 and a 2v2 match complete on two/four browsers; reconnect
restores the same tick and seat; a hidden enemy id never appears in a client
payload; a 30-minute soak stays under budget; single-player still works with the
API blocked.

### Phase 4 — Optional accounts and linking

- OAuth authorization-code + PKCE, one provider; no email/password.
- Guest → account upgrade, alias merge, session rotation, seat rebind.
- Account deletion and retention job.
- Privacy notice and data-minimisation review.

**Exit:** a guest can upgrade mid-lobby or mid-match without losing the seat;
the same account sees the same identity on a second browser; deleting the
account removes sessions/aliases and closes hosted rooms. Single-player saves
remain local and untouched.

### Phase 5 — Hardening, operations and launch

- CSP/HSTS/frame/Permissions-Policy; API `no-store`; security-header regression
  test.
- Rate limits, abuse reporting, public-room moderation tools (close/kick before
  start), log redaction.
- Structured logs with request ids; no PII; health endpoint; quota/capacity
  alarms.
- Release script deploys the room Worker, Pages Functions and static bundle, and
  verifies both.
- Load test at the room cap; failure drill: D1 down, DO quota error, OAuth down,
  service worker offline.
- Update `README.md`, `CHANGELOG.md` and the in-game multiplayer copy only when
  the feature is actually available.

**Exit:** launch checklist complete; a documented rollback disables the online
feature flag while leaving static single-player intact.

---

## 11. Verification plan

### Existing checks that remain relevant

- `npm test` — 761 tests/69 files at audit time; determinism, save round-trip,
  fog integrity, construction, combat, AI, presentation.
- `npx tsc --noEmit` — clean.
- `tests/perf.test.ts` — 0.230 ms/tick baseline; 5.371 ms/tick at 163 entities;
  save 5.0/10.0 ms, 308 KiB.
- `tests/determinism-save.test.ts` — identical hashes for identical seeds and
  commands, batch-size invariance, save/load continuation.
- `tests/fog-integrity.test.ts` — unseen structures cannot steer AI, contacts are
  sightings not maps, team vision is shared only within a team.

### New tests required before launch

| Test | What it must prove |
|---|---|
| Command authorization | A seat cannot command another player's ids, spoof `team`, target a hidden entity, exceed id/count/rate limits or act after match end. |
| Projection leak | Serialize a snapshot for team 0 and assert no hidden enemy id, coordinate, AI target, enemy resource, enemy queue, full fog array or original scenario unit/structure appears. Do this for both teams and for a remembered-only structure. |
| Reconnect determinism | Disconnect/reconnect at tick N; the restored server state hash and the next 200 ticks match an uninterrupted room. |
| Result neutrality | 2v2 victory/defeat/draw is correct for every seat; no local-perspective `finish` leaks into another seat. |
| Directory privacy | Private rooms and invite/code hashes never appear in public responses; wrong code/room/full/expired are indistinguishable. |
| Session/CSRF | Cross-origin POST/WS is rejected; missing/revoked/expired sessions are rejected; cookies are `__Host-`, HttpOnly, Secure, SameSite=Lax; logout invalidates. |
| Service worker | `/api/*`, `Set-Cookie`, `Authorization` and `no-store` responses are never cached; offline navigation still serves the shell. |
| Headers | CSP/HSTS/frame/Permissions-Policy present on HTML; `/api/*` is `no-store`, no wildcard CORS. |
| Capacity/quota | At the configured room/minute cap, new rooms return 503 and no paid fallback is attempted; existing rooms finish or close gracefully. |
| Slow client | A client with a full send buffer does not stall the room; it gets a fresh full snapshot or is disconnected. |

### Experiments still required

1. **DO tick cost in workerd** at 163 entities with projection/serialization.
   The Node measurement is encouraging but not proof. Target < 10 ms per tick
   with four clients; if it is higher, reduce snapshot rate or optimize the
   projection before launch.
2. **Pages Functions WebSocket proxy.** A 101 upgrade through a Pages Function
   to a DO must be proven end-to-end with cookies and `Origin`. If it fails, use
   the Worker-static-assets fallback.
3. **Free-plan request accounting for WebSocket messages.** Confirm whether the
   free daily request counter applies the 20:1 incoming-message ratio or counts
   each message. Budget conservatively either way.
4. **Cross-browser interpolation/input feel** at 100–200 ms RTT. Server
   authority is correct but may feel laggy; add own-unit prediction only after
   measuring, not before.
5. **Free-tier change drill.** Simulate `1027`/`429`/`SQLITE_FULL` and verify the
   client disables online, preserves the current single-player battle, and never
   prompts for payment.

---

## 12. Decisions and assumptions

- **Modes:** 1v1 and 2v2 on two teams, up to four players per room. No FFA, no
  spectators, no ranked/ELO, no global chat, no friends, no leaderboards.
- **Authority:** server-authoritative simulation and snapshots, not relay or
  lockstep. Client prediction is optional and cosmetic.
- **Tick/snapshot:** 20 Hz server simulation, 10 Hz snapshots, 100 ms client
  interpolation buffer.
- **Rooms:** public directory and private code/invite; join only in lobby;
  reconnect only to an existing seat; 45-minute online cap.
- **Accounts:** guest-first, optional OAuth (one provider), no passwords or
  email in v1; single-player progress stays local.
- **Hosting:** Cloudflare Pages + Pages Function + Durable Object + D1, free
  plan only, fail closed, no paid fallback.
- **URL:** preserve `https://moderncombinedarms.pages.dev` as the same origin.
  A custom domain is optional and not required for $0.
- **Scope discipline:** no simulation rule, balance, weapon, fog, save-schema or
  unrelated UI change is part of this plan. The existing single-player path is
  the fallback and must remain untouched.

---

## 13. References

Retrieved 2026-10-29:

- Cloudflare Durable Objects pricing: <https://developers.cloudflare.com/durable-objects/platform/pricing/>
- Cloudflare Durable Objects limits: <https://developers.cloudflare.com/durable-objects/platform/limits/>
- Cloudflare Durable Objects WebSockets/hibernation: <https://developers.cloudflare.com/durable-objects/best-practices/websockets/>
- Cloudflare Workers limits: <https://developers.cloudflare.com/workers/platform/limits/>
- Cloudflare Pages limits: <https://developers.cloudflare.com/pages/platform/limits/>
- Cloudflare Pages Functions pricing: <https://developers.cloudflare.com/pages/functions/pricing/>
- Cloudflare Pages Functions bindings (including Durable Objects): <https://developers.cloudflare.com/pages/functions/bindings/>
- Cloudflare D1 pricing: <https://developers.cloudflare.com/d1/platform/pricing/>
- Cloudflare R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- Cloudflare Workers Static Assets billing: <https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/>
- Supabase pricing (free project pause, Realtime and Edge Function limits): <https://supabase.com/pricing>
- Deno Deploy pricing: <https://deno.com/deploy/pricing>

Local evidence is cited by file and symbol in the system map and findings above.
The audit did not modify the repository's source, configuration, dependency
manifests, lockfiles, tests or generated assets.
