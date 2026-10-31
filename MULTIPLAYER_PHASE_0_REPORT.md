# MCA — Multiplayer Phase 0 Report

**Project:** Modern Combined Arms (MCA)  
**Phase:** 0 — workerd hosting and resource-budget spike  
**Date:** 2026-10-29  
**Status:** **CONDITIONAL PASS** — the runtime and information-boundary gates pass for a
single 30-minute four-seat session; the free-plan duration/request budget does **not**
support an uncapped public room directory. Details and gate-by-gate results are in §9.

---

## 1. What this phase proved

The existing simulation can be imported and run inside Cloudflare's local
`workerd` runtime without changing a gameplay rule. Four WebSocket clients can
stay connected to one Durable Object while it runs the existing `Game.tick()` at
20 Hz and sends team-filtered snapshots at 10 Hz. The Pages Function →
service-binding → Durable Object WebSocket path also works locally, including
cookies and `Origin` forwarding.

The important negative result is the budget. A single 30-minute four-client
session fits the published Workers Free Durable Object duration allowance, but a
public directory with several continuously active rooms does not, and the daily
request budget is tighter than duration once command acknowledgements are
counted. At 128 MB per active object,
13,000 GB-s/day is only about 28.2 room-hours per day. A room that stays active
for a full day consumes about 85% of that allowance by itself. The free plan also
shares a 100,000 request/day allowance across Workers and Pages Functions. An
uncapped public lobby is therefore not a sustainable $0 design; a capacity gate
or a paid plan is required for broad public concurrency.

No production source, configuration, dependency manifest, deployment or
single-player startup path was changed by this phase. The prototype is isolated
under `phase0/` and is not imported by `src/`.

---

## 2. Repository state and constraints

The working tree already contained a large set of uncommitted gameplay, visual,
audio, campaign, tutorial and shell-hardening changes when this phase began. They
were preserved. This phase did not stage, commit or revert them.

The current deployment is a static Vite build on Cloudflare Pages
(`https://moderncombinedarms.pages.dev`), with a service worker and a Pages
`_headers` policy. No server, lobby, account, room or network abstraction existed
in `src/`, `public/`, `index.html`, `package.json` or `vite.config.ts` before this
spike; a tree search for phase-0/network/lobby symbols found none outside the new
prototype.

Relevant existing code inspected:

| Concern | Existing symbol and file | Classification for multiplayer |
|---|---|---|
| Fixed simulation step | `Game.tick()` and `TICK_RATE = 20` in `src/sim/game.ts` and `src/sim/constants.ts` | Already suitable. The step is deterministic, fixed-size and independent of `requestAnimationFrame`. |
| Browser tick scheduling | `App.frame()` accumulator in `src/app.ts` | Limited change. The browser loop must not drive an online match; the server owns the clock. Single-player keeps its current loop. |
| Command ingress | `Game.enqueueCommand()` and `processCommands()` in `src/sim/game.ts` | Limited change for transport, architectural for authority. Online commands need a server gate; the internal queue can remain. |
| Unit movement, combat, targeting, construction | `Game.updateUnits()`, `updateProjectiles()`, `updateBuildingSystems()` and the command handlers in `src/sim/game.ts` | Already suitable server-side. The prototype imports them rather than duplicating rules. |
| Randomness | `Rng` in `src/core/rng.ts`; `state.rngState`, `Game.syncRng()` and `persistRng()` in `src/sim/game.ts`; AI seed in `AIControlState` | Already suitable with a trusted seed. No network source of randomness is allowed. |
| State ownership and serialisation | `Game.state`, `src/sim/save.ts`, `src/sim/saveMigrations.ts` | Limited change. Save format is local and is not a network snapshot format; Phase 0 does not reuse it for clients. |
| Scenario and seed | `createIslandAssault()` in `src/data/scenarios.ts`; `scenario.settings.seed` | Already suitable. The server constructs the scenario and chooses the seed. |
| Fog and hidden state | `Game.isVisibleTo()`, `Game.fogAt()`, `state.fog`, `state.contacts`, `state.charted` in `src/sim/game.ts` | Architectural. A client copy cannot be trusted; the server must project. |
| Victory and defeat | `Game.evaluateVictory()` in `src/sim/game.ts` | Architectural for online. The result must be computed once, server-side, per team. |
| Browser input | `src/ui/input.ts` and the app command calls | Limited change. Input stays browser-local; only validated commands cross the socket. |
| Audio/presentation | `src/ui/audio.ts`, `src/ui/announcer.ts`, `src/render/combatFx.ts` | Limited change. Existing local events may drive effects, but only server-approved events may cross the network. |
| Delivery and build | `vite build`, `tools/build-sw.mjs`, `public/_headers`, `public/sw.js` | Already suitable/limited. The static shell and single-player are independent of the prototype. |

The server prototype imports the existing `Game`, `createIslandAssault()` and
`Terrain` code. It does not fork or re-implement movement, combat, targeting,
construction, victory or AI rules.

---

## 3. What was added

All new runtime files are under `phase0/`; the test files are separate. The
prototype imports existing production modules, but no production module imports
or depends on the prototype.

### 3.1 File list

Added:

