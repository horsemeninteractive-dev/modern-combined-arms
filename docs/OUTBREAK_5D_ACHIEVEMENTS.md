# Outbreak 5D — Achievements and Lifetime Records (audit and design)

Date: 2026-11-26
Build audited: MCA 0.11.1 BETA, working tree at `874ac64` (release tag `v0.11.1`).
Scope: P2.7 / Phase 5D of `docs/OUTBREAK_PHASE_1_AUDIT.md` — "Outbreak has no
achievements or lifetime records, only the leaderboard's own row."

This is the audit and the design. No game code is changed by this document, and
no threshold below has been played against a real run.

**Method.** Read `src/accounts/achievements.ts`, `career.ts`, `careerService.ts`,
`localAchievements.ts`, `stats.ts`, `outbreakBoard.ts`, `router.ts`
(`submitOutbreakRun`, `careerAchievements`), `d1Store.ts` and `memoryStore.ts`
for the Outbreak and achievement ports, `migrations/0006` and `0009`/`0011` for
the storage shape, `src/ui/careerView.ts` and `src/ui/awards.ts` for display, and
`src/app.ts` (`postOutbreakRun`, `showOutbreakResults`, `recordEndCareer`) for
the run-end path. Nothing was inferred from a completion note.

---

## 1. What exists today

| Piece | Where | Shape |
| --- | --- | --- |
| Definitions | `src/accounts/achievements.ts` | 42 achievements over 7 category values (`operational` is declared but unused), one `requirement` each, awards derived from definitions |
| Evaluation | same file | `pendingAchievementIds(context)`, a pure function over career totals, grouped stats, the current match facts and earned ids |
| Account awards | `router.ts` `careerAchievements` | runs after a validated match writes its ledger row; inserts are unique on `(account_id, achievement_id)` |
| Guest awards | `localAchievements.ts` | same evaluator over the browser ledger; persisted in `localStorage` |
| Storage | `migrations/0006` | `career_achievements` with a nullable `match_ref` |
| Display | `careerView.ts`, `awards.ts`, `commanderLegacy.ts` | commendation list grouped by category label, procedural medal/ribbon/commendation art from a `visual` token |
| Outbreak record | `migrations/0009`, `0011` | `outbreak_runs`, **one row per (account, map, mode, difficulty): the best run only** |
| Outbreak run end | `app.ts` `showOutbreakResults` → `postOutbreakRun` → `POST /outbreak/runs` | posts the board row and one career ledger row |

Two facts about the current pipeline matter more than any other.

