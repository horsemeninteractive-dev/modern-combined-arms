# Deployment runbook — account Worker, room Worker and Pages app

This is the ordered procedure for putting MCA's three deployable units into a
real environment. It is written to be followed top to bottom: nothing in it is
safe to skip, and steps 3–5 exist so that no migration is ever applied to a
database whose identity has not been confirmed first.

Nothing here has been performed against a remote environment as part of this
document. Running it is a production change and needs the owner's approval; the
runbook is the procedure, not the authorisation.

---

## 0. What is being deployed

| Unit | Config (live) | Command | Deployed name | Public address |
| --- | --- | --- | --- | --- |
| Account Worker (API, OAuth, D1) | `account-wrangler.live.jsonc` | `npm run accounts:deploy` | `mca-accounts` | `https://mca-accounts.<account-subdomain>.workers.dev` |
| Room Worker (Durable Objects) | `mp-room-wrangler.live.jsonc` | `npm run rooms:deploy` | `mca-multiplayer-staging` | `https://mca-multiplayer-staging.horsemeninteractive.workers.dev` |
| Pages app (bundle + account proxy) | Pages project `moderncombinedarms` | `npm run release` | — | `https://moderncombinedarms.pages.dev` |

The account Worker is reached in normal play only through the Pages Function
(`functions/api/account/\[\[path\]\].ts`), which forwards the request over the
`MCA_ACCOUNT` service binding. That is what keeps the session cookie
first-party. Direct requests to the Worker's own hostname are subject to the
Worker's host check and are expected to be refused in production.

The room Worker is dialled directly by the page; its address must match
`VITE_MULTIPLAYER_URL` in `.env.production`, the `connect-src` entry in
`public/_headers`, and `MP_ALLOWED_ORIGINS` in the live room config.

---

## 1. Preconditions

- The Cloudflare account that owns `mca-accounts` and
  `mca-multiplayer-staging` is available, and `npx wrangler whoami` names it.
- You know which environment you are touching. "Live" in this repository means
  the two live configs above; `account-wrangler.jsonc` and
  `mp-room-wrangler.jsonc` are development configs (their D1 id is a
  placeholder) and must not be deployed as a release.
- The change has been approved, including any remote migration.
- You have read §9 before starting: migrations are additive, but a code rollback
  still has a defined procedure.

Record at the top of the change note, before touching anything:

```
operator:            <name>
date / time (UTC):   <timestamp>
cloudflare account:  <name + id from wrangler whoami>
worker versions (before):
  mca-accounts:              <version id>
  mca-multiplayer-staging:   <version id>
pages deployment (before):   <deployment id / url>
remote D1 migrations (before): <exact output of step 4>
```

---

## 2. Pre-flight on the machine

Run from the repository root, on the branch/commit that is meant to ship:

```bash
node -v
npm ci
npm run typecheck
npm test
npm run build
git status --short
```

Expected: typecheck exit 0, the full suite green (currently 190 files / 2,734
tests), build exit 0, and a tree whose dirty files are exactly the release you
intend to ship. `npm run release` refuses a dirty tree unless `--allow-dirty`,
which is intended for a hotfix preview, not a release.

Capture the worker versions you are about to replace:

```bash
npx wrangler deployments list --config account-wrangler.live.jsonc
npx wrangler deployments list --config mp-room-wrangler.live.jsonc
npx wrangler versions list --config account-wrangler.live.jsonc
npx wrangler versions list --config mp-room-wrangler.live.jsonc
```

Keep the active version ids — §9 needs them.

---

## 3. Confirm the target before touching it

### 3.1 The database is the one the config names

```bash
npx wrangler d1 list
npx wrangler d1 info mca-accounts
```

Compare the returned UUID with the `database_id` in
[`account-wrangler.live.jsonc`](../account-wrangler.live.jsonc), currently
`be396040-3bf1-4106-8aa1-581eaa9406bd`.

**If the UUID does not match, stop.** Everything after this point assumes the
config and the remote database agree; applying migrations to a database you did
not identify is the one mistake that cannot be undone by redeploying.

### 3.2 The secrets that should already exist

Names only — the values are never printed:

```bash
npx wrangler secret list --config account-wrangler.live.jsonc
npx wrangler secret list --config mp-room-wrangler.live.jsonc
```