- `phase0/wrangler.jsonc` — isolated Worker/DO configuration and SQLite migration.
- `phase0/worker.mjs` — small HTTP router and Durable Object export.
- `phase0/room.mjs` — `Phase0Room`: game construction, 20 Hz clock, seats, sockets, snapshots, quota guard, shutdown.
- `phase0/commandGate.ts` — allowlisted command validation and seat-derived team authority.
- `phase0/projection.ts` — default-deny team snapshot projection.
- `phase0/client.mjs` — four-seat load generator and measurement consumer.
- `phase0/pages/wrangler.toml` — isolated local Pages project for the proxy probe.
- `phase0/pages/functions/api/phase0/cookie.ts` — dev cookie probe.
- `phase0/pages/functions/api/phase0/room/[[path]].ts` — pure forwarder from Pages Functions to the room Worker.
- `phase0/pages/public/index.html` and `phase0/pages/public/probe.js` — browser WebSocket probe.
- `tests/phase0-projection.test.ts` — projection leak tests for both teams.
- `tests/phase0-command-gate.test.ts` — authority, validation and hidden-target tests.
- `MULTIPLAYER_PHASE_0_REPORT.md` — this report.

Changed outside `phase0/`:

- `tests/match-music.test.ts` — one stale string assertion was updated from
  `response.status !== 206` to the equivalent `response.status === 206` after the
  existing service-worker hardening moved that check into `isCacheable()`. This
  is test maintenance for an already-present implementation; it does not alter
  runtime behaviour.

No production file, `package.json`, lockfile, `wrangler` deployment config,
`public/_headers`, service worker or single-player path was changed.

### 3.2 Room design

`Phase0Room` is a Durable Object with SQLite-backed storage enabled but no
per-tick database writes. It holds a `Game` instance in memory and uses four
fixed seats:

| Seat | Team |
|---|---|
| 0 | 0 |
| 1 | 1 |
| 2 | 0 |
| 3 | 1 |

The room accepts WebSocket upgrades at
`/api/phase0/room/:roomId/ws?seat=N&token=...`, rejects occupied seats, enforces a
maximum of four connections, requires a matching `Origin` (unless the dev-only
no-origin flag is set), and requires the local join token. It sends a `hello`
message containing the assigned seat and team, then snapshots.

The loop is a fixed 20 Hz clock. A 50 ms interval is only a wake-up; elapsed wall
time decides how many 20 Hz steps are due, with at most three catch-up ticks per
wake-up. If the object is more than 250 ms behind, it records the skipped ticks
and resets the clock instead of allowing an unbounded CPU spike. Snapshots are
built every second tick (10 Hz). The first implementation used a plain
`setInterval(50)` and silently ran at about 19.2 Hz; that was a real failure and
is documented in §9.

The game-ending path stops the tick timer after the final snapshot. `/shutdown`
closes all seats and makes later WebSocket upgrades return `410`. An empty room
stops its loop after a 60-second grace period. This is prototype lifecycle, not a
production lobby state machine.

### 3.3 Command authority

`gateCommand()` in `phase0/commandGate.ts` is deliberately narrow:

- Allowed types: `move`, `attack`, `stop`, `hold`.
- At most 64 unique positive integer entity IDs.
- Every entity must exist, be alive and belong to the seat's team.
- Coordinates must be finite and inside the map.
- Attack targets must exist, be hostile and currently visible to the seat's team.
- Any client-supplied `team` is ignored and replaced with the seat's team.
- One command batch per seat per 100 ms; messages over 4 KiB are rejected.

The transport supplies a seat, not a team. The seat table is the authority. A
forged team in the command body cannot change ownership, and an ID belonging to
the other team is rejected before it reaches `enqueueCommand()`.

### 3.4 Snapshot projection

`projectForTeam()` returns a fresh object and never serialises `GameState`,
`Scenario`, `state.ai`, `state.contacts`, `state.charted` or `state.fog`. It
includes:

- map dimensions and tile size;
- only players on the receiving team;
- own-team entities, plus enemy entities currently visible to that team;
- own-team projectiles, plus enemy projectiles whose current tile is visible;
- events permitted by the event filter;
- the team-relative result.

Hidden enemy entity IDs, positions, resources, production queues, AI targets,
contacts and fog arrays are absent. For a visible enemy projectile, a hidden
shooter ID is replaced with `0`. Events are filtered by team visibility, and
hidden `entityId`/`targetId` values are stripped even from own-team events.

### 3.5 Pages proxy

`phase0/pages/functions/api/phase0/room/[[path]].ts` forwards the original
`Request` to the `PHASE0_ROOM` service binding without rebuilding it. The probe
`phase0/pages/public/probe.js` fetches a probe cookie, opens a same-origin
WebSocket through the Pages origin, and displays the `hello` fields
`cookieSeen` and `originSeen`.

This is an experiment, not a production route. The Pages project and service
binding are isolated from the real Pages project.

---

## 4. Workloads and reproduction

### 4.1 Common configuration

- Runtime: local `workerd` through `wrangler dev` / `wrangler pages dev`.
- Wrangler: 4.155.0 for the Worker soak and 4.156.0 for the final Pages run,
  both fetched through `npx`.
- Compatibility date: `2026-10-01`.
- Node client: v24.14.0.
- Scenario: `createIslandAssault()`, fog enabled, seed `773311`.
- Server tick: 20 Hz fixed step.
- Snapshot rate: 10 Hz.
- Clients: four seats, two per team.
- Command traffic: one command batch per seat every 100 ms (the prototype's
  capped maximum), with a deliberately forged `team` field.
