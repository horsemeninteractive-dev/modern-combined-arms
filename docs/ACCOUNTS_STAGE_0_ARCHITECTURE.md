# MCA accounts — Stage 0 audit and architecture

This document is the audit and design record for the player account programme, and
the reference for Stages 1–6. It describes the repository as it actually is at the
time of writing, not as earlier reports described it.

Stage 1 implements the account service and authentication only. Stages 2–6 are
contracts here, not code.

---

## 1. What exists today

### Hosting

| Piece | Reality |
|---|---|
| Game client | Static Vite bundle, deployed to Cloudflare Pages project `moderncombinedarms` (`npm run release` → `wrangler pages deploy dist`). |
| Pages Functions | None in the production project. `phase0/pages/functions/` is an isolated probe for a different project (`mca-phase0-pages`) and is not deployed with the game. |
| Multiplayer rooms | Separate Worker `mca-multiplayer-staging`, `mp-room-wrangler.jsonc`, with two Durable Objects (`MatchRoomDurableObject`, `CapacityCoordinatorDurableObject`, SQLite-backed). |
| Room addressing | Public origin `https://mca-multiplayer-staging.horsemeninteractive.workers.dev`, compiled into the bundle via `VITE_MULTIPLAYER_URL`, allowlisted by `MP_ALLOWED_ORIGINS` and the `connect-src` CSP in `public/_headers`. |
| Databases | None. Capacity leases and room state live in Durable Object storage. |
| Secrets | Worker secrets (`MP_ADMIN_TOKEN`, `MCA_RESERVATION_TOKEN`), set with `wrangler secret put`. No secrets in the repo. |

### Client persistence

The brief expected IndexedDB. **The game does not use IndexedDB at all.** Local
persistence is `localStorage`:

- Saves: `SAVE_PREFIX + slot` keys, written by `app.ts` (`saveToSlot` / `readSlot`).
- Settings: `SETTINGS_KEY`.
- Campaign progress: `CAMPAIGN_SAVE_KEY` (migrated from `CAMPAIGN_PROGRESS_KEY`).
- Mission library and drafts: `src/mission/library.ts`, `src/ui/missionLibrary.ts`,
  with a `LibraryStorage` port already injected for tests.

Guest identity therefore extends the existing `localStorage` model. Introducing
IndexedDB for one small record would be a second persistence mechanism for no gain.

### Identity, as it is

- There are **no accounts and no player names**. A room seat is a
  `{ seatId, playerId, team, token }` record; authority is the seat bearer token,
  plus a join code for seat 1. The lobby shows seat/nation/colour, never a name.
- `MULTIPLAYER_FEATURE.accountLinking` is `false` and there is no code behind it.
- The room Worker treats every browser as an anonymous holder of a seat token.
- Simulation never reads identity: `playerId` is an index into `Game.state.players`.

### Versioning and migration conventions

- Game version and build number are compiled in from `package.json` and the commit
  count (`vite.config.ts`); saves carry their own `version` field and migrate
  through `src/sim/saveMigrations.ts`.
- Workers carry a `compatibility_date` and DO class migrations in wrangler config.
- There is no SQL migration mechanism yet, because there is no SQL database yet.

---

## 2. Architecture selected

```
Browser (Pages origin)
  │  same-origin fetch, HttpOnly cookie
  ▼
Pages Function  functions/api/account/[[path]].ts     ← pure forwarder
  │  service binding MCA_ACCOUNT
  ▼
Account Worker  mca-accounts        /api/account/*    ← this stage
  │  D1 binding DB
  ▼
D1 database     mca-accounts-<env>

Room Worker     mca-multiplayer-staging               ← unchanged transport
  └── Durable Objects (rooms, capacity)               ← unchanged authority
```

**Why this shape**

- The player's origin is Pages. A cookie is only genuinely first-party there, so
  the account API is exposed at `https://moderncombinedarms.pages.dev/api/account/*`
  and proxied by a Pages Function, exactly as the phase-0 probe proved possible.
  This avoids `SameSite=None` third-party cookies, which browsers are actively
  removing, and avoids CORS entirely.
- Cloudflare's existing account already provides Worker + D1 + Pages + secrets.
  No new vendor, no paid tier, no second backend.
- Durable Objects stay where they are. They are excellent at live rooms and wrong
  for account data (no cross-room queries, per-object storage).
- The account Worker is a small, pure `fetch` handler with an injected store, so
  every security rule is unit-testable in Node without Wrangler or real credentials.

### Trust boundaries