The account Worker should list `GOOGLE_CLIENT_SECRET`,
`DISCORD_CLIENT_SECRET`, `MCA_IDENTITY_TICKET_SECRET`, `MCA_MP_RESULT_TOKEN`.
The room Worker should list `MP_ADMIN_TOKEN`, `MCA_RESERVATION_TOKEN`,
`MP_CAREER_TOKEN`, `MCA_IDENTITY_TICKET_SECRET`. Missing names are fixed in §6
before deploying, not after.

### 3.3 The room Worker's public identity

```bash
npx wrangler deployments list --config mp-room-wrangler.live.jsonc
```

Both room configs deploy the name `mca-multiplayer-staging`. That is
pre-existing and intentional (one Worker, two configurations), but it means
this deploy replaces whatever build is currently reachable at the public room
address, including a staging build. Note it in the change record.

---

## 4. Verify remote migration state (read-only)

This is the step that decides whether §5 runs at all.

```bash
npx wrangler d1 migrations list mca-accounts --remote --config account-wrangler.live.jsonc
```

Two possible outcomes:

- **`No migrations to apply!`** — 0001–0008 are already applied. Do not run the
  apply command at all; go to §6.
- **A numbered list of pending migrations** — the database is behind. Read the
  numbers, then continue with the checks below before applying.

Confirm the bookkeeping table agrees with the command's view:

```bash
npx wrangler d1 execute mca-accounts --remote --config account-wrangler.live.jsonc \
  --command "SELECT id, name, applied_at FROM d1_migrations ORDER BY id"
```

Expected after a complete run: eight rows, `0001_accounts` through
`0008_phase4e_unit_camo`, in order. A gap between the highest applied row and
the migrations list output is the signal that a previous run was interrupted.

Confirm the schema objects that should exist:

```bash
npx wrangler d1 execute mca-accounts --remote --config account-wrangler.live.jsonc \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
```

Compare against [`migrations/`](../migrations) rather than a memorised list:
every file in that directory must correspond to a row in `d1_migrations`.

Before any write, capture both a point-in-time marker and an export:

```bash
npx wrangler d1 time-travel info mca-accounts --remote
mkdir -p .dev/backups
npx wrangler d1 export mca-accounts --remote \
  --output .dev/backups/mca-accounts-<YYYY-MM-DDTHH-MM>.sql \
  --config account-wrangler.live.jsonc
```

The export contains account data. `.dev/` is gitignored; never commit, attach or
paste the file anywhere.

---

## 5. Apply pending migrations (only if §4 found pending work)

```bash
npm run accounts:migrate
```

which is:

```bash
npx wrangler d1 migrations apply mca-accounts --remote --config account-wrangler.live.jsonc
```

Run it interactively and read the list it prints before confirming. Wrangler
applies the migrations in filename order, captures a backup automatically, and
rolls back an individual migration if it errors while leaving earlier
successful ones applied. In a non-interactive CI context the confirmation step
is skipped, so do not run this in a pipeline that has not already passed §4.

What the current range does, in case the output needs interpreting:

| Migration | Change | Backward compatible with older code? |
| --- | --- | --- |
| 0001–0004 | accounts, career, identity/results, player flags | yes |
| 0005 | nullable identity-document columns | yes — old rows keep working |
| 0006 | achievements tables (additive) | yes |
| 0007 | campaign award tables (additive) | yes |
| 0008 | nullable unit-camo column | yes |

After it finishes, verify rather than trust:

```bash
npx wrangler d1 migrations list mca-accounts --remote --config account-wrangler.live.jsonc   # expect: no migrations to apply
npx wrangler d1 execute mca-accounts --remote --config account-wrangler.live.jsonc \
  --command "SELECT COUNT(*) AS applied FROM d1_migrations"                                   # expect: 8
```

If a migration fails: stop, keep the output, and inspect `d1_migrations` before
retrying. Do not re-run the apply command blindly against a partially applied
range, and do not edit an already-applied migration file — the checksum/name
record is what a later `migrations list` compares against.

---

## 6. Secrets

Seven distinct values, eight `secret put` operations because the identity ticket
secret is shared by both Workers.