- Snapshot acknowledgements: every snapshot from every seat except the slow-seat
  test. This is intentionally conservative request accounting, not a recommended
  production protocol.

### 4.2 Normal 30-minute soak

The final 30-minute soak uses the normal scenario with AI disabled, so the match
cannot end by defeat before the socket/tick measurement completes. Four clients
stay connected for 1,800,000 ms and issue the same 10 Hz command load; this
isolates the long-running runtime, socket, snapshot and command costs from a
balance outcome.

```bash
npx --yes wrangler@4 dev \
  --config phase0/wrangler.jsonc \
  --port 8787 --ip 127.0.0.1 --local \
  --persist-to tmp/phase0-state-soak-v7
```

```bash
PHASE0_DURATION_MS=1800000 \
PHASE0_ROOM=soak-final-v7 \
PHASE0_COMMAND_MS=100 \
PHASE0_OUT=tmp/phase0-soak-final-v7.json \
node phase0/client.mjs
```

The stats endpoint is token-protected:

```bash
curl -H 'x-phase0-token: phase0-local-token' \
  http://127.0.0.1:8787/api/phase0/room/soak-final-v7/stats
```

A separate AI smoke run (60 seconds, `PHASE0_AI=1`, `--var PHASE0_AI:1`) is used
to confirm that the existing AI runs in `workerd`. It is not the 30-minute soak:
the AI defeated team 0 at about 509 seconds in an earlier run, and the room
correctly stopped its tick loop at that point. That match-end behavior is a
gameplay outcome, not a runtime failure, but it means AI combat is not what the
30-minute gate measured.

### 4.3 163-entity stress

A separate Worker instance uses `PHASE0_STRESS=1` with AI enabled. It adds 70
extra units per side to the base scenario, for exactly 163 live entities at
start. The stress client runs for 20 seconds with the same four seats, 10 Hz
snapshots and 100 ms command cap.

```bash
npx --yes wrangler@4 dev \
  --config phase0/wrangler.jsonc \
  --port 8789 --ip 127.0.0.1 --local \
  --var PHASE0_STRESS:1 --var PHASE0_AI:1 \
  --persist-to tmp/phase0-state-stress-v7
```

```bash
PHASE0_WS=ws://127.0.0.1:8789 \
PHASE0_HTTP=http://127.0.0.1:8789 \
PHASE0_DURATION_MS=20000 \
PHASE0_ROOM=stress-final-v7 \
PHASE0_OUT=tmp/phase0-stress-final-v7.json \
node phase0/client.mjs
```

### 4.4 Pages proxy probe

The room Worker runs on 8787. A separate local Pages project forwards the
same-origin request through a service binding.

```bash
npx --yes wrangler@4 pages dev public --cwd phase0/pages \
  --port 8788 --service PHASE0_ROOM=mca-phase0-rooms
```

The browser probe is opened at `http://127.0.0.1:8788/`. The expected `hello`
fields are a cookie seen by the upgrade request and an `Origin` of
`http://127.0.0.1:8788`.

### 4.5 Slow client, reconnect and quota cases

- Slow: seat 3 withholds acknowledgements; the room marks it slow after 12
  outstanding snapshots and drops it after 40 or after a two-second grace.
- Reconnect: seat 0 is disconnected and reopened; it receives a fresh full
  snapshot with the current tick and keeps its seat.
- Quota: `PHASE0_REQUEST_BUDGET` is set below the normal 100,000 to force the
  request guard. The room sends close code `1013`, stops its loop, and later
  upgrades receive `503`.
- Shutdown: `POST /shutdown` with the token and allowed Origin closes seats; later
  upgrades receive `410`.

---

## 5. Measurements

All timings are local wall-clock values from `performance.now()` inside the
Worker and the Node client. They are **not** Cloudflare production CPU or network
measurements. Raw output is in the `tmp/phase0-*.json` files listed in
Appendix B.

### 5.1 30-minute soak

Four seats stayed connected through 1,790.2 s and all four closed with code
`1000` at 1,800.1 s. The room recorded 36,003 ticks over 1,800.24 s: **19.999 Hz**.
The client elapsed time was 1,800.363 s.

| Metric | Result |
|---|---|
| Ticks / effective rate | 36,003 / **19.999 Hz** |
| Tick duration p50 / p95 / p99 / max | 0 / 1 / 1 / 8 ms |
| Tick overruns | 0 |
| Tick skips | 0 |
| Projection + serialisation p50 / p95 / p99 / max | 0 / 1 / 1 / 60 ms |
| Snapshot bytes p50 / p95 / p99 / max | 2,301 / 2,360 / 2,534 / 3,685 B |
| Snapshots / outbound frames / outbound bytes | 35,998 / 71,996 / 165,556,490 B |
| Per-client bytes | 41,898,778 (team 0 seats), 40,879,467 (team 1 seats) |
| Incoming WebSocket messages | 138,511 |
| Billed Durable Object requests (20:1) | 6,930 |
| Commands accepted / rejected | 66,227 / 288 |
| Dropped snapshots / send failures / room errors | 0 / 0 / 0 |
| Socket close errors | 4 (normal final-close races) |
| Final entities / victory | 21 (14 units, 7 buildings) / `playing` |

There was one 60 ms projection/serialisation outlier; p99 stayed at 1 ms and
there were no tick overruns. The documented gate budgets used here are: p99 tick
<= 10 ms, p99 projection/serialisation <= 5 ms, p99 snapshot <= 50 kB per client,
zero tick overruns and zero room-side dropped snapshots. This run passes all of
them.