| Boundary | Rule |
|---|---|
| Browser → Pages Function | Same origin. Function forwards the request untouched (headers, cookies, body). |
| Pages Function → Account Worker | Service binding, not the public internet. |
| Account Worker → D1 | Parameterised statements only. |
| Browser ↔ Account Worker | Session is an opaque cookie; JS never sees the token. No account id is accepted from the client. |
| Room Worker → Account Worker | Only through a short-lived HMAC ticket the account service signs; the room verifies it locally. Never an account id supplied by the browser as authority. |

### OAuth redirect URIs

Registered at the providers (exact match):

- `https://moderncombinedarms.pages.dev/api/account/auth/google/callback`
- `https://moderncombinedarms.pages.dev/api/account/auth/discord/callback`
- Development: `http://127.0.0.1:5180/api/account/auth/<provider>/callback`

Both end up at the same Worker route through the Pages proxy, which is why cookies
set on the callback are first-party.

### Local sign-in

`npm run accounts:dev` starts the account Worker and `npm run dev:accounts` starts
the app on the fixed port above, so the registered redirect URI cannot drift. The
Worker reads `.dev.vars` (gitignored), which overrides `account-wrangler.jsonc`:
it holds `APP_ORIGIN`, the provider client id/secret pairs and, optionally,
`MCA_IDENTITY_TICKET_SECRET`. Empty credentials simply leave that provider
unavailable; guest play is unaffected.

---

## 3. Account identity model

- `accounts.id` is an opaque random 128-bit identifier, minted by the server. It is
  the permanent MCA identity. It never changes when providers are linked, when a
  display name changes, or when the player switches device.
- `account_identities` rows are *linked logins*: `(provider, provider_subject)`
  is the primary key, so one provider identity can belong to exactly one account.
  Google's stable `sub` and Discord's immutable user id are the subjects; Discord
  usernames and email addresses are never identity keys.
- Accounts are **never** merged automatically. Matching emails do nothing. Linking
  a provider identity that already belongs to another account is refused with
  `identity-in-use`; resolving it requires an explicit future flow (Stage 6).
- One account may hold several identities, so unlinking is allowed only while at
  least one login method remains.

### Status

`active | suspended | deleted`. A session belonging to a non-active account cannot
be resolved. Deletion workflows are Stage 6; the column exists now so the check is
already in the right place.

---

## 4. Database schema

`migrations/0001_accounts.sql` — see the file. Summary:

| Table | Purpose | Constraints |
|---|---|---|
| `accounts` | Permanent identity, status, timestamps. | PK `id`; status `CHECK`. |
| `account_identities` | Linked OAuth logins and provider profile metadata. | PK `(provider, provider_subject)`; FK → accounts; provider `CHECK`. |
| `account_sessions` | Hashed session tokens. | PK `id`; `UNIQUE(token_hash)`; FK → accounts. |
| `guest_migration_records` | Guest → account migration ledger. | PK `guest_id`; `UNIQUE(account_id)`; FK → accounts; state `CHECK`. |
| `auth_rate_limits` | Fixed-window counters for auth endpoints. | PK `(bucket, window_start)`. |
| `career_matches` | The XP ledger: one row per completed match. | PK `(account_id, match_ref)`; FK → accounts; mode/outcome/difficulty/provenance `CHECK`. |

Only raw session *hashes* are stored. Provider access tokens are never stored or
logged. Career totals are aggregated from `career_matches` on read, so there is
no balance column that can drift from the matches that justify it.

Migrations are append-only numbered files under `migrations/`, applied with
`wrangler d1 migrations apply`. They are plain SQL with `IF NOT EXISTS`, so a
re-run is safe.

---

## 5. Session security model

- 256-bit random token from `crypto.getRandomValues`, base64url encoded.
- Stored server-side as SHA-256 of the token; uniqueness on the hash.
- Cookie: `mca_session`, `HttpOnly`, `Secure` (except explicit dev), `SameSite=Lax`,
  `Path=/`, 30-day max age.
- Absolute lifetime 30 days; `last_seen_at` is refreshed at most once per day to
  avoid a D1 write per request. An expired or revoked session resolves to nothing.
- Rotation: a new session is issued after every successful sign-in and after
  provider link/unlink; the previous session is revoked first, so a stolen old
  cookie stops working.
- Logout revokes the current session. "Sign out everywhere" revokes all sessions
  for the account.
- CSRF: every state-changing request must carry an `Origin` that exactly matches
  the configured app origin (or a dev loopback origin), in addition to `SameSite=Lax`.
  OAuth `state` is a 256-bit random value bound to an HttpOnly cookie, single-use.
