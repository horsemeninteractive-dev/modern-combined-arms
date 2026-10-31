# Tactical Submarine and Frigate ASW

**Status:** implemented and covered by automated tests. No human playtest has
been performed.

This phase adds one playable hull, one counter-hull weapon set and the
supporting simulation, presentation and AI behaviour. It does not change land
combat, the economy, aircraft or the existing shipyard roster rules.

## 1. What the player gets

| Item | Value |
|---|---|
| Attack Submarine | 820 HP, 1080 mats / 280 req, 32 s build |
| Hull speed | 2.7 tiles/s surfaced, 62% while dived |
| Vision | 9 tiles |
| Torpedo load | 4 heavyweight torpedoes, reloaded at the shipyard |
| Battery | 45 s dived endurance; 1.0 s/s drain, 1.6 s/s recharge |
| Launch datum | 6 s exposed after firing; a depth-charge hit exposes for 3 s |
| Periscope detection | 4.5 tiles, even without sonar |
| Torpedo | 95 damage, 8-tile range, 14 s reload, naval-only, runs at the waterline |
| Escort Frigate | existing hull, now carries sonar 12 and depth charges |
| Depth charges | 85 damage, 3.4-tile range, 3.5 s reload, splash 1.4, ASW-only |

The submarine is produced from the shipyard after the corvette and before the
frigate. The frigate is not a new hull; its existing weapons array gains the ASW
set and its description, production role and AI use now reflect that.

## 2. Dive state

`SubmarineState` is authoritative simulation state and is saved:

```ts
interface SubmarineState {
  dived: boolean;
  battery: number;
  maxBattery: number;
  revealTimer: number;
  revealed: boolean;
}
```

- `D` or the **DIVE** command toggles the selected boats.
- Diving is refused below 20% battery with an `orderFailed` warning.
- A dived boat burns battery, is forced to the surface at zero and emits an
  `alert`. A surfaced boat recharges; a full recharge takes about 28 s.
- Diving does not cancel movement, so a boat can run under while repositioning.
- Old saves without submarine state are hydrated from the definition; malformed
  battery values are clamped rather than trusted.

## 3. Detection and reveal-on-launch

`refreshVision` treats a dived submarine differently from every other unit:

1. A launch datum (`revealed`) exposes it to both teams while the timer runs.
2. A frigate's passive sonar (12 tiles) detects it through fog.
3. Otherwise only a hostile within 4.5 tiles sees the periscope.
4. Terrain concealment is irrelevant while dived.

A launch calls `revealSubmarine` immediately, before the next half-second vision
refresh, so the muzzle flash and torpedo are not hidden by stale visibility. A
dived boat that is not revealed cannot be targeted by ordinary guns or missiles;
depth charges are the exception. A revealed boat can be engaged by ordinary
weapons for the datum window.

This is intentionally a cycle, not permanent stealth: firing gives the enemy a
short answer window, and running out of battery gives them a longer one.

## 4. Torpedo and depth-charge resolution

- Torpedoes are `projectile: 'torpedo'`, `homing`, `underwater`, naval-only and
  use the existing projectile interpolation and wake trail. They do not arc.
- `impact()` skips a non-ASW weapon against a dived and unrevealed boat.
- `impact()` skips an ASW weapon against anything that is not dived, so depth
  charges are not a second short-range anti-ship gun.
- A depth-charge blast that damages a dived boat sets a 3 s datum.
- Depth-charge detonations use the existing water-impact presentation (spray
  and foam), so the ASW explosion reads as a water column rather than a land
  fireball.
- `chooseWeapon` explicitly prefers an ASW weapon when the target is dived, even
  if the frigate still has anti-ship missiles. Without that preference an
  escort spends its missile rack on a periscope and leaves its depth charges
  unused until the rack is empty.

## 5. AI hunting

`manageNaval` now has two explicit behaviours:

- **Escort hunting.** A ship carrying an ASW weapon treats a visible dived
  submarine within 24 tiles as its first target and orders an attack. Sonar
  contacts are in the AI's visible set, so this is a real hunt rather than a
  reaction to an already-revealed boat.
