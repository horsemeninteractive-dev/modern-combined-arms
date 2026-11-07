# Ten-Nation Elite Ladder — 900-Match AI-vs-AI Sweep

Every one of the ten playable nations was run against every other nation by two
Elite `AIController`s through the public command API, on the mirrored 64×64
matchup arena from `tools/matchup-arena.ts`. This document reports the result and
the two structural findings that came out of it.

## Method

- **Pairings:** all 45 unordered pairs of the ten nations.
- **Games per pairing:** 20 — five seeds (101, 1078, 2055, 3032, 4009) × both
  seats × both commander personalities. Each nation played 180 games.
- **Total:** 900 matches, 600 s cap, ~2 hours of CPU split across seven
  processes with `MCA_PAIRS` / `MCA_SEEDS` and concatenated.
- **Difficulty:** Elite for both sides. The built-in single-AI hook is off, as in
  `tests/ai-matchups.test.ts`.
- **Scoring:** a finished match scores for the side that killed the HQ. A match
  that hits the 600 s cap is resolved on the material-weighted board score
  (`sideScore`: unit+building value, kills, bank, mined ore), so 94 stalemates
  (10.4%) still carry information instead of dropping out.
- **Seat bias:** the west seat won 62.7% of decided matches. Every pairing is
  played with each nation on each seat, so the bias is shared equally and cancels
  in the per-nation totals. It is *not* removed per pairing, so read a single
  pairing's score with care; the aggregate is the meaningful figure.

Reproduce:

```
npx tsx tools/nation-matchups.ts 5 600 elite            # ~2.25 h, one process
MCA_PAIRS=lithuania-poland,uk-finland MCA_CONTROL=0 npx tsx tools/nation-matchups.ts 5 600 elite
```

The sweep's raw per-match JSON is in `tmp/mu-out-*.log` and `tmp/mu-s2-*.log`
(one `{"event":"match"}` line per game); `node tmp/nation-ladder.mjs tmp/mu-*.log`
regenerates the tables below.

## Result

`WIN%` counts finished matches only; `RESOLVED%` includes caps won on the board
score. CI is Wilson 95% on 180 games.

| Nation | W | L | Capped | WIN% | RESOLVED% | 95% CI | Avg margin | National kit on field | Avg len |
|---|---|---|---|---|---|---|---|---|---|
| **Hungary** | 99 | 71 | 10 | 55.0% | **58.9%** | 51.6–65.8 | +1243 | 62% of games | 264 s |
| Belarus | 82 | 73 | 25 | 45.6% | 56.1% | 48.8–63.2 | +887 | addition only | 306 s |
| North Korea | 94 | 69 | 17 | 52.2% | 55.0% | 47.7–62.1 | +1142 | — | 289 s |
| Russia | 85 | 74 | 21 | 47.2% | 52.8% | 45.5–59.9 | +636 | — | 294 s |
| United Kingdom | 85 | 73 | 22 | 47.2% | 52.2% | 45.0–59.4 | +422 | — | 303 s |
| Iran | 84 | 75 | 21 | 46.7% | 52.2% | 45.0–59.4 | +562 | — | 295 s |
| Sweden | 82 | 80 | 18 | 45.6% | 50.6% | 43.3–57.8 | +70 | — | 304 s |
| Poland | 82 | 84 | 14 | 45.6% | 50.0% | 42.8–57.2 | +157 | 20% of games | 285 s |
| Finland | 76 | 84 | 20 | 42.2% | 46.7% | 39.5–53.9 | −572 | — | 305 s |
| **Lithuania** | 37 | 123 | 20 | 20.6% | **25.6%** | 19.7–32.4 | −4548 | 100% of games | 307 s |

Read as: **Hungary is the strongest nation, Lithuania decisively the weakest, and
the eight in between are statistically the same nation.** Only Hungary's interval
sits entirely above 50%, only Lithuania's entirely below, and the middle eight
intervals overlap each other heavily.

### Head-to-head (row's win%, 20 games per cell)

|  | lit | pol | uk | fin | swe | rus | bel | hun | ira | nk |
|---|---|---|---|---|---|---|---|---|---|---|
| **Lithuania** | — | 25 | 40 | 35 | 40 | 20 | 10 | 20 | 25 | 15 |
| **Poland** | 75 | — | 45 | 45 | 40 | 50 | 55 | 40 | 50 | 50 |
| **UK** | 60 | 55 | — | 60 | 55 | 55 | 45 | 35 | 55 | 50 |
| **Finland** | 65 | 55 | 40 | — | 45 | 50 | 30 | 40 | 50 | 45 |
| **Sweden** | 60 | 60 | 45 | 55 | — | 50 | 50 | 40 | 50 | 45 |
| **Russia** | 80 | 50 | 45 | 50 | 50 | — | 50 | 50 | 50 | 50 |
| **Belarus** | 90 | 45 | 55 | 70 | 50 | 50 | — | 45 | 50 | 50 |
| **Hungary** | 80 | 60 | 65 | 60 | 60 | 50 | 55 | — | 50 | 50 |
| **Iran** | 75 | 50 | 45 | 50 | 50 | 50 | 50 | 50 | — | 50 |
| **North Korea** | 85 | 50 | 50 | 55 | 55 | 50 | 50 | 50 | 50 | — |