| Secret | Worker(s) | Purpose | Notes |
| --- | --- | --- | --- |
| `GOOGLE_CLIENT_SECRET` | account | Google OAuth token exchange | Paired with the Google client id var |
| `DISCORD_CLIENT_SECRET` | account | Discord OAuth token exchange | Paired with the Discord client id var |
| `MCA_IDENTITY_TICKET_SECRET` | account **and** room | HMAC key that signs multiplayer identity tickets | **Must be identical on both**; rotate as a pair (§6.1) |
| `MCA_MP_RESULT_TOKEN` | account | Shared secret accepted on match-result intake | Must equal the room's `MP_CAREER_TOKEN` |
| `MP_CAREER_TOKEN` | room | Sent with the finished match report | Must equal `MCA_MP_RESULT_TOKEN` |
| `MP_ADMIN_TOKEN` | room | Admin routes (room diagnostics/close) | Independent value |
| `MCA_RESERVATION_TOKEN` | room | Authenticates capacity reservations between the account service and the room | Independent value |

Set them without putting the value on a command line (it would land in shell
history and process listings):

```bash
npx wrangler secret put GOOGLE_CLIENT_SECRET --config account-wrangler.live.jsonc
npx wrangler secret put DISCORD_CLIENT_SECRET --config account-wrangler.live.jsonc
npx wrangler secret put MCA_IDENTITY_TICKET_SECRET --config account-wrangler.live.jsonc
npx wrangler secret put MCA_MP_RESULT_TOKEN --config account-wrangler.live.jsonc

npx wrangler secret put MP_ADMIN_TOKEN --config mp-room-wrangler.live.jsonc
npx wrangler secret put MCA_RESERVATION_TOKEN --config mp-room-wrangler.live.jsonc
npx wrangler secret put MP_CAREER_TOKEN --config mp-room-wrangler.live.jsonc
npx wrangler secret put MCA_IDENTITY_TICKET_SECRET --config mp-room-wrangler.live.jsonc
```

Secrets survive `wrangler deploy`; re-run `secret list` afterwards so "it was set
last quarter" is not an assumption.

### 6.1 Rotating the identity ticket secret

Tickets are valid for two minutes. If the two Workers hold different keys, a
freshly minted ticket fails verification in the room (401 `invalid-identity`).
If the room's value is absent entirely, a ticket-bearing request gets 503
`identity-unavailable`.

Rotate the account Worker and the room Worker back to back, in the same window:

```bash
npx wrangler secret put MCA_IDENTITY_TICKET_SECRET --config account-wrangler.live.jsonc
npx wrangler secret put MCA_IDENTITY_TICKET_SECRET --config mp-room-wrangler.live.jsonc
```

Expect at most a two-minute window in which an already-issued ticket is
rejected; reconnect with a fresh page load picks up a new one. Matches already
started are unaffected — the room freezes seat identity at start.

### 6.2 Rotating the result token