A separate 60-second AI smoke run used the same four seats and the normal
scenario with AI enabled: 1,203 ticks over 60.23 s (**19.973 Hz**), tick p99 2 ms
(max 25 ms), 1,198 team projections, 6,263,298 outbound bytes, 4,588 incoming
messages, 234 billed requests, 0 overruns and 0 errors. It ended with 22 live
entities, confirming AI activity; it is a load smoke, not a 30-minute AI soak.

### 5.2 Stress workload, 163 entities

The stress room started with exactly 163 live entities (16 base units plus 70
added units per side, and 7 structures). AI was enabled; it produced one extra
structure during the run, so the final count was 164. This is a 20-second spike,
not a 30-minute stress soak.

| Metric | Result |
|---|---|
| Duration / ticks / effective rate | 20.23 s / 403 / **19.92 Hz** |
| Tick duration p50 / p95 / p99 / max | 1 / 3 / 8 / 37 ms |
| Tick overruns | 0 |
| Projection + serialisation p50 / p95 / p99 / max | 0 / 1 / 1 / 1 ms |
| Snapshot bytes p50 / p95 / p99 / max | 14,026 / 14,450 / 14,596 / 14,752 B |
| Snapshots / outbound frames / outbound bytes | 398 / 796 / 11,263,926 B |
| Incoming messages / billed requests | 1,064 / 58 |
| Commands accepted / rejected | 268 / 0 |
| Dropped snapshots / room errors / overruns | 0 / 0 / 0 |
| Final entities | 164 (156 units, 8 buildings) |

The worst tick was 37 ms, under the 50 ms tick interval; p99 was 8 ms. The
larger 14.6 kB p99 payload still sits far below the 32 MiB received-message
limit and the 50 kB gate budget.

### 5.3 Pages proxy

A Node client opened four sockets through the Pages origin and completed a
10-second run:

| Metric | Result |
|---|---|
| Duration / ticks / effective rate | 10.235 s / 203 / **19.83 Hz** |
| Tick p50 / p95 / p99 / max | 0 / 1 / 2 / 4 ms |
| Projection p50 / p95 / p99 / max | 0 / 1 / 1 / 1 ms |
| Snapshot bytes p50 / p95 / p99 / max | 1,869 / 2,196 / 2,198 / 2,199 B |
| Snapshots / outbound frames / outbound bytes | 198 / 396 / 781,838 B |
| Incoming messages / billed requests | 528 / 31 |
| Commands accepted / rejected | 132 / 0 |
| Errors / drops / overruns | 0 / 0 / 0 |

The Node client sends no browser cookie or `Origin`, so its `hello` correctly
showed `cookieSeen: false` and `originSeen: null`. The browser probe is the
origin/cookie check: it opened seat 0 through `http://127.0.0.1:8788/`, received
snapshots at 10 Hz, and reported:

```text
seat 0 · team 0 · cookie true · origin http://127.0.0.1:8788
```