- Rate limits are enforced in D1 per endpoint bucket and client IP.

---

## 6. Guest identity and migration

- A guest profile is created lazily in `localStorage` under `mca.guest.v1`:
  `{ version, id, callsign, createdAt, migrationKey }`. The id is 128 random bits;
  the callsign is derived from it (`GUEST-7F3A`) so it is stable and not personal.
- No server record exists until the player signs in. Opening the game creates no
  account and performs no network request.
- The profile carries a `migrationKey` (its own random id) so retrying a migration
  is idempotent even if the client resends.
- Migration contract (`POST /api/account/migrate/guest`):
  - Requires a session and same-origin request.
  - Body: `{ guestId, migrationKey, profileDigest, career? }`, all validated. The
    optional `career` list is the guest ledger (at most 200 matches); each match
    is validated and its XP recomputed, then written with `provenance='guest'`.
    Omitting it is the Stage 1 behaviour and remains valid.
  - First use: writes `state='complete'`, returns `{ status: 'migrated' }`.
  - Repeat with the same guest, account and digest: `{ status: 'already-migrated' }`.
  - Same guest, **different** account: `409 guest-already-migrated` — the author is
    told, nothing is merged.
  - Same account, **different** guest: `409 account-already-migrated`.
  - Same guest and account but a different digest: `409 migration-conflict`.
- Stage 3 will extend the record with an XP import result; the ledger shape above
  is stable, so that is additive.

---

## 7. API contracts (v1)

