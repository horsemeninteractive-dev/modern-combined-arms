# Ten-Nation Arsenal Audit and Selective Expansion Specification

**Status:** Stage A1–A3 implemented, 15 November 2026. The audit reconciled the
proposed shared units against the registry; the approved shared roles now ship as
data, simulation behaviour, AI demand, meshes and voice banks. Stage B and the
shared sniper remain unshipped.

## 1. Verified starting point

| Registry | Count | Source |
| --- | --- | --- |
| Shared baseline units (`UNIT_LIST`) | 28 | `src/data/units.ts` (`ROSTER`) |
| Eastern alliance platforms | 21 | `src/data/units.ts` (`ALLIANCE_UNITS`) |
| National replacements, exclusives and naval hulls | 22 | `src/data/units.ts` (`NATIONAL_UNITS`) |
| **Total registered units** | **71** | `UNITS` |
| Playable nations | 10 (5 + 5) | `src/data/factions.ts` |
| Canonical combat slots | 21 | Shared baseline |
| Utility/support slots | 7 | Engineer, medic, recovery, APC, harvester, transport helicopter, landing craft |

The 28 shared definitions are therefore **21 combat slots plus 7 utility
slots**, not 28 interchangeable combat roles. National replacements attach to
the 21 combat slots through `variantOf`; exclusives are additions and do not
displace a canonical platform. This distinction matters because adding another
artillery, tank or APC does not create a new role just because the registry has
room for another id.

The current ten national packages still give every nation at least one
replacement, one exclusive (Sweden and Iran have a second naval hull) and one
structure variant. That remains the minimum contract, not a ceiling: a nation
may hold a second replacement or exclusive where the shared roster makes the
additional choice legible. The data model already supports it; adding one is a
deliberate national-package decision rather than a quiet data addition.

## 2. What each nation currently is

| Nation | Replacement | Exclusive(s) | Structure | Current battlefield identity |
| --- | --- | --- | --- | --- |
| Lithuania | `pathfinder` (recon) | `kestrelTeam` (MANPADS) | `forwardPost` | Recon screen; hidden infantry air denial |
| Poland | `spearhead` (MBT) | `wilk` (heavy IFV) | `armourWorks` | Armoured spearhead |
| UK | `mlrs` (SPG slot) | `stormShadow` (deep strike) | `expeditionaryAirfield` | Saturation fires and deep strike |
| Finland | `k9Thunder` (SPG) | `spikeTeam` (long-range ATGM) | `garrisonBarracks` | Territorial defence; long-range anti-armour |
| Sweden | `cv90` (IFV) | `gripen`, `visby` | `kockumsYard` | Mobile combined arms; air and littoral |
| Russia | `heavyHowitzer` (SPG) | `tosp` (thermobaric) | `longRangeSam` | Siege artillery; city-breaking firepower |
| Belarus | `deepReconUAV` (UAV) | `sprut` (recon buggy) | `signalsBureau` | Deep surveillance; fragile eyes |
| Hungary | `hedgehogTeam` (ATGM) | `taszar` (light mortar) | `bunker` | Fortified defence; infantry indirect fire |
| Iran | `khordadSam` (AA) | `mohajer6` (armed UAV), `ghadir` (midget submarine) | `noorBattery` | Unmanned strike; coastal ambush |
| North Korea | `bulsae4` (TD) | `koksan` (170 mm SPG) | `entrenchedAtGun` | Siege fires; stand-off anti-armour |

This is already more differentiated than “ten variants of the same tank”. The
weakness is not a lack of national content; it is that **five nations express
their identity through an artillery choice** (UK, Finland, Russia, Hungary and
North Korea), while several other roles have no national expression at all.

## 3. Candidate triage

### 3.1 Shared additions

| Candidate | Verdict | Reason |
| --- | --- | --- |
| MANPADS operator | **Implemented as a shared role** | `manpadsTeam` is the cheap, short-ranged barracks team in both baseline rosters; Kestrel remains Lithuania’s longer-ranged exclusive. The shared team gives nine nations organic air denial without erasing the national contract. |
| Electronic warfare vehicle | **Implemented as a mobile aura** | `ewVehicle` reduces hostile vision and engagement reach inside eight tiles. It is distinct from the off-map EW superweapon, which remains a timed strategic attack. |
| Loitering munition | **Implemented as a one-way airframe** | `loiteringMunition` launches from an airfield, fires one warhead and is expended. It cannot recover or rearm, so it is not a reusable strike aircraft. |
| Self-propelled mortar | **Defer** | `taszar` already covers infantry-portable indirect fire. The roster already has SPG, rocket artillery, MRL, MLRS, K9, heavy howitzer, Koksan and Taszar. A mortar carrier is a fourth or fifth artillery answer, not a new tactical decision. |
| Counter-UAS vehicle | **Defer** | AA/SAM and interceptors already cover air. If loitering munitions ship, counter-UAS is more likely a weapon/upgrade or a role on an existing AA/recon hull than a new production slot. |