A forged foreign origin through Pages returned `403 origin-rejected` when given
the dev token. The cookie route returned `200` with
`Set-Cookie: phase0_probe=1; Path=/; SameSite=Lax`. A token-protected stats call
through Pages returned the expected `Cache-Control: no-store`,
`Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and
`X-Content-Type-Options: nosniff` headers, with no wildcard CORS header.

### 5.4 Slow, reconnect and quota

| Case | Result |
|---|---|
| Slow seat | Seat 3 withheld acknowledgements; the room logged 20 dropped frames and closed the slow seat while the other three continued. |
| Reconnect | Seat 0 reconnected once and received the next snapshot at the current tick; no seat or team change was accepted. |
| Quota guard | Synthetic request budget forced `quotaExhausted=true`, close code `1013`, and `503` for a later upgrade. |
| Shutdown | `/shutdown` closed connected seats and later upgrades returned `410`. |
| Full room | A fifth seat request returned `409 room-full`; an occupied seat returned `409 seat-occupied`. |
| Origin/token | Missing token returned `401`; a foreign `Origin` returned `403`; a missing `Upgrade` header returned `426`. |
| API response headers | Worker/DO JSON through Pages carried `Cache-Control: no-store`, `Cross-Origin-Resource-Policy: same-origin`, `Referrer-Policy: no-referrer` and `X-Content-Type-Options: nosniff`; no wildcard CORS header. |

The slow and reconnect evidence comes from the earlier short runs
(`tmp/phase0-slow.json`, `tmp/phase0-reconnect.json`); the final soak was not
interrupted to repeat them.

### 5.5 Measurement limitations

- Loopback only. No WAN latency, packet loss, TLS, CDN edge or mobile network is
  represented.
- The 30-minute duration is the Durable Object's local uptime. It does not prove
  Cloudflare's production eviction, hibernation or duration accounting.
- `performance.now()` tick time includes garbage collection and host scheduling;
  it is not isolate CPU time.
- OS process CPU and working set are proxies for the whole `workerd` process,
  not the per-object 128 MB allocation. They are recorded separately below.
- The local runtime does not enforce Workers Free quotas. The quota case uses the
  prototype's synthetic request counter, not Cloudflare's billing system.
- The Pages test is local `wrangler pages dev`; the deployed Pages edge and a
  production service binding were not tested. The 30-minute soak ran directly
  against the Worker; the Pages proxy was exercised for 10 seconds with four
  clients and in a browser. A 30-minute Pages soak was not run.
- The 30-minute soak uses AI disabled so the match cannot end early. AI combat
  was exercised only in the 60-second smoke; an AI-enabled match ended in a
  legitimate defeat at about 509 s. A long AI soak remains an open measurement.
- The stress run is 20 seconds, not a 30-minute stress soak. The 30-minute gate
  applies to the normal command/socket workload; stress duration remains an open
  measurement.
- Slow-close and empty-room timers were not leak-tested over repeated room
  lifecycles. They are one-shot timers, but no heap/timer instrumentation was
  run.
- No real Cloudflare account, deployment, DNS or production secret was used.
- No renderer or GPU path was exercised. This spike measures simulation,
  projection and JSON serialisation only.
- Single-player independence is structural (no import of `phase0/`, unchanged
  startup path, passing build), not an end-to-end match with the network blocked.
- The Pages Function is a single service-binding `fetch()` and does no parsing or
  serialisation. Its local CPU time was not measured in isolation; the 10 ms
  Workers CPU limit is therefore not proven by this spike, only made plausible
  by the trivial forwarder body.

The listening `workerd` process used 18.05 s of CPU over the 1,800 s run,
about **1.0% of one core**. Its working set was 83,992,576 B (about 84 MB) at
the end, with the same peak; it was 59,338,752 B shortly after startup. These are
whole-process Windows measurements, not isolate CPU or the 128 MB per-object
allocation, and the working-set growth is not enough to diagnose a leak. The
soak had no `errors`, no tick skips and no dropped snapshots; the four
`socketErrors` are the expected final-close races.

---

## 6. Free-plan budget

### 6.1 Published allowances used

Accessed 2026-10-29. These are the official Cloudflare pages, not third-party
summaries.

| Product | Free allowance | Source |
|---|---|---|
| Durable Objects requests | 100,000/day; incoming WebSocket messages count at 20:1 for billing; outgoing messages and protocol pings are not charged | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects duration | 13,000 GB-s/day; active/idle-but-unable-to-hibernate wall time, allocated as 128 MB per object; `accept()` on a WebSocket incurs duration for the whole connection | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Durable Objects SQLite | 5M rows read/day, 100,000 rows written/day, 5 GB total on Free | [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/) |
| Workers Free | 100,000 requests/day, 10 ms CPU per invocation, 128 MB memory per isolate | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Pages Functions | Requests count against the same Workers Free 100,000/day; static asset requests are free and unlimited | [Pages Functions pricing](https://developers.cloudflare.com/pages/functions/pricing/) |
| D1 Free | 5M rows read/day, 100,000 rows written/day, 5 GB total; over-limit queries fail until 00:00 UTC | [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) |

Free-plan limits reset at 00:00 UTC and exceeding them causes further operations
of that type to fail; Cloudflare does not silently upgrade the account. That is
the property that makes a strict $0 design possible, provided the application
turns those failures into a graceful "online unavailable" state.

### 6.2 Durable Object duration

Duration is charged for the 128 MB allocation, not measured memory:

```
one 30-minute room = 1,800 s × 128 MB / 1 GB
                   = 1,800 × 0.128 GB-s
                   = 230.4 GB-s