**Outbreak pays career XP and nothing else.** `showOutbreakResults` still returns
before `recordEndCareer`, but `submitOutbreakRun` now writes one career ledger
row per run (`mode: 'outbreak'`, the run's own difficulty, `defeat`), so rank,
level and the service record advance from the same sums as every other
operation. `career.ts` `outbreakCareerXp` decides the award from the waves held
and the infected killed — both capped, scaled by the mode's difficulty — and the
ledger key is the run itself, so a retry or an identical replay pays once, and
the day is capped at `MAX_CAREER_MATCHES_PER_DAY` XP-paying runs, so varied or
forged posts cannot farm rank levels. No match report is written: a survival run
has no opponent, objectives or structures destroyed, and `career_match_details`
is untouched. A player who
reaches wave 40 on Nightmare now has the board row and the career entry.

**The stored run is a best, not a history.** `saveOutbreakRun` upserts only when
the candidate beats the stored row (`ON CONFLICT … WHERE excluded.wave > …`), and
`compareOutbreakRuns` is the same ordering the board uses. Every run that is not
a new best is discarded at the write. There is no table of runs, no totals row,
no per-account counters.

---

## 2. Why Outbreak cannot ride the career pipeline

Five concrete blockers, in the order an implementer would hit them:

1. **`CareerMode` had no Outbreak.** `career.ts` defined
   `campaign | skirmish | multiplayer` and `careerXp` keys `BASE_XP` on that
   union. Outbreak is now in the type — `CAREER_MODES`, the list
   `parseCareerMatch` validates against, still refuses it, so a survival result
   cannot arrive through `/matches` — and migration `0012` widened the ledger's
   `mode` and `difficulty` checks. Its award is `outbreakCareerXp`, not the
   decided-match formula, because an unbounded survival mode must not pay by
   length.
2. **`AchievementMatchFacts` requires a victory model.** Every match condition
   opens with `if (match.outcome !== 'victory') return false`, and an Outbreak
   run has no victory — the Command Post always falls. The record has no
   `outcome` at all.
3. **Every `Metric` reads career aggregates.** `metricValue` switches over
   `stats.modes[...]` / `totals`, all of which are folded from the XP ledger.
   An Outbreak figure has no path into either.
4. **There is no lifetime figure to read even if the metric existed.** Best-only
   storage cannot answer "waves held in total" or "runs played"; those numbers do
   not exist anywhere in the account.
5. **The run arrives from the client, not from the room.** `submitOutbreakRun`
   validates a plausibility envelope (`parseOutbreakRun`) and then trusts it.
   There is no replay or room authority behind an Outbreak claim, unlike the
   multiplayer result intake.

Blockers 1–3 are mechanical: they say where the code goes. Blockers 4–5 are the
design constraints: they say which achievements are honest.

---

## 3. Design constraints that follow

- **Measured per run, not accumulated.** Because only a best is stored and
  because wave 1 is infinitely replayable, any cumulative counter ("kill 5,000
  zombies") rewards padding a low wave rather than surviving a high one. Every
  requirement below is a fact of a single run, which is also exactly what the
  best-row table can hold and what the board already ranks.
- **No reward for losing things.** `structuresLost` and `unitsLost` are in the
  record; they are only ever used as an *absence* ("without losing a
  structure"), never as a target.
- **No victory condition.** The run's own clock is the wave held, so the ladder
  is waves, not wins.
- **Mode-neutral.** Solo and duo are separate boards because two commanders are
  not one, but an award is one account's record. Every requirement below is
  satisfied by either mode; a per-mode variant would double the set for no new
  decision, and requiring solo would penalise the duo player the mode was built
  for. The earning run's mode is recorded, not required.
- **No cosmetics.** Career awards gate two cosmetics and sit beside a paying
  ledger. An Outbreak award must gate nothing: its supporting claim is a
  client-reported run, and the envelope does not stop a hand-written POST
  claiming fifteen waves. A medal on your own service record is the proportionate
  ceiling. The XP a run pays is bounded by the caps and the once-per-run ledger
  key, so an award must not add a second reward on top of it.
- **Account-only.** The board is account-only, so the awards are too. A guest's
  Outbreak achievements would need a second local evaluator and a local store
  that the guest ledger does not have; that is a separate decision, and the card
  already tells a guest to sign in to post.

---

## 4. The proposed set

Four achievements, one category, no new storage.

| id | Name | Tier | Requirement | Why it is here |
| --- | --- | --- | --- | --- |
| `outbreak-first-watch` | First Watch | bronze | Hold 5 waves in one run | The mode's entry point. Reachable on a first Easy run; it is how a player learns Outbreak has a record at all. |
| `outbreak-standing-wall` | Standing Wall | silver | Hold 15 waves in one run | The depth step. Wave 15 on Normal is a real half-hour defence and is where the pressure curve, the composition ramp and the recovery decay all have to be understood. |
| `outbreak-unbroken-line` | Unbroken Line | silver | Hold 10 waves in one run without losing a structure | The only one that asks for a *quality* of play rather than a duration. It is the defensive counterpart of the career's "Flawless Victory", and it is per-run, so it cannot be padded. |
| `outbreak-nightmare-watch` | Nightmare Watch | gold | Hold 10 waves in one run on Nightmare | Mastery on the mode's own hardest terms: specials from the opening waves, six approach axes, minimum recovery. This is the one worth putting on the record. |

Properties of the set:

- **Each is a wave count or a wave count plus one condition.** No new subsystem,
  no new state, no new metric family — one requirement kind with two optional
  qualifiers.
- **All four are solo/duo neutral.** The two that are hardest to reach
  (Standing Wall, Nightmare Watch) are thresholds, not mode flags, so a duo pair
  and a solo commander chase the same ladder on their own boards.
- **Backfillable from what is already stored.** Every one of them is a predicate
  over the stored best rows: a 20-wave best on the basin implies First Watch,
  Standing Wall, and (if it lost no structure) Unbroken Line; the Nightmare board
  implies Nightmare Watch. Nothing has to be invented for a player who already
  has a record.
- **One category, four awards.** `category: 'outbreak'`, award type gold → medal
  and silver/bronze → ribbon, matching the campaign/career rule rather than the
  default commendation.

### Rejected candidates, and why

| Candidate | Rejected because |
| --- | --- |
| Kill N zombies (total or in a run, tiered) | `zombiesKilled` is already the board's third tiebreak, and a total is the most farmable figure the mode has. A per-run kill count would also just restate the wave. |
| Kill N brutes / bloaters / crawlers | Per-kind kills exist in the simulation and on the results card but **not** in `OutbreakRunInput`; earning one would need a new submitted field, i.e. a wider trust surface for a narrower achievement. |
| Reach wave 25 / 40 | A second threshold with no new idea behind it. One depth step, one mastery step, then stop. |
| Win a run | The mode has no win. The Command Post falling *is* the end. |
| Highest wave on every map | Four maps × two modes × four difficulties is a checklist, not an achievement, and it would award map completion for a mode where maps are interchangeable ground. |
| Co-op only / solo only | Breaks the "solo and 2-player co-op equally important" rule. |
| Cosmetic unlock | Unearned trust: the run is client-reported. |

---

## 5. Lifetime records: the smallest honest version

The audit item names two gaps. The achievements need no new table; a *record*
does, but less than it seems:

- **Best per board is already a lifetime record.** `outbreak_runs` holds one row
  per (map, mode, difficulty), so "best wave on each board", "boards played" and
  "best nightmare run" are a single indexed read, `WHERE account_id = ?`. That is
  the summary the career screen needs, and it costs one store method, not a
  migration.
- **Totals across runs are the only missing thing**, and they are precisely the
  numbers that reward padding. The recommendation is therefore: **do not add a
  totals table.** Show the best-of record, and let the boards be the history.

So 5D's storage change is a read, not a write:

```
outbreakRuns(accountId) -> OutbreakRunRecord[]   // every best row, newest first
```

and a derived `OutbreakCareerSummary { runs, bestWave, wavesHeld, bestByDifficulty }`
for the service record. If a later phase wants true totals (runs played, all-time
kills), that is a new `outbreak_career` row upserted in `submitOutbreakRun` — a
decision to take on its own, not a prerequisite for the awards.

---

## 6. Implementation plan (not done here)

1. **Vocabulary** — `src/accounts/achievements.ts`
   - `AchievementCategory` gains `'outbreak'`; `ACHIEVEMENT_CATEGORY_LABEL`
     gains `outbreak: 'Outbreak'`.
   - `AchievementContext` gains `outbreak?: readonly OutbreakRunFacts[] | null`
     with `OutbreakRunFacts { map, mode, difficulty, wave, wavesCompleted,
     zombiesKilled, structuresLost, unitsLost, durationSeconds }` — the stored
     best rows already carry every field.
   - One requirement kind:
     `{ kind: 'outbreak'; condition: { kind: 'outbreak-waves'; minimumWaves:
     number; difficulty?: OutbreakDifficulty; withoutStructureLoss?: boolean } }`
     and `qualifies` / `progressOf` read it as "any stored run satisfies it".
     Progress is `max(wavesCompleted)` over qualifying runs, so the career screen
     shows a real bar. Take `OutbreakDifficulty` and the difficulty list from
     `outbreakBoard.ts` (type-only import), not from `outbreak/config.ts`: the
     account Worker must not pull the simulation's tuning table into its bundle,
     which is why the board module lists its maps by hand.
   - Four definitions at `order` 400–403, with `award: { type: 'medal' | 'ribbon' }`
     and commendations named for the mode.
2. **Server** — `router.ts`
   - `submitOutbreakRun`: after `saveOutbreakRun`, evaluate the same
     `pendingAchievementIds` with the new `outbreak` facts (the just-submitted run
     plus the stored bests), insert with `matchRef = null` — there is no career
     row to attach it to — and return `awards: AchievementSummary[]` beside
     `improved` and the board.
   - `careerView`: pass the account's best rows into the achievement context so
     progress and a **one-time backfill** of existing records both work, and the
     guest path passes `[]`.
3. **Store** — `types.ts` + `d1Store.ts` + `memoryStore.ts`: one read,
   `outbreakRuns(accountId)`.
4. **Client** — `client.ts`: `submitOutbreakRun` returns `awards`; `app.ts`:
   append `AWARD · ${award.name}` to `#outbreak-results-note` and queue the same
   `notify` the career path uses.
5. **Display** — no change needed beyond the label: `careerView` renders any
   category through the label map, and award art already derives from the
   `visual` token. Do not gate a cosmetic on these.
6. **Tests** — `tests/phase4d-legacy.test.ts` and `tests/phase4c-career.test.ts`
   assert the catalogue's invariants (`AWARDS` unique and one per achievement,
   every `visual` non-empty, ≥42 definitions), so they keep passing; add
   coverage for (a) each of the four at its exact threshold and one wave below,
   (b) a stored best that predates the feature being backfilled once and only
   once, (c) a replayed submission returning no second award, (d) solo and duo
   both qualifying, (e) the guest context with no Outbreak facts awarding none.
7. **Docs** — a 0.11.2 changelog entry, and P2.7/5D marked done in
   `docs/OUTBREAK_PHASE_1_AUDIT.md` when the code lands.

Rough size: one requirement kind and four definitions in `achievements.ts`, about
forty lines in `router.ts`, one store read in three files, ten lines in the
client/app, and one test file.

---

## 7. Risks and open questions

- **The claim is client-reported.** All four awards inherit the leaderboard's
  trust model. `MIN_SECONDS_PER_WAVE = 8` bounds a forged run to two minutes for
  fifteen waves, so a scripted POST can earn them all. The career XP pays from the
  same claim, so a forged run also earns XP — bounded by the per-run caps, the
  derived ledger key (each distinct result pays once), the endpoint's 30
  submissions per hour and a daily ceiling of sixty XP-paying runs, but not
  bounded by the simulation. A day of forged posts is therefore about two hours
  of the endpoint limit and at most a level or two, not a rank ladder. Accepted
  because the awards gate nothing; if a cosmetic or a rank wall ever depends on
  Outbreak, the run must be replayable server-side first.
- **The thresholds are unplayed.** 5 / 15 / 10-clean / 10-Nightmare are reasoned
  from the difficulty table (Nightmare's first 10 waves put five archetypes and
  up to four approach axes on the field), not measured. They are four numbers in
  one file and should be tuned after a few real runs, not defended.
- **Duo may be materially easier.** If duo boards show a 40 % higher median wave,
  the ladder should split by mode — the requirement kind already has room for a
  `mode` qualifier, so that is a data change, not a redesign. It should be
  decided from board data, not guessed now.
- **Guests get none of this.** Consistent with the board, visible to the player
  as "sign in to post", but it is a parity gap and belongs in the 5D note rather
  than being discovered as a bug.