The first three are now shipped, including the two new simulation capabilities;
the remaining candidates stay deferred.

### 3.2 National replacements

| Candidate | Verdict | Reason |
| --- | --- | --- |
| Poland — Borsuk IFV | **Reject as an addition** | Poland already has `wilk`, a heavy IFV exclusive. Adding Borsuk would create two Polish IFV identities. If Borsuk is the preferred platform, retheme `wilk` rather than add both. |
| UK — Challenger 3 | **Reject** | UK already has an SPG replacement and a deep-strike exclusive. A heavier MBT is the generic-tank addition the brief explicitly warns against. |
| Sweden — Archer | **Reject for now** | Artillery is the most crowded branch. Sweden already has CV90, Gripen and Visby; Archer would add a fifth artillery identity without changing how Sweden is commanded. |
| Finland — Patria AMV XP | **Defer** | The APC is a utility/transport slot, not Finland’s combat identity. Finland already has K9 and Spike; a second replacement would dilute the territorial-defence package. |
| Lithuania — Vilkas | **Only if Kestrel is promoted** | If Kestrel becomes the shared MANPADS variant, Vilkas can become Lithuania’s replacement/exclusive and restore a mechanised reserve. Otherwise Lithuania already has Pathfinder and Kestrel. |
| Russia — BMPT Terminator | **Promising, but needs a slot decision** | It is a real IFV/fire-support hybrid, but Russia already has a heavy-howitzer replacement and TOSP. Adding BMPT would be a second replacement or second exclusive. Choose it over TOSP, or make it a shared heavy-support vehicle with a Russian variant. |
| Belarus — Polonez-M | **Reject for now** | Belarus is the deep-surveillance nation, not another artillery nation. Polonez would compete with the existing rocket-artillery branch and add a second replacement. |
| Hungary — Lynx KF41 | **Defer** | Hungary’s identity is the fortified infantry line, not a premium IFV. Lynx would be a second replacement and would not reinforce the Taszar/Bunker/Hedgehog package. |
| Iran — Shahed-family loitering munition | **Accept only with shared loitering** | It is a natural Iranian variant of a shared one-way attack munition. It should not be a third Iranian exclusive on top of Mohajer-6 and Ghadir. |
| North Korea — M1991 MLRS | **Reject for now** | North Korea already has Bulsae-4 and Koksan. Another heavy salvo platform reinforces a role that is already the national identity; it does not add a decision. |

### 3.3 National exclusives

| Candidate | Verdict | Reason |
| --- | --- | --- |
| UK — Sniper | **Strong, but make it shared with national variants** | There is no sniper role at all. A UK-only sniper would be a third UK difference while nine nations still lack the role. A shared sniper team with a British variant is the better shape. |
| Poland — Rosomak-WRT | **Low priority** | Recovery already exists as a shared utility. A Polish recovery variant is flavour, not a new battlefield decision. |
| Lithuania — Javelin team | **Reject** | Overlaps the existing ATGM/Spike/Hedgehog family. Lithuania’s identity is recon and hidden air denial, not another anti-tank missile. |
| Finland — NLAW specialist | **Reject** | Same overlap. Finland already has Spike ER for long-range anti-armour. |
| Sweden — EW/signals vehicle | **Strong if shared EW exists** | Fits Sweden’s signals identity, but it would be a third Swedish difference unless it is a national variant of a shared EW vehicle. |
| Russia — BMPT | **Strong but contract-bound** | See the replacement table. The vehicle is distinctive; the roster contract is the problem. |
| Belarus — Polonez-M | **Reject** | Same artillery-overlap problem as the replacement entry. |
| Hungary — Lynx variant | **Defer** | A heavier IFV does not strengthen the fortified-line identity. |
| Iran — Shahed | **Accept only with shared loitering** | Same condition as the replacement entry. |
| North Korea — heavy salvo system | **Reject** | Koksan already provides the siege-fires identity. |