All responses are JSON (`{ ok: true, ... }` or `{ ok: false, error: { code, message } }`),
`Cache-Control: no-store`, and no credentials are ever echoed in a body.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/account/health` | — | Liveness and configured providers. |
| GET | `/api/account/me` | optional | Current account/profile, or `{ authenticated: false }`. |
| GET | `/api/account/auth/:provider/start?mode=signin\|link` | session for `link` | 302 to provider. |
| GET | `/api/account/auth/:provider/callback` | — | Exchange + verify + session, 302 back to app. |
| POST | `/api/account/logout` | session | Revoke current session. |
| POST | `/api/account/sessions/revoke-all` | session | Revoke every session. |
| POST | `/api/account/providers/:provider/unlink` | session | Unlink one provider. |
| POST | `/api/account/migrate/guest` | session | Idempotent guest migration. |
| POST | `/api/account/multiplayer/ticket` | session | Short-lived room identity ticket. |
| GET | `/api/account/career` | session | Totals, rank standing and the latest 20 matches. |
| POST | `/api/account/matches` | session | Record one completed PvE match; XP is recomputed server-side. |

`GET /api/account/me` also reports `providers` configured on the deployment, so the
UI can hide a button that cannot work instead of failing after a click.

---

## 8. Multiplayer identity foundation

- The account Worker signs `v1.<accountId>.<issuedAt>.<hmac>` tickets (2-minute TTL,
  domain-separated audience).
- The room Worker verifies a presented `X-MCA-Identity-Ticket` at its edge with the
  shared `MCA_IDENTITY_TICKET_SECRET`, and forwards a trusted `X-MCA-Verified-Account`
  header to the Durable Object. The DO records it on the seat at open/join.
- **Absent ticket = guest.** Existing clients, room codes and matchmaking are
  unchanged.
- **Invalid ticket = 401.** A caller that presents a ticket does not silently
  degrade to guest; that would let a client claim to be signed in and be trusted.
- Account ids are stored server-side only. Status responses expose a boolean
  `verified`, never the id, because both seats read the same status document.
- Full lobby presentation (name, flag, profile) is Stage 2.

---

## 9. Later stages — integration points

**Stage 2 — profiles.** `accounts` gains `display_name`, `username` (unique, validated),
`avatar_url`; public profile endpoint reads no session data; lobby status carries a
display block from the verified seat record. Guest migration is already the entry
point for "create profile from guest".

**Stage 2 — career progression (implemented).** `career_matches` is the ledger:
one row per completed match, unique per account and reference, with provenance
(`local` for a client-submitted PvE result, `guest` for an imported guest ledger,
`authoritative` reserved for a room-owned result). XP is recomputed by the shared
rules in `src/accounts/career.ts` — base by mode, one per full minute (capped),
scaled by outcome and AI difficulty — never taken from the client. The rank
ladder in `src/accounts/ranks.ts` is universal and independent of nation; badges
are composed from chevrons, rockers, bars and stars. Guests keep the same ledger
in `localStorage` under `mca.career.v1` and it is imported during migration.

**Earlier roadmap entry — XP and ranks (superseded by Stage 2 above).** New tables: `xp_ledger` (unique `(account_id, match_ref, source)`),
`career_totals`, `match_results` with provenance (`authoritative` | `local`).
Server awards only from room-owned results; the room already owns authoritative
match results (`matchResult.ts`). Local PvE results are submitted with
`provenance='local'`, capped per day and clearly labelled. One combined total, one
career level; competitive rating stays a separate column elsewhere.

**Stage 4 — statistics and history.** Derived from the same accepted results in the
same transaction as the ledger write, so a duplicate submission cannot double count.
Statistics rows carry `mode` and `nation`.

**Stage 5 — cosmetics and flag.** `cosmetic_inventory`, `flag_designs` (validated JSON of
component ids from a server-side catalogue). Presentation only; no simulation read.

**Stage 6 — hardening.** Account deletion (status + crypto-shred), provider unlink
edge cases, explicit conflict resolution UI, offline reconciliation caps, D1
time-travel/backup notes, and full end-to-end verification.

---

## 10. Deployment steps that cannot be done from the repository

1. `wrangler d1 create mca-accounts` and put the returned `database_id` into the
   account Worker config.
2. `wrangler secret put GOOGLE_CLIENT_SECRET`, `DISCORD_CLIENT_SECRET`,
   `MCA_IDENTITY_TICKET_SECRET` (account Worker); `MCA_IDENTITY_TICKET_SECRET` on the
   room Worker (same value).
3. Google Cloud console: OAuth client (Web application), authorised redirect URIs
   listed in §2, consent screen scopes `openid email profile`.
4. Discord Developer Portal: application, OAuth2 redirect URIs listed in §2, scope
   `identify` only. No bot, no guild scopes.
5. Pages project: add the `MCA_ACCOUNT` service binding to the account Worker
   (Dashboard → Pages → Settings → Functions → Service bindings), or keep it in
   `wrangler.toml`/dashboard; Pages Functions need that binding to proxy.
6. Set `APP_ORIGIN` and the provider client ids as Worker vars.

No credential is committed. Until these steps are done the account UI reports
"not configured" and guest play is unaffected.

### Provisioned development OAuth applications

Created 4 Nov 2026 so local sign-in can be exercised end to end. Only
non-secret identifiers are recorded here; the client secrets exist only in
`.dev.vars` (gitignored) and, for deployed Workers, in `wrangler secret put`.

- **Google** — Cloud project `modern-combined-arms`, OAuth client
  `MCA Accounts (local dev)`,
  client id `1087100457105-nnsa9204violfnnbi9sjgp5pk7rg70mf.apps.googleusercontent.com`,
  redirect `http://127.0.0.1:5180/api/account/auth/google/callback`, scopes
  `openid email profile`. The consent screen is unverified, so every account that
  needs local sign-in has to be added as a test user in the Google console.
- **Discord** — application `MCA Accounts` (id `1567405902393381054`), scope
  `identify` only, no bot and no guild scopes. Registered redirect URIs, all
  ending `/api/account/auth/discord/callback`:
  `http://127.0.0.1:5180`, `http://localhost:5180`, `http://127.0.0.1:5173`,
  `http://localhost:5173`, `https://moderncombinedarms.pages.dev`.

Production still needs its own provider clients bound to the pages.dev origin
before a deployed sign-in can succeed; the development clients above are for
loopback only.

---

## 11. Known limitations at the end of Stage 1

- Google ID tokens are verified against Google's JWKS. Discord has no OIDC token;
  its identity is read from `/users/@me` with the exchanged access token, which is
  Discord's documented model.
- Rate limiting is fixed-window, per IP; it is a floor, not a DDoS defence
  (Cloudflare's own protections remain the real one).
- One guest profile may be migrated to one account, once, for now. Cross-device
  conflict resolution is Stage 6.
- Multiplayer matches earn no career XP yet: the client may not claim a
  multiplayer result, and the room service does not submit one. When the room
  owns that result it will post it with `provenance='authoritative'`.
- A campaign operation pays career XP on acceptance, not on the battle ending, so
  a retried or abandoned attempt cannot be farmed.
- Career XP cannot be verified as hard evidence of skill: a local PvE result is
  self-reported and only bounded by validation and the daily budget.
- Saves, settings, campaign progress and missions remain local-only. Nothing was
  uploaded and no save format changed.
