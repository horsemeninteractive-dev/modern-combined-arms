# Phase 4C — service progression and insignia proposal

## Decision

Phase 4C uses **one account-wide career**, one XP ledger and one formal rank
ladder. The fifty-step long-term progression target is implemented as **service
levels** inside the existing sixteen-rank ladder:

- `src/accounts/ranks.ts` remains the formal rank ladder (Private through
  General, 0–58,000 XP).
- `src/accounts/levels.ts` adds fifty service levels (level 1 at 0 XP, level 50
  at 64,925 XP). A level is not a new rank and does not invent a new badge.
- The profile shows the formal rank and the service level together, for example
  `Private · LEVEL 1 OF 50`.
- Levels 49–50 sit inside the General rank, representing seniority after the
  final promotion rather than another rank.

The existing rank insignia are abstract NATO-pattern shapes (chevrons, rockers,
bars, stars and a wreath) and explicitly do not claim to belong to any one
army. **No authentic insignia from a real-world service has been implemented.**

## Reference service for review

Before authentic rank insignia are drawn, the project needs an approved single
reference service. The recommended review choice is the **United States Army
enlisted and officer insignia system**, because it provides a complete,
well-documented progression from Private (E-1) through General (O-10), with
intermediate officer grades that can map cleanly to a fifty-step display.

This is a proposal only. It is not implemented, and no United States Army
insignia has been copied. If another service is approved, only that service's
insignia vocabulary should be used; badges must never be mixed between services.

## Ladder

Service level thresholds follow `25(n−1)² + 100(n−1)`:

| Level | XP | Level | XP | Level | XP | Level | XP | Level | XP |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 11 | 3,000 | 21 | 11,000 | 31 | 24,000 | 41 | 42,000 |
| 2 | 125 | 12 | 3,550 | 22 | 11,925 | 32 | 25,525 | 42 | 44,225 |
| 3 | 300 | 13 | 4,150 | 23 | 12,900 | 33 | 27,100 | 43 | 46,500 |
| 4 | 525 | 14 | 4,800 | 24 | 13,925 | 34 | 28,725 | 44 | 48,825 |
| 5 | 800 | 15 | 5,500 | 25 | 15,000 | 35 | 30,400 | 45 | 51,200 |
| 6 | 1,125 | 16 | 6,250 | 26 | 16,125 | 36 | 32,125 | 46 | 53,625 |
| 7 | 1,500 | 17 | 7,050 | 27 | 17,300 | 37 | 33,900 | 47 | 56,100 |
| 8 | 1,925 | 18 | 7,900 | 28 | 18,525 | 38 | 35,725 | 48 | 58,625 |
| 9 | 2,400 | 19 | 8,800 | 29 | 19,800 | 39 | 37,600 | 49 | 61,200 |
| 10 | 2,925 | 20 | 9,750 | 30 | 21,125 | 40 | 39,525 | 50 | 64,925 |

Formal rank thresholds remain unchanged: Private 0, Corporal 400, Sergeant
1,100, Staff Sergeant 2,300, Sergeant First Class 3,900, Master Sergeant 6,000,
Sergeant Major 8,600, Second Lieutenant 11,800, First Lieutenant 15,600, Captain
20,000, Major 25,000, Lieutenant Colonel 30,500, Colonel 36,500, Brigadier
43,000, Major General 50,000, General 58,000.

## XP

The base formula is unchanged:

```
(base mode XP + min(60, completed minutes)) × outcome × difficulty
```

with campaign 150, skirmish 100, multiplayer 120; victory 1.0, draw 0.5,
defeat 0.3; recruit 0.8, veteran 1.0, elite 1.25.

Local campaign and skirmish results additionally earn a capped accomplishment
award: objectives (5 each, maximum 30), strategic sites (3 each, maximum 15),
superweapons (5 each, maximum 15) and structures destroyed (one per five,
maximum 20). Multiplayer uses its existing server-owned reward formula, which
already includes participation, completion, duration, sites and destruction.

A result is paid once per stable match reference. Achievements are recognition,
not a second XP currency.