## 4. Which nations feel too similar

The overlap is narrower than “all ten are the same”:

- **Artillery cluster:** UK, Finland, Russia, Hungary and North Korea all make
  their national choice in the indirect-fire branch. They employ it differently
  — deep strike, mobile shoot-and-scoot, siege, infantry mortar, heavy salvo —
  but a player choosing a nation is often choosing which artillery they get.
- **Recon cluster:** Lithuania, Belarus and Sweden all lean on vision. They are
  distinct in method (hidden infantry air denial, deep UAV surveillance, air and
  littoral sensor fusion), but the distinction is mostly in employment rather
  than a different production choice.
- **Armour cluster:** Poland and Russia both offer heavy armour and fire
  support. Poland’s is manoeuvre-led; Russia’s is siege-led. That is a real
  difference, but it is carried by two platforms rather than a unique role.
- **Distinct today:** Sweden (air/naval combined arms) and Iran (unmanned and
  coastal ambush) have the clearest non-artillery identities. The UK’s deep
  strike is also distinct, but its replacement is still an artillery slot.

The corrective is not “give every nation a unique tank”. It is to stop adding
more national artillery and give the unexpressed roles — infantry specialist,
EW, one-way strike, counter-UAS — a shared home first.

## 5. Which slots need stronger national identities

The current replacements cover recon, tank, IFV, SPG, ATGM, UAV, AA and TD.
They do not cover rifle infantry, rocket artillery, fighter/interceptor, attack
helicopter or the naval support slots. That does **not** mean all of them need
national variants. A selective map:

| Slot | Current national expression | Recommendation |
| --- | --- | --- |
| Rifle infantry | None | A shared sniper/foot-scout specialist is the best use of this space; national variants can follow. |
| ATGM | Hungary | Do not add Javelin/NLAW as separate platforms; use upgrades or a single shared specialist. |
| Recon | Lithuania | Keep Pathfinder; do not add another Lithuanian scout. |
| IFV | Sweden, Poland (exclusive) | Do not add Borsuk/Vilkas/Lynx on top. Choose one platform per nation. |
| Tank | Poland | Do not add Challenger 3 as another MBT. |
| TD | North Korea | Keep Bulsae-4; no further TD replacement. |
| SPG | UK, Finland, Russia | Already crowded. Do not add Archer/Patria/another tube. |
| Rocket artillery | None | Keep the shared branch; a national variant should replace, not duplicate. |
| AA | Iran | Keep Khordad; counter-UAS is a later capability, not another SAM. |
| UAV | Belarus | Keep deep recon; armed/loitering drones are a separate role. |
| Fighter/interceptor | Sweden (Gripen) | Do not add another generic fighter; differentiate through weapons or EW, not speed/damage. |
| Attack helicopter | None | A national attack helicopter is lower value than a new shared support role. |
| Naval | Sweden, Iran | Already the strongest national identities; do not add more hulls before naval EW/ASW has a purpose. |

## 6. Implemented Stage A

The three shared roles separate cleanly into one data addition and two new
mechanics. All three are in the registry now.

### A1 — Shared MANPADS team (implemented)

- Added a shared `manpadsTeam` slot at the barracks: two-person infantry, air-only,
  short range, cheap, garrisonable.
- Kept `kestrelTeam` as Lithuania’s exclusive rather than reclassifying it. It
  keeps its longer range, higher damage and garrison identity as the national
  trade; the shared team is cheaper but reaches only 5.5 tiles.
- Lithuania now carries both the shared team and the Kestrel, which is the
  intended shape: shared content first, national trade second.
- No replacement exclusive is needed for Lithuania in this pass. Vilkas stays
  deferred rather than duplicating Poland’s Wilk.

### A2 — Shared EW vehicle (implemented)

- Added a mobile, lightly armed `ewVehicle` at the factory, with a tracked
  Eastern counterpart (`ewVehicleEC`).
- Its aura affects **enemy reconnaissance and target acquisition**, not
  simply deal damage: reduced vision, degraded radar/UAV detection, or a
  shorter guided-weapon lock.
- Counterplay is explicit: destroy the vehicle, use optical/visual units,
  or use SEAD/anti-radar attack.
- The AI sees the new slot in its demand table and fields it as a support hull;
  it is not a player-only toy.
- The implementation is a **passive unit aura**. The off-map EW superweapon is
  unchanged and remains a timed strategic attack; the two are deliberately
  different systems.