```

Daily capacity:

```
13,000 GB-s/day ÷ 230.4 GB-s per 30-minute room = 56.4 rooms/day
```

So the free duration allowance is about **56 full 30-minute four-seat rooms per
day**, or **28.2 room-hours per day**, assuming no other Durable Object duration.
At 24-hour average load that is only about **1.18 concurrent rooms** by duration
alone. During a four-hour evening peak it is at most about **7 concurrent rooms**,
and that uses the entire daily duration budget. The request budget below is
tighter than this once command and acknowledgement traffic is counted.

This is the decisive constraint. It is not tick CPU: the 20 Hz simulation is
cheap in local measurements. It is the wall-clock duration of an object that
must stay active to run the match. The WebSocket Hibernation API can avoid
duration for an idle lobby whose sockets are quiet, but a room that is ticking a
match cannot hibernate; hibernation does not remove the cost of an active match.

A production room must therefore have a hard match cap and a global daily
duration accounting mechanism. The prototype does not yet implement that global
accounting; it only has a per-room request-budget switch.

### 6.3 Request budget

The planning model below is deliberately conservative: every seat acknowledges
every 10 Hz snapshot and sends a command batch every 100 ms. The final soak
actually sent 138,511 incoming messages and billed 6,930 requests (because the
clients did not quite hit every 100 ms slot), so the 144,000/7,204 figures below
are a slight overestimate.

- 4 seats × 10 snapshots/s × 1,800 s = 72,000 snapshot acks.
- 4 seats × 10 command batches/s × 1,800 s = 72,000 command messages.
- 144,000 incoming WebSocket messages ÷ 20 = 7,200 billed requests.
- Plus four connection upgrades = 7,204 Durable Object requests per room.

With 100,000 requests/day:

```
100,000 ÷ 7,204 ≈ 13.9 rooms/day
```

That is about **6.9 room-hours/day**, far below the duration allowance. At a
24-hour average that is only about **0.29 concurrent rooms**, not the 1.18 that
duration alone allows. The snapshot acknowledgement is the avoidable cost. If
the client acknowledges only on reconnect or every N snapshots, the same room
uses:

```
4 × 10 × 1,800 = 72,000 command messages
72,000 ÷ 20 = 3,600 billed requests
3,600 + 4 upgrades = 3,604 requests per room
100,000 ÷ 3,604 ≈ 27.7 rooms/day
```

or about **13.9 room-hours/day**, or **0.58 concurrent rooms** at 24-hour
average. A production protocol must not ack every snapshot, but even without
acks a continuously active four-seat room at the 10 Hz command cap cannot fit a
full day: 4 seats × 10 messages/s × 86,400 s ÷ 20 = 172,800 requests, over the
100,000 daily limit. The 24-hour request ceiling is about 13.9 continuous hours
without acks (6.9 with acks), or 27.7 sequential 30-minute rooms without acks.

Even after removing acks, the request budget is the tighter daily limit for a
30-minute, 100 ms-command-cap room.

The Pages Function upgrade itself is a Workers request. Four upgrades per room
add four requests to the shared Workers/Pages allowance. Static assets served by
Pages do not count.

A conservative initial target that fits both published limits is **three
concurrent four-seat rooms for a four-hour daily window, 30-minute cap, no
per-snapshot acknowledgements**. It uses about 12 room-hours of the 28.2-hour
duration budget and about 86,500 of the 100,000 daily requests for 24 room
sessions. That projection is linear from the measured single-room workload; it
was not measured with three simultaneous rooms.

Connection limits are not the near-term constraint. The prototype caps four
application seats. A Durable Object has a soft limit of about 1,000 requests per
second and accepts received WebSocket messages up to 32 MiB; the measured
snapshots are three orders of magnitude smaller. The relevant limits are the
daily duration and request budgets, not per-connection throughput.

### 6.4 D1 and Durable Object SQLite

The prototype writes no rows per tick. That is deliberate: at 20 Hz, one write
per tick would exhaust the 100,000 row/day allowance in about 1.4 hours per
continuously active room. A production lobby should write only room creation,
join/leave state changes and final results, not simulation state.

D1's 5M read/day and 100,000 write/day are ample for a small directory, but the
directory must be indexed and must not scan every room on every poll. The
prototype does not implement D1 at all; this is Phase 2 work. There is no D1
evidence to claim here. Cloudflare's 2026-09-01 changelog also confirms that Free
D1 queries over the daily limits now fail rather than allowing a paid overflow:
[D1 free-limit enforcement](https://developers.cloudflare.com/changelog/post/2026-09-01-d1-free-tier-limit-enforcement/).

### 6.5 Is $0 genuinely sustainable?

For **one 30-minute four-seat room at a time**, yes: it is 1.8% of the daily
duration allowance and about 7.2% of the daily request allowance with
conservative acknowledgements. The daily ceiling is about 14 sequential rooms
with per-snapshot acks, or about 27 without. It is not a full-day room: even
without acks, a room continuously active at the 10 Hz command cap uses 172,800
requests/day. The single-player game has no dependency on the prototype, so it
remains available if online services fail.

For an **uncapped public room browser**, no. Two continuously active rooms exceed
the duration allowance before the end of a day; three four-hour rooms are close
to the request ceiling even after removing snapshot acknowledgements. Free-plan
terms can also change; this is a sustainable configuration only while the
published plan and limits remain in force. It is not a contractual guarantee.

There is no paid fallback in the prototype: it has no paid binding, no billing
configuration and no automatic upgrade path. On the synthetic request-budget
exhaustion it returns `503`/close `1013` instead of incurring a charge.

---

## 7. Security and information-boundary results

### 7.1 Automated tests

`tests/phase0-projection.test.ts` and `tests/phase0-command-gate.test.ts` cover:

- own and visible entities only;
- hidden enemy entity absence and no hidden coordinate in the serialised payload;
- absence of `scenario`, `ai`, `contacts`, `charted`, `fog`, `rngState` and `seed`;
- enemy resource values absent;
- both teams using the same default-deny boundary;
- hidden event suppression and hidden `entityId`/`targetId` redaction;
- visible enemy presence when fog is off;
- hidden shooter IDs on visible projectiles replaced with `0`;
- forged `team` replaced by the seat team;
- enemy-owned IDs rejected;
- hidden attack targets rejected;
- visible attack targets accepted;
- out-of-bounds and non-finite coordinates rejected;
- unknown command types and malformed ID lists rejected.

The phase-0 files contain **12 tests**, all passing. The full repository suite is
**790/790 passed** across 73 files. `npm run build` (which runs
`tsc --noEmit`, the Vite production build and the service-worker build) also
passed. No test failures remain, including the previously stale service-worker
assertion described in §8.2.

### 7.2 Transport checks

| Check | Result |
|---|---|
| Pages Function forwards WebSocket upgrade | Passed locally; browser received snapshots through `http://127.0.0.1:8788`. |
| Cookie visible on upgrade | Passed; `hello.cookieSeen` was true. |
| Origin preserved | Passed; `hello.originSeen` was `http://127.0.0.1:8788`. |
| Foreign Origin rejected | Passed; `403 origin-rejected`. |
| Missing token | Passed; `401 unauthorized`. |
| Occupied seat / fifth connection | Passed; `409 seat-occupied` / `409 room-full`. |
| Shutdown | Passed; `410 room-closed` after shutdown. |
| Quota guard | Passed synthetically; `503 quota-exhausted` and close code `1013`. |

