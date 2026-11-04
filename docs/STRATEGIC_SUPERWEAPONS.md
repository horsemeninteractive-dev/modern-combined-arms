# Strategic superweapons

Nation-specific strategic capabilities, unlocked through infrastructure and
research and called in from outside the battlefield. They are not units and not
structures that fire: a Strategic Operations Centre authorises a call-in, and the
strike is executed by off-map assets.

## Capabilities

| Family | Role | Targeting | Cost | Reload | Warning |
|---|---|---|---|---|---|
| `hypersonic` | Precision strike on one structure | seen enemy structure | 1400 M / 220 R | 180 s | 3 s |
| `saturation` | Area missile barrage | seen enemy ground | 1100 M / 180 R | 150 s | 12 s |
| `ew` | Theatre electronic attack | seen enemy network | 900 M / 160 R | 140 s | 6 s |
| `drone` | Loitering swarm | seen enemy ground | 1000 M / 170 R | 160 s | 10 s |
| `dew` | Area defensive field | own ground | 850 M / 150 R | 130 s | 4 s |

Each family carries a Defender and an Eastern name and description, resolved
through the same alliance identity the HUD and flags use, so a coalition player
never reads the opposing side's designation.

Nations declare their capability with `superweapon` in `src/data/factions.ts`.
A nation without one is a supported state: the panel says so and nothing else
changes. The legacy `baltic` / `expeditionary` map presets are alliance-level
identities and field no national capability.

## Gates

`Game.superweaponStatus(owner)` is the single authoritative answer, checked in
this order, and the command, HUD chip, panel and AI all read it:

1. the battle permits superweapons (`scenario.settings.superweapons !== false`);
2. the nation has a capability;
3. an operational Strategic Operations Centre exists;
4. the four-node authority chain is complete;
5. no operation is already committed;
6. the national reload has elapsed;
7. the bank covers the cost.

Each failure produces its own actionable reason. The panel shows the whole chain
with readable technology names and a per-node state, not just the first gap.

### Authority chain

Four researches per family, two of them existing branch work:

| Family | Chain |
|---|---|
| `hypersonic` | Fires II, Air II, Hypersonic Glide, Terminal Seeker |
| `saturation` | Fires I, Air I, Salvo Control, Penetration Aids |
| `ew` | Air I, Manoeuvre I, Spectrum Denial, Emitter Mapping |
| `drone` | Air I, Manoeuvre II, Swarm Control, Autonomous Strike |
| `dew` | Manoeuvre I, Air II, Directed Energy Power, Beam Targeting |

The chain nodes are marked `strategic` in the research catalogue, so a battle
that disables superweapons, or a nation without a capability, cannot research
them at all: the tree explains why instead of offering a dead project.

## Command flow

```
panel / map click  ->  App.beginSuperweaponTargeting()  ->  mode 'superweapon'
map click          ->  App.superweaponAtScreen()        ->  Game.superweaponTargetStatus()
                                                             (visibility, ownership, radius)
                       dispatchCommand({ type: 'superweapon', ... })
                                                             |
Game.commandSuperweapon()  ->  re-checks status and target, charges the cost,
                               starts the national reload, commits the operation
```

The simulation re-validates everything the UI checked, so a stale panel cannot
buy an illegal operation and a refused click spends nothing. A committed
operation cannot be recalled; losing the centre afterwards blocks new
authorisations but never cancels a running operation or resets its reload.

## Effects

- **Hypersonic** — one projectile at 70 tiles/s onto a structure, 820 damage with
  1.4-tile splash. The warning is short enough that the defence has to be looking.
- **Saturation** — 18 munitions over ~3 s across a 4.5-tile spread, 95 damage
  each. Air defence thins it; a layered net stops more than one battery.
- **Drone** — 24 loitering munitions over ~10 s across a 6-tile spread, 38 damage
  each. Numbers and persistence are the weapon.
- **EW** — 35 s over a 15-tile radius: mobile ground vision ×0.65, air vision
  ×0.45, engagement range ×0.85, radar and sensor reach ×0.7. Static structures
  keep their local optics.
- **DEW** — 22 s over a 13-tile radius, burning down up to 6 incoming strategic
  munitions per second. It cannot stop ordinary gunfire.

Area patterns come from `salvoPoints()`: a golden-angle spiral seeded from the
operation, so two identical operations on the same grid land on the same points
and the state hash stays honest.

Interception is checked per munition: the defensive field first, then the nearest
eligible anti-air weapon with its own reload. A saturation attack can therefore
overwhelm a single battery but not a layered net.

## Integration

- **Simulation** — `src/sim/superweapons.ts` holds pure helpers (cooldown, phase,
  salvo pattern, EW factors); `Game` owns when they run. No rendering, no clock.
- **Save** — `PlayerSuperweaponState` (cooldowns, active operation, EW window,
  defensive field) is part of the save and is restored with the battle.
- **Multiplayer** — the `superweapon` command is in the command gate's allowlist
  with its own field list, and is validated against the authoritative status
  before it is accepted.
- **AI** — `manageSuperweapon()` spends a ready capability only when the army is
  already viable, the bank keeps a research reserve, and a target the simulation
  would accept exists. It never burns a reload on a refused order.
- **Presentation** — `src/ui/superweaponView.ts` turns the status into panel
  wording; the HUD owns the chip, the panel and the targeting prompt.

## Known limitations

- The system is per-nation, so the legacy alliance presets used by the built-in
  maps field no capability. A skirmish deployed with a chosen nation does.
- There is no counter-intelligence layer: an operation's warning is a fixed
  duration per family, not something a defender can shorten.
- The AI does not coordinate a superweapon with a ground push; it fires when the
  gates and the target allow.