### A3 — Shared loitering munition (implemented)

- Added a one-way attack drone, airfield-based, with a short
  loiter, target acquisition, a single warhead and interception by AA/SAM.
- It is a precision answer to exposed vehicles, artillery and air
  defence, not a reusable strike aircraft.
- It is a **producible airframe**, not an ability or an off-map package. The
  existing drone superweapon remains a separate strategic strike.

### A4 — Shared sniper/foot scout (not shipped)

The cheapest genuinely new *infantry* role is a shared sniper or foot scout.
It reuses the existing individual-infantry model, needs no new simulation
system, and fills a role the prior roster audit already marked missing. If EW
or loitering proves too large for the next content pass, this is the best
fallback. The UK’s L115 and Finland’s Sako are natural national variants; they
should not be exclusive platforms that leave nine nations without the role.

## 7. Recommended Stage B

Only after A1–A3 are tested:

1. **Lithuania — Vilkas** is not approved: Kestrel stayed exclusive, and a
   mechanised IFV would duplicate Poland’s Wilk more closely than it restores a
   distinct Lithuanian identity.
2. **UK — sniper variant** of the shared specialist, not a third UK exclusive.
3. **Russia — BMPT** only by replacing TOSP or by making BMPT a shared
   heavy-support platform with a Russian variant.
4. **Sweden — EW variant** of the shared EW vehicle, preserving its signals
   identity.
5. **Iran — Shahed variant** of the shared loitering munition, preserving its
   unmanned-strike identity.
6. **Belarus — EW variant** is a better fit than Polonez; deep surveillance plus
   jamming is a coherent identity.

Do not add Poland’s Borsuk, Finland’s Patria, Hungary’s Lynx or North Korea’s
M1991 in this stage. They duplicate existing national choices rather than
creating a new one.

## 8. Deferred or rejected

- **Self-propelled mortar:** defer until testing shows the existing SPG/MRL/
  Taszar mix leaves a real responsiveness gap.
- **Counter-UAS vehicle:** defer even with loitering munitions in the roster;
  AA/SAM and interceptors already answer them, and an upgrade or existing
  AA/recon variant is a better use of the space than a new slot.
- **Another MBT, APC, fighter or generic AA vehicle:** reject. The roster is
  already past the point where another stat line improves the game.
- **More national artillery:** reject. Five nations already express identity
  through artillery; more platforms would make the cluster worse.
- **A second exclusive for a nation without removing something else:** allowed
  by the contract where the shared roster makes the additional choice legible,
  but not added in this pass. It remains a deliberate national-package decision
  rather than a quiet data addition.

## 9. AI and balance dependencies

- AI demand is keyed to canonical slots through `unitFamily`/`unitSlotId`, so a
  shared unit must be added to AI demand and production weights. National
  variants inherit the slot but still need their own trade-offs.
- EW and loitering munitions are not data-only units. Without AI use,
  counterplay and a clear UI cue, they will be ignored by the AI or become
  invisible pressure on the player.
- The existing national packages already have real trade-offs; new units should
  be introduced one at a time with matchup probes, not as a batch of ten.
- Any new artillery or anti-armour platform should be tested against the
  existing TTK bands before it is added to the roster.

## 10. Resolved decisions

1. **Kestrel stays exclusive.** The shared MANPADS team was added alongside it
   rather than absorbing it, because the Kestrel’s longer reach is a real
   national trade and Lithuania already pays for it.
2. **EW is a mobile passive aura.** The off-map EW superweapon remains a timed
   strategic attack, not the same system.
3. **The loitering munition is a producible one-way airframe.** It fires once,
   is expended and cannot recover; the drone superweapon remains separate.
4. **The national contract is a minimum, not a ceiling.** A nation may hold more
   than one replacement or exclusive where the shared roster supports it; none
   were added in this pass.
5. **The shared sniper/foot scout is deferred.** It is the best next data-only
   role if testing shows infantry play still lacks a specialist.
6. **No Stage B national units were added.** Vilkas, Borsuk, Challenger 3,
   Archer, Patria, Lynx, BMPT, Polonez-M, M1991 and Javelin/NLAW remain
   unshipped; the shared roles should be tested before national variants are
   layered on top.

The intended outcome is not 100 unit definitions. It is a roster where the ten
nations make different *choices* — and where the shared roster has a few new
roles that change how a battle is read, not just how much damage a unit does.