### 7.3 Security caveats

This prototype is **not** a production authentication boundary:

- The join token is a static local dev secret in `wrangler.jsonc`. Anyone who
  knows it can claim an open seat.
- The seat is selected by a query parameter. Seat ownership is enforced after
  assignment, but assignment is not tied to a signed session or account.
- There is no guest session, OAuth, account linking, rate limit per IP, room
  password or invitation signature.
- Command batches are limited to one per 100 ms, but acknowledgements are not
  rate-limited. A malicious client can send many `ack` messages and consume the
  request budget. Production must rate-limit or batch every inbound message type.
- `PHASE0_ALLOW_NO_ORIGIN=1` is a local convenience and must never be enabled in
  production.
- The Pages Function is a pure forwarder with no API CORS policy; a production
  Function must add the security-header and same-origin policy already designed
  for the shell.
- Slow-client detection in this prototype depends on snapshot acknowledgements.
  Removing per-snapshot acks for the request budget requires a different
  backpressure signal (`bufferedAmount`, a periodic health message, or a bounded
  server-side send queue).
- The service-worker API-cache and shell-header work from the earlier security
  review is present in the tree but is **not** exercised by this isolated Pages
  project.

These are expected Phase 1/2/4 work, not failures of the seat-authority test. The
specific gate "a forged player ID or team cannot grant authority" passes for the
command envelope; the broader "unauthenticated client cannot steal a seat" gate
does not yet exist.

---

## 8. Regressions and failures

### 8.1 Tick-rate drift (fixed)

The first 60-second AI run recorded 1,154 ticks in 60.2 seconds: **19.17 Hz**, not
20 Hz. `setInterval(50)` is not a fixed clock in `workerd`; it drifted and the
simulation silently ran slow. The room loop was changed to a 20 Hz wall-clock
schedule with bounded catch-up (maximum three ticks per wake-up, reset after
250 ms behind). The final soak is the verification of that fix.

The catch-up policy still has a deliberate limitation: a long host pause can
skip ticks, which is recorded in `tickSkips`. It prevents an unbounded CPU spike
but does not make the simulation catch up after a multi-second stall. A
production room must decide whether to pause the match or accept the skipped
wall time.

### 8.2 Test assertion drift (fixed)

`npm test` initially failed one unrelated assertion in
`tests/match-music.test.ts`: it searched for the literal
`response.status !== 206`, while the already-hardened service worker implements
the equivalent check as `response.status === 206` inside `isCacheable()`. The
assertion was updated to the equivalent guard. This was a test/implementation
drift, not a gameplay or networking regression.

### 8.3 No production regression observed

- `npm run build` after the final measurements: passed, including the
  `tsc --noEmit` step, the Vite production build and `tools/build-sw.mjs`.
- No production import of `phase0/` exists.
- No gameplay, balance, fog, save-format or single-player startup code was
  edited by this phase.
- Nothing was staged or committed; the pre-existing working-tree changes remain
  uncommitted.

### 8.4 Early shutdown errors

Earlier short runs recorded `errors: 3–5` because a socket closed while the
client was disconnecting. Those were separated from real room errors: the final
code increments `sendFailures`/`socketErrors` for normal disconnect races and
`errors` only for tick exceptions. The final soak is read from `errors`, not from the earlier probe JSON.

---

## 9. Acceptance gates

| Gate | Status | Evidence |
|---|---|---|
| Four clients remain connected for 30 minutes in the intended runtime | **PASS (local; non-AI command/socket workload)** | Four seats connected through 1,790.2 s and all closed `1000` at 1,800.1 s; room uptime 1,800.24 s. AI combat was a separate 60 s smoke. |
| 20 Hz tick without unexplained divergence or persistent overruns | **PASS (local)** | 36,003 ticks / 1,800.24 s = **19.999 Hz**; 0 tick overruns, 0 skips, max tick 8 ms. |
| Snapshot projection/serialisation within a documented budget | **PASS** | p99 projection 1 ms, p99 payload 2,534 B, zero drops; 163-entity stress p99 tick 8 ms and p99 payload 14,596 B. |
| Every client receives only its permitted team information | **PASS** | 6 projection tests for both teams; hidden IDs/events/resources absent, including hidden projectile shooter IDs. |
| Forged player ID/team cannot grant authority | **PASS (command envelope)** | 6 gate tests; forged `team` ignored, enemy IDs and hidden targets rejected, coordinates bounded. |
| Pages proxy works end-to-end, or documented alternative | **PASS (local) / INCONCLUSIVE (deployed)** | Four sockets ran through Pages for 10.2 s; browser `cookie true`, Origin preserved; foreign Origin 403; headers/no wildcard CORS verified. |
| Measured usage supports a conservative $0 budget for intended initial concurrency | **PASS for one 30-minute room at a time / FAIL for uncapped public rooms** | 230.4 GB-s (1.8% of 13,000) and 6,930 requests (6.9% of 100,000) per 30-minute room; ~14 conservative sessions/day with acks, ~28 without; no full-day public concurrency. |
| Quota exhaustion disables online activity without affecting single-player | **PASS (synthetic) / INCONCLUSIVE (platform integration)** | Synthetic guard closed `1013` and returned `503`; no Cloudflare account quota API or deployed failure test. Single-player has no import of `phase0/`. |
| Existing typecheck, test and build checks pass where applicable | **PASS** | Full suite 790/790; `npm run build` passed `tsc --noEmit`, Vite and `tools/build-sw.mjs`. |