Every non-Lithuanian pairing lands between 30% and 70% — 6 to 14 games out of
20, which is what a null effect looks like at this sample size. Lithuania loses
to all nine, from 10% (Belarus) to 40% (UK, Sweden).

## Finding 1 — eight of ten national identities never reach the field

Across all 900 matches the AIs produced **17 unit definitions**:

```
rifle 11531, harvester 5433, tank 3971, reconEC 3494, recon 3263, engineer 3252,
rifleEC 2468, atgm 2277, atgmEC 1642, recovery 1223, medic 737,
pathfinder 516, hedgehogTeam 465, tankEC 299, sprut 172, kestrelTeam 46, spearhead 42
```

and completed **eight** building families (command post, refinery × ≤3, factory,
barracks, power plant × ≤2, MG nest, AT turret, research centre). **No artillery,
no aircraft, no SAM site, no airfield, no naval yard and no ship was ever
built or bought** in 900 matches.

Consequence: a nation's identity only exists on this arena if it sits on
infantry, armour, recon, the MG nest, or arrives as an addition. That covers:

| Nation | Live here | Dead here |
|---|---|---|
| Lithuania | Pathfinder (recon), Kestrel team (added) | Forward Observation Post |
| Poland | Spearhead MBT (tank, 20% of games) | Wilk, Armoured Workshop |
| Hungary | Hedgehog AT team (atgmEC), Reinforced Bunker (MG nest) | Taszar mortar team |
| Belarus | Sprut (added) | Deep Recon UAV, Signals Bureau |
| UK | — | MLRS, Storm Shadow, Expeditionary Airfield |
| Finland | — | K9 Thunder, Spike ER, Garrison Barracks |
| Sweden | — | CV90, Gripen, Visby |
| Russia | — | Heavy Howitzer, TOSP, Long-Range SAM |
| Iran | — | 3rd Khordad, Mohajer-6, Ghadir, Noor |
| North Korea | — | Bulsae-4, Koksan, Entrenched AT Gun |

The national kit was built in 62% of Hungary's games, 20% of Poland's and 100% of
Lithuania's; every other nation's is at 0%.

That is measured, not inferred: `side.variant.built` counts completed national
definitions and `side.produced` counts spawned units by definition.

### Control: identical rosters, different scores

Restricting to the seven nations whose kit never appears, playing only each
other, every figure should be 50%:

```
belarus 54.2   uk 53.3   northKorea 51.7   russia 49.2
iran 49.2      sweden 49.2   finland 43.3      (120 games each)
```

A ±7-point spread among seven *identical* rosters is the ladder's real
resolution. Anyone claiming a 5-point nation gap from this data is reading noise.

## Finding 2 — the two live identities explain the two ends

**Lithuania, last at 25.6%, is the only nation whose kit actively removes power.**
The Pathfinder replaces the shared recon vehicle on the slot the AI buys in every
match, and it is unarmed (`weapons: []`, 120 HP, 200 mats, vision 16). In 180
games the AI built 516 Pathfinders; the tracked national variant scored **0
kills** and absorbed **48,527 damage**, about 2.2 deaths per match at 120 HP.
Every other nation's recon can defend itself against what it finds; Lithuania's
opening screen cannot, and it is bought on the same priority as the armed vehicle
it replaced.

**Hungary, first at 58.9%, is the only nation whose kit replaces things the AI
already buys with strictly better ones** — the Hedgehog AT team (175 mats, faster
reload, same missile role as the Eastern ATGM team the AI buys constantly; 465
fielded) plus the Reinforced Bunker on the MG nest it also builds (completed in
62% of its games, 64 kills for 16,249 damage taken). This is the one national
edge in the whole matrix that is both reachable and positive, at +2.4σ over 50%.

Belarus (+1.6σ) and North Korea (+1.3σ) are the only other nations above the
noise band and neither is significant, so no claim about them is supported.
Poland's Spearhead appears in only one game in five, so its 50.0% is the baseline
with extra flavour.

## What to do about it

1. **The AI never buys fires, air or naval units on a land map.** Fixing that is
   worth more to national identity than any stat pass: eight of ten nations
   currently play as the shared baseline in every AI-vs-AI match, so the ladder
   cannot see UK, Finnish, Swedish, Russian, Iranian or North Korean design.
2. **Give the Pathfinder a weapon, or teach the AI to escort it.** A national
   scout that cannot shoot makes its army worse than baseline, and the AI buys it
   as if it were the armed recon vehicle. This is a −24 point swing, far larger
   than any other national effect.
3. **Hungary's +9 points is a real but narrow edge** built on two cheap
   replacements. It is the model to copy for the other nine: replace something the
   AI actually builds.