- **Submarine target choice.** An AI submarine scores surface targets by hull
  HP and discounts sonar hulls by 800 points. It still attacks a lone frigate,
  but prefers a corvette or transport when both are available. It dives when a
  hostile warship is visible within 16 tiles and its battery is above 10 s.
- **Production.** An AI that has seen hostile naval units buys one submarine;
  once it has seen hostile naval units and can afford it, it also buys a
  frigate as an ASW answer. Enemy air remains the other reason to buy one.

## 6. Presentation and UI

- The submarine mesh has a hull, sail, periscope, deck details and a wake. While
  dived, only the periscope is drawn; the boat remains pickable through the
  normal entity selection path.
- The HUD status line reports `SUBMERGED <seconds>`, `DATUM EXPOSED` or
  `SURFACED <percent>`.
- The command bar has a **DIVE** button and `D` hotkey. Selection, move, attack
  and unable-to-comply radio barks exist for the submarine in the unit voice
  set (`am_santa`, 4 clips).
- Torpedoes use the `torpedo` combat-fx profile: a cool white wake, a low
  waterline projectile and a water-impact explosion.
- Depth charges use the existing shell profile and the water-impact path. No new
  particle system or draw submission was added.

## 7. Files touched

Simulation and data:

- `src/data/units.ts` — submarine definition, frigate sonar/ASW loadout.
- `src/data/weapons.ts` — `torpedo`, `depthCharge`.
- `src/data/buildings.ts` — submarine in the shipyard production list.
- `src/sim/types.ts` — `SubmarineDef`, `SubmarineState`, `asw`/`underwater`,
  `dive` command.
- `src/sim/game.ts` — dive command, battery, sonar vision, launch datum,
  underwater impact rules, AI production hooks, save hydration.
- `src/sim/combat.ts` — submarine targetability rules.
- `src/sim/ai.ts` — ASW hunting, submarine target scoring, frigate production.

Presentation and UI:

- `src/render/unitMeshes.ts` — submarine hull and periscope.
- `src/render/renderer.ts` — periscope-only submerged drawing.
- `src/render/combatFx.ts` — torpedo profile and visibility handling.
- `src/ui/hud.ts`, `src/ui/input.ts`, `src/ui/icons.ts`, `src/app.ts` — dive
  status, button, hotkey and command.

Tests and content:

- `tests/submarine.test.ts` — 11 focused tests.
- `tests/naval-roster.test.ts`, `tests/roster-visual-pass.test.ts`,
  `tests/combat-feedback.test.ts` — roster, mesh and effect coverage.
- `tools/unit-voice/lines.json`, `public/audio/unit-voice/manifest.json` and the
  generated submarine clips.

## 8. Verification

Run on 2026-10-29:

- `npx tsc --noEmit` — pass.
- `npx vitest run tests/submarine.test.ts` — 11/11 pass.
- `npx vitest run` — 741/741 pass across 67 files, including the AI matchup
  matrix.
- `npm run build` — pass (Vite production bundle; only the pre-existing
  >500 kB chunk-size advisory).

The focused tests cover: shipyard entry and stats; dive, battery drain, low-battery
refusal and forced surfacing; hidden-vs-close detection; launch datum; sonar
detection by a frigate but not a corvette; torpedo damage; depth-charge damage;
ASW weapon preference while missiles remain; save round-trip of dive state; AI
escort hunting a sonar contact; AI submarine target preference.

## 9. Limitations

- No human playtest has judged whether the periscope, datum, torpedo wake and
  depth-charge splash are readable at normal battle zoom. The automated tests
  prove connectivity, not recognition.
- There is no dedicated sonar-ping visual or audible cue. A sonar contact is
  communicated through the existing contact/visibility and "Enemy detected"
  notice.
- A dived submarine has no charted silhouette and leaves no wreck; it is a
  periscope while dived and a water splash when destroyed.
- The AI hunt is deterministic and tested in a synthetic fleet setup, not over a
  long campaign where a player repeatedly changes course and dives.
- The phase deliberately does not add active sonar, submarine-launched
  anti-ship missiles, torpedo decoys or a new naval building.