The gate list is deliberately split where one number cannot honestly answer two
different questions. A single room is within budget; an unbounded public
directory is not.

---

## 10. Recommendation

**Proceed to Phase 1 — server-safe core and command gate, with a global
active-room/duration budget gate before any lobby UI.**

Evidence for proceeding:

- The existing `Game` runs unmodified in `workerd`.
- Four clients stayed connected through the final 30-minute soak at the intended
  tick and snapshot rates with no tick overruns.
- The Pages Function → service binding → Durable Object path works locally,
  including cookies and Origin.
- The default-deny projection and seat-derived command authority have automated
  tests.
- The measured tick and snapshot costs are small enough that the limiting
  resources are object duration and WebSocket request accounting, not simulation
  CPU.

Evidence against proceeding directly to a public lobby:

- 13,000 GB-s/day is about 28.2 active room-hours, or roughly 1.18 continuously
  active rooms by duration alone. The request budget reduces the sustainable
  24-hour average to about 0.29 rooms with per-snapshot acks, or 0.58 without
  them. A public room browser with several all-day rooms is not a $0 deployment.
- The conservative soak protocol uses about 7,204 requests per 30-minute room,
  leaving room for only about 14 such rooms/day. Snapshot acknowledgements must
  be removed before the request budget is viable; without them the ceiling is
  about 27 rooms/day, still less than the 56 the duration allowance suggests.
- The prototype's quota guard is synthetic; actual free-tier accounting and
  graceful capacity failure are not wired to the platform.
- Seat assignment still relies on a static dev token; production identity is
  Phase 4 work, but a signed guest session is needed before strangers can join.

The next phase should therefore deliver the server-safe simulation boundary and
the command gate, plus a real global budget guard that reserves duration and
requests **before** a room is created. Do not build the public directory until
that guard is proven against a deployed Worker and the free-tier counters.

---

## Appendix A — Commands used

```bash
# 30-minute, four-client soak (no AI so the match cannot end early)
npx --yes wrangler@4 dev --config phase0/wrangler.jsonc \
  --port 8787 --ip 127.0.0.1 --local \
  --persist-to tmp/phase0-state-soak-v7

PHASE0_DURATION_MS=1800000 \
PHASE0_ROOM=soak-final-v7 \
PHASE0_COMMAND_MS=100 \
PHASE0_OUT=tmp/phase0-soak-final-v7.json \
node phase0/client.mjs

# 60-second AI smoke (separate room)
npx --yes wrangler@4 dev --config phase0/wrangler.jsonc \
  --port 8787 --ip 127.0.0.1 --local \
  --var PHASE0_AI:1 --persist-to tmp/phase0-state-ai-v7

PHASE0_DURATION_MS=60000 PHASE0_ROOM=ai-smoke-v7 \
PHASE0_COMMAND_MS=100 PHASE0_OUT=tmp/phase0-ai-smoke-v7.json \
node phase0/client.mjs

# 20-second, 163-entity stress
npx --yes wrangler@4 dev --config phase0/wrangler.jsonc \
  --port 8789 --ip 127.0.0.1 --local \
  --var PHASE0_STRESS:1 --var PHASE0_AI:1 \
  --persist-to tmp/phase0-state-stress-v7

PHASE0_WS=ws://127.0.0.1:8789 PHASE0_HTTP=http://127.0.0.1:8789 \
PHASE0_DURATION_MS=20000 PHASE0_ROOM=stress-final-v7 \
PHASE0_OUT=tmp/phase0-stress-final-v7.json node phase0/client.mjs

# Pages Functions -> service binding -> Worker/DO
npx --yes wrangler@4 pages dev public --cwd phase0/pages \
  --port 8788 --ip 127.0.0.1 --service PHASE0_ROOM=mca-phase0-rooms

PHASE0_HTTP=http://127.0.0.1:8788 PHASE0_WS=ws://127.0.0.1:8788 \
PHASE0_DURATION_MS=10000 PHASE0_ROOM=pages-final-v7 \
PHASE0_OUT=tmp/phase0-pages-final-v7.json node phase0/client.mjs

# Verification
npm test
npm run build
```

---

## Appendix B — Raw artifacts

| Artifact | Purpose |
|---|---|
| `tmp/phase0-soak-final-v7.json` | Final 30-minute client and room stats. |
| `tmp/phase0-soak-client-v7.log` | Final soak client progress and disconnects. |
| `tmp/phase0-soak-worker-v7.log` | Final soak Worker startup and local runtime log. |
| `tmp/phase0-ai-smoke-v7.json` | 60-second AI smoke. |
| `tmp/phase0-stress-final-v7.json` | Final 163-start-entity stress run. |
| `tmp/phase0-pages-final-v7.json` | Four-client Pages proxy measurement. |
| `tmp/phase0-pages-client-v7.log`, `tmp/phase0-pages-worker-v7.log` | Pages client and Function/Worker logs. |
| `tmp/phase0-slow.json`, `tmp/phase0-reconnect.json` | Slow client and reconnect probes. |
| `tmp/phase0-quota.json` | Synthetic request-budget exhaustion. |
| `tmp/phase0-test.log`, `tmp/phase0-build.log` | Final verification output. |

These are local measurement artifacts, not committed build inputs. The report is
the durable record; the JSON files make the numbers reproducible on this host.
