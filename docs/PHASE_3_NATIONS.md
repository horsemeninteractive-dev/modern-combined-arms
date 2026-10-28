# Phase 3 — Nation Selection and Nation-Aware Match Setup

> Historical: this document records the identity phase. The roster statement
> below (all six nations sharing the Phase 2 baseline) was superseded by Phase 4;
> see [PHASE_4_NATIONS.md](PHASE_4_NATIONS.md).

Status: implemented on the current working tree. A skirmish now starts with an
explicitly selected nation, that id is carried through the scenario, the battle
state, production and save/load, and both the brief and the HUD name the nation
and its alliance. All six nations still share the Phase 2 baseline roster, so
this phase changes identity plumbing and not balance.

## Identity flow

Before this phase:

```
menu settings ──> built-in map scenario (players fixed to baltic/expeditionary)
              ──> Game state (factionId copied through)
              ──> presentation looked up FACTIONS[factionId] only
production    ──> BUILDINGS[].productionList + UNITS[].producedBy (faction-blind)
```

After this phase:

```
nation picker ──> AppSettings.nationId
              ──> deployScenario(): clone the theatre, stamp player 0 with the
                  nation and player 1 with the opposing alliance's default nation
              ──> Scenario.players[].factionId (validated by isKnownFactionId)
              ──> PlayerState.factionId (canonical in battle and in saves)
              ──> Game.rosterFor(owner) -> resolveRoster(factionId)
              ├─> productionStatus(): roster membership before facility checks
              ├─> placementStatus():  roster membership before placement checks
              ├─> HUD production and build cards (same rule, same status calls)
              ├─> AI production/construction (same status calls)
              └─> brief, loading screen, rail, selection panel, overlays,
                  relay meter, renderer team colours, end screen
```

`ScenarioPlayer.factionId` / `PlayerState.factionId` remain the only canonical
identity fields. Alliance membership is never stored: it is read from the
registry with `identityAlliance()`, so a player cannot be one nation and another
nation's ally. Legacy `baltic` and `expeditionary` are still valid ids, still
resolve to their alliance baseline and are never rewritten into a nation.

## Selection and presentation

- The skirmish panel has a **YOUR NATION** selector with the six playable
  nations grouped under their alliances. Legacy presets are not offered for a
  new skirmish; they remain valid for maps, the editor and old saves.
- The opponent is the first nation of the other alliance
  (`defaultOpponentNation`), so every match has one nation per side. It is shown
  on the brief, the loading screen and in the HUD when selecting its units.
- The selection is saved in `iron-tide.settings.v1`; a reload keeps it. A map
  change keeps it (only the theatre changes). An invalid or alliance id in the
  saved settings falls back to the first playable nation.
- The mission brief shows COMMAND (nation), FORMATION (nation task force),
  OPPOSITION (AI nation) and ALLIANCE (player alliance).
- The loading screen reads the stamped scenario, not the menu settings, so an
  editor launch or a restarted battle names the side it is actually fought as.
- The desktop rail shows the nation short name with the alliance in its title.
  The touch top strip carries a compact nation label, hidden when the strip is
  too narrow. Selection, hover, relay and end-screen copy all use registry
  labels, including the objective line ("Destroy the Russia Command Post.").
- The editor inspector has a per-player faction selector with the six nations
  grouped by alliance plus the legacy presets. Changing it updates the dot and
  the autosaved scenario JSON; an existing legacy value is preserved unless the
  author changes it.

## Where `resolveRoster` is authoritative

`Game.rosterFor(owner)` calls `resolveRoster(player.factionId)`. Two thin
helpers, `Game.canProduce` and `Game.canBuild`, test membership through
`rosterIncludes`. `productionStatus` rejects a def outside the roster before it
checks the facility list, cost or queue, and `placementStatus` rejects a
structure outside the roster before cost or terrain checks. The HUD production
list filters by the same roster and still calls `productionStatus` for every
card, and the build panel filters `BUILDABLE_BY_PLAYER` the same way. The AI
already produced and placed through those two status calls, so it inherits the
rule without a second code path.

Because every nation's roster currently equals the shared baseline, gameplay is
unchanged: a deterministic 30-second run as `lithuania`/`russia` hashes the same
as `baltic`/`expeditionary`, and the AI ladder margins are unchanged.