`MCA_MP_RESULT_TOKEN` and `MP_CAREER_TOKEN` are one credential. Set both in the
same change window. A mismatch means finished matches deliver no career XP
(the room's delivery is rejected by the account service); the match itself and
its local result still behave normally, and delivery is retried rather than
double-counted.

---

## 7. Deploy, in this order

The order matters: the Pages Function needs the account Worker to exist, and the
room Worker needs the same ticket secret the account Worker mints with.

### 7.1 Account Worker

```bash
npm run accounts:deploy
```

This builds `dist-account` with `account-vite.config.ts` and deploys
`account-wrangler.live.jsonc`. Check the printed version id and route; capture
the id in the change record.

Before deploying, confirm the two OAuth facts in the live config:

- `APP_ORIGIN` and `ALLOWED_ORIGINS` are the Pages origin
  (`https://moderncombinedarms.pages.dev`), not loopback.
- `GOOGLE_CLIENT_ID` / `DISCORD_CLIENT_ID` are the clients that actually have
  `https://moderncombinedarms.pages.dev/api/account/auth/google/callback` and
  `.../discord/callback` registered. The ids currently committed in the live
  config belong to the development applications, which the architecture notes
  register for loopback only — **deployed sign-in will fail until production
  redirect URIs are registered on those clients or production client ids are
  put in the vars.** Guest play and multiplayer are unaffected by this.

### 7.2 Room Worker

```bash
npm run rooms:deploy
```

This builds `dist-mp-room` and deploys `mp-room-wrangler.live.jsonc`, which has
`MP_DEV_MODE` unset (no probe page, no loopback exemption) and
`MP_DEFAULT_MATCH_SECONDS=600`, `MP_MAX_MATCH_SECONDS=1800`.

Do not change the Durable Object migrations block. The tag `v1` and the two
class names are what bind this deployment to the existing namespace; renaming a
class or adding a new tag creates a new namespace and abandons every room that
exists.

### 7.3 Pages app

```bash
npm run release -- --dry-run     # validates version stamps, tests, builds; uploads nothing
npm run release                  # build, upload dist/, wait until the live site serves the new bundle
```

`npm run release` refuses a version/label mismatch between `package.json`,
`CHANGELOG.md` and the menu footer, runs the suite unless `--skip-tests`, and
polls the live site for up to 90 seconds until it serves the bundle it just
uploaded. A failure there is a real deployment failure, not a warning.

When the live site serves the new bundle, the same command tags that commit
`v<version>` (annotated, message `<version> BETA`, as every earlier tag was) and
pushes the branch and the tag together, so the tag cannot name anything but the
live build. `--allow-dirty` skips the tag, because no commit contains the shipped
files; commit first, then tag and push by hand.

After the first deploy of a new Pages project, the `MCA_ACCOUNT` service binding
must exist (Dashboard → Pages → Settings → Functions → Service bindings, or the
equivalent project configuration). Without it, `/api/account/*` answers 503
`Accounts are not configured on this deployment.` and the account UI reports the
service unavailable — guest play is unaffected.

---

## 8. Verify the deployment

Verify each unit over the address players actually use. Do not treat a
successful upload or a `200` on `/` as proof.

### 8.1 Account service, through Pages

```bash
curl -s https://moderncombinedarms.pages.dev/api/account/health
```

Expect:

```json
{"ok":true,"service":"mca-accounts","version":1,"providers":["google","discord"],"devMode":false}
```

- `devMode:false` is mandatory; a live deployment must never report `true`.
- `providers` lists the providers whose client id and secret are both
  configured; an empty array means sign-in is unavailable, not that the Worker
  is down.
- 503 with `server-error` is the missing `MCA_ACCOUNT` service binding.
- A direct `https://mca-accounts.<subdomain>.workers.dev/api/account/health`
  may answer 403 `forbidden-origin`: production admits only its configured app
  hosts. Use the Pages URL above; the 403 is not a deployment failure.

### 8.2 Room Worker

```bash
curl -s https://mca-multiplayer-staging.horsemeninteractive.workers.dev/api/multiplayer/health
```

Expect `onlineEnabled: true`, `devMode: false`, `adminConfigured: true`,
`reservationConfigured: true`, `protocol: "mca.v2"` and the build tag
`phase2b4-live`. A `false` is a secret that did not land
(§6), not a code problem.

### 8.3 App shell and CSP

```bash
curl -sI https://moderncombinedarms.pages.dev | grep -iE 'content-security-policy|x-frame-options|strict-transport-security'
```

`connect-src` must include the room Worker's `https:` and `wss:` origins; if the
room moved, `.env.production`, `public/_headers` and `MP_ALLOWED_ORIGINS` must
have moved in the same change. The multiplayer menu entry is enabled only when
the bundle was built with `VITE_MULTIPLAYER_URL`.

### 8.4 Two real accounts

Use two browser profiles (or one normal and one private window) and two distinct
signed-in accounts on the deployed origin:

1. Both sign in; confirm `/api/account/me` returns each account and the session
   cookie is `HttpOnly`, `Secure`, `SameSite=Lax`.
2. Account A hosts, B joins with the code, both pick nation/colour, both ready,
   A starts. Confirm each sees the other's callsign and frame/background, and
   that the match duration is the configured default (600 s) rather than 60 s.
3. Refresh B mid-match and confirm reconnect restores the same seat and the
   same frozen identity.
4. Let a match reach at least 180 s and finish (the reward floor is
   `MP_MIN_DURATION_SECONDS`). Confirm career XP and any achievement appear for
   both accounts. A match shorter than 180 s is not eligible and is not a
   failure.
5. Sign out; confirm `/api/account/me` reports `authenticated: false` and the
   cookie is cleared.

Record room code, timestamps, which account received XP, and any console/network
error. If you cannot run step 4 in the window, say the award path was not
verified rather than implying it was.

---

## 9. Rollback

### 9.1 Workers

```bash
npx wrangler versions list --config mp-room-wrangler.live.jsonc
npx wrangler rollback <version-id> --config mp-room-wrangler.live.jsonc

npx wrangler versions list --config account-wrangler.live.jsonc
npx wrangler rollback <version-id> --config account-wrangler.live.jsonc
```

Roll the room Worker back only to a version with the same Durable Object
namespace/class set. Rolling back the account Worker does not roll back the
schema, which is intentional: every migration in 0001–0008 is additive
(nullable columns or new tables), so the previous code keeps working against the
new schema. No down migration exists and none is needed for a code rollback.

### 9.2 Pages

Roll back in the Pages dashboard to the previous deployment, or re-run
`npm run release` from the last known-good commit/tag. A Pages rollback does not
touch the Workers, so check that the old bundle's `VITE_MULTIPLAYER_URL` and
`connect-src` still match the currently deployed room Worker.

### 9.3 Data

Schema restore is not part of a normal rollback. If data was damaged, take an
export first, then use D1 Time Travel (`wrangler d1 time-travel restore`) to the
marker captured in §4. Time Travel restores the whole database; it is not a
per-table undo.

---

## 10. Change record

Fill this in and keep it with the release evidence:

```
[x] §2 typecheck / tests / build green at commit ............ <sha>
[x] §3 D1 UUID matched live config .......................... <uuid>
[x] §4 migrations list before ............................... <output>
[x] §5 migrations applied ................................... <none | 000x..000y, timestamps>
[x] §5 migrations list after ................................ No migrations to apply
[x] §6 secrets present on both Workers (names only) ......... yes/no + exceptions
[x] §7 account Worker version ............................... <id>
[x] §7 room Worker version .................................. <id>
[x] §7 Pages deployment ..................................... <url/id>
[x] §8.1 health through Pages ............................... devMode=false, providers=...
[x] §8.2 room health ........................................ online/admin/reservation true
[x] §8.3 CSP connect-src includes room origin ............... yes/no
[x] §8.4 two-account match + reconnect ...................... pass/fail, notes
[x] §8.4 award at >=180 s ................................... pass/not run
```

---

## 11. Troubleshooting

| Symptom | Likely cause | Check / fix |
| --- | --- | --- |
| `/api/account/*` returns 503 "Accounts are not configured on this deployment." | Pages has no `MCA_ACCOUNT` service binding | §7.3; add the binding, redeploy Pages |
| Health responds but sign-in redirects back with `redirect_uri_mismatch` | Provider client has no production callback registered | Register `https://moderncombinedarms.pages.dev/api/account/auth/<provider>/callback`, or set production client ids in the live vars |
| Room request 403 `forbidden-origin` | Page origin not in `MP_ALLOWED_ORIGINS` (or a preview host not matched by the wildcard) | Add the exact origin, redeploy the room Worker |
| Room returns 503 `identity-unavailable` | `MCA_IDENTITY_TICKET_SECRET` missing on the room Worker | §6; set it to the account Worker's value |
| Room returns 401 `invalid-identity` | Ticket expired (>2 min), tampered, or the two Workers hold different ticket secrets | §6.1; reload the page for a fresh ticket, align the secrets |
| Browser console: refused to connect to the room (CSP) | `connect-src` missing the room `https:`/`wss:` origin | Edit `public/_headers`, rebuild/release |
| Multiplayer menu entry is dimmed | bundle built without `VITE_MULTIPLAYER_URL` | Set it in `.env.production`, `npm run release` |
| Match ends with no career XP | Duration under 180 s, result token mismatch, or `MP_CAREER_URL` wrong | Check `MP_MIN_DURATION_SECONDS` floor, §6.2, and `MP_CAREER_URL` in the live room config |
| `wrangler d1 migrations list` disagrees with `d1_migrations` rows | A previous apply was interrupted, or the config points at a different database | Re-run §3.1 and §4 before doing anything else |

---

## 12. Deliberately not automated

The repository has no CI deploy job, no committed credentials and no script that
applies remote migrations. `npm run deploy`-style shortcuts were not added: the
migration verification in §4 is a decision point that needs a human reading its
output, and rotating the shared ticket secret is a two-Worker operation that a
single command would hide.