## Save, load and legacy compatibility

- `PlayerState.factionId` was already saved; no save schema change and no
  version bump. `Game.fromSave` now validates every saved player's faction id
  and throws `SaveFormatError` for an unknown one instead of resolving a
  fallback roster mid-battle.
- Scenario parsing already rejected unknown faction ids; it still does.
- A new save round-trips each of the six nations, keeping `factionId` in both
  `state.players` and `scenario.players`.
- Legacy `baltic`/`expeditionary` saves load with their original identity and
  roster; they are not upgraded to a nation.
- Phase 2's `repairTargetId` and lobbed-shell fields are untouched.

## Files changed

| File | Change |
| --- | --- |
| `src/data/factions.ts` | `IdentityDef`, `tryIdentityDef`, `identityDef`, `identityAlliance`, `identityLabel`, `PLAYABLE_NATION_IDS`, `defaultNationFor`, `opposingAllianceId`, `defaultOpponentNation`. |
| `src/data/roster.ts` | `rosterIncludes` membership helper. |
| `src/sim/game.ts` | `rosterFor`, `canProduce`, `canBuild`; roster gates in production and placement; save faction validation. |
| `src/sim/scenario.ts` | Objective copy uses `identityLabel`; no longer imports `FACTIONS`. |
| `src/app.ts` | `nationId` setting, selector, `deployScenario`, nation-driven brief/loading; formation stamping. |
| `index.html` | Nation picker, COMMAND/FORMATION/OPPOSITION/ALLIANCE rows, loading facts. |
| `src/ui/hud.ts` | Registry identity in rail, selection, build/production lists, objective, end screen; mobile nation label. |
| `src/ui/overlay.ts`, `src/ui/relayMeter.ts`, `src/render/renderer.ts`, `src/ui/editorRender.ts` | Registry colour/label lookups and team-based minimap marks instead of `factionId === 'expeditionary'`. |
| `src/ui/editor.ts` | Per-player faction selector and persistence. |
| `src/style.css` | Nation picker, editor faction select, mobile nation label. |
| `tests/nation-setup.test.ts` | 16 tests covering identity, scenario/state propagation, roster gates, production, save/load, legacy compatibility and determinism. |

## Remaining hard-coded faction assumptions

- `factionDef(id)` in `src/data/factions.ts` still falls back to `FACTIONS.baltic`
  for an unknown id. It is no longer used by gameplay or presentation (only its
  Phase 1 tests); new code should use `tryIdentityDef`/`identityDef`.
- Built-in maps author `baltic`/`expeditionary`. That is intentional: they are
  the legacy scenario identities, and a nation deployment stamps over them at
  deploy time.
- The UI's static help copy still mentions the Kestrel Bay beachhead and the
  "11th Expeditionary Corps" in the briefing modal. It is map-flavoured help
  text, not an identity source; in-match objective, end-screen and side labels
  are registry-driven.

## Verification

| Check | Command | Result |
| --- | --- | --- |
| Typecheck | `npx tsc --noEmit` | clean |
| Focused suite | `npx vitest run tests/nation-setup.test.ts` | 16 passed |
| Full suite | `npx vitest run` | see §37 of `docs/VERIFICATION_REPORT.md` |
| Build | `npm run build` | see §37 |

Browser check (Chromium viewport, dev server): selected Poland in the skirmish
panel, confirmed the brief and loading screen named Poland/Russia/Defender
Coalition, deployed and saw `POLAND · Defender Coalition` in the command rail,
saved slot 1 and confirmed `state.players[0].factionId === 'poland'` with the
scenario retaining `poland`/`russia`, then loaded the slot and saw the rail and
objective restored as Poland. The editor autosave kept a player changed to
Hungary. Simulation-dependent steps (producing units, advancing the battle)
could not be exercised in that browser because the preview viewport is treated
as a touch portrait device: the orientation gate holds the battle paused.

## Deferred

National units, substitutions, upgrades and production gating remain Phase 4.
The roster contract already supports them through `NationRosterModifications`;
no new architecture is needed. A faction-aware loading/menu takeover (national
insignia, briefing voice) was not added.
