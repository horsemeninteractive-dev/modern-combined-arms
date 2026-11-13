# MCA — Adaptive Commander AI

## Phase 1 — National Commander Doctrine & Personality Design

**Status:** design specification. No gameplay, AI, balance, difficulty or multiplayer code is changed by this phase. Every capability below is taken from the shipped source at `2d9c542` (release 0.7.1 BETA), not from earlier design documents.

---

## 1. Audit basis

### 1.1 What the source actually contains

| Layer | Source | Finding |
|---|---|---|
| Nations | `src/data/factions.ts` | Ten playable nations, five per coalition. Each has `doctrine` (a display string), `superweapon`, one unit **replacement**, one unit **exclusive**, one **structure replacement**. Sweden and Iran add a second hull (aircraft/submarine) in `addUnits`. |
| Rosters | `src/data/roster.ts` | A nation is an alliance baseline plus `replaceUnits` / `addUnits` / `replaceBuildings`. Replacements must occupy the same canonical slot (`variantOf`), so production lists, research unlocks, AI demand and saves keep naming the role. National definitions are deliberately absent from `UNIT_LIST`, so no nation leaks equipment into another's baseline. |
| Units | `src/data/units.ts` | 25 canonical slots. Defender baseline = canonical ids; Eastern baseline = the `EASTERN_PLATFORMS` map (same slots, different platforms). 22 national definitions exist: 12 replacements/variants and 10 exclusives. |
| Buildings | `src/data/buildings.ts` | Structures are shared by slot; ten national variants exist (one per nation). No nation has a unique production *slot* — only a trade on cost, structure points, reach or service rate. |
| Research | `src/data/research.ts` | Four branches — **Manoeuvre, Fires, Air, Naval** — eight tier nodes (two per branch), plus per-unit upgrades and per-structure modules. Tier 0 units/buildings need no technology. |
| AI | `src/sim/ai.ts` | One planner for both alliances. Personality is `AIProfile`: `strategy` (one of five), `aggression`, `economy`, `tech`, `defence`, `armyScale`, `reactionTicks`, `responseWeight`, `commitShare`, `reserve`, `recall`, `protectEconomy`, `abilities`. It is seeded from the match seed today, not chosen by nation. |
| Difficulty | `DIFFICULTY_BIAS` in `src/sim/ai.ts` | Recruit/Veteran/Elite change **judgement only** — reaction cadence, scouting response, commit share, recall, economy protection, tactical abilities. No income, vision or combat bonus. |
| Tests | `tests/ai-matchups.test.ts`, `tests/national-*.test.ts`, `tests/ai-recovery.test.ts` | The 48-match ladder and the national identity suites are the guard rails any commander system must keep passing. |

**Consequence for this design:** the commander layer cannot invent equipment. Every doctrine below is a way of *using* kit that already resolves through `productionEntries()` and the research tree.

### 1.2 The shared envelope

Both coalitions field the same 25 slots: engineer, harvester, rifle, atgm, medic, recon, aa, recovery, apc, tank, ifv, td, spg, rocketArtillery, uav, interceptor, fighter, attackHelo, transportHelo, missileBoat, corvette, frigate, submarine, navalSupport, landingCraft. What differs is the *platform* in each slot:

- **Defender Coalition** — accurate guns, thermal optics, survivable hulls, higher material cost.
- **Eastern Coalition** — cheaper hulls, heavier salvoes, longer reach, thinner protection.

Every nation therefore has a complete army. National identity is a *bias*, not a hole: a nation's commanders must be able to fight without their signature unit, but should be markedly better when they build around it.

---

## 2. National capability matrix

| Nation | Distinctive implemented kit | Strongest capability | Weakest capability | Best strategic option | Binding limitation |
|---|---|---|---|---|---|
| **Lithuania** | Pathfinder (16 vision, unarmed, 200 mats), Kestrel MANPADS team (garrisonable, 6.5 tiles), Forward Observation Post (600 hp, cheap radar) | Vision per material; cheapest air denial in the game | No national hitting power; nothing that kills armour better than the shared ATGM | Trade space for information, ambush with coalition kit | Every eye is soft; losing the screen blinds the army |
| **Poland** | Spearhead MBT (620 hp, heavy, slow), Wilk heavy IFV (autocannon + ATGM, 430 hp), Armoured Workshop (+40 % structure) | Sustained head-on armoured combat; vehicle line survives fire | Speed and reaction; expensive, slow builds | Mass armour and win the attrition fight | Slow hulls cannot disengage; a flank is fatal |
| **United Kingdom** | Rocket Battery (MLRS), Storm Shadow battery (26-tile cruise missile, 14-tile minimum), Expeditionary Airfield (cheap, fragile) | Reach and saturation; the only true deep-strike launcher | Close defence; the airfield and launchers die to anything that reaches them | Break the position from beyond sight, then occupy it | 1100-mat launchers that cannot see their own targets |
| **Finland** | K9 Thunder (long-reach SPG), Spike ER team (12 tiles, anti-armour only), Garrison Barracks (cheap, fragile) | Stand-off killing from cover; infantry that holds ground cheaply | Close assault; fragile production | Trade ground for kills, keep a barracks in every sector | Spike teams cannot hurt infantry and die to scouts |
| **Sweden** | CV90 (fast, 40 mm + ATGM, 10.5 vision), Gripen (multirole, 5 rounds), Visby (fastest corvette, 4 missiles), Kockums Yard (+20 %) | Tempo and flexibility; the only dual-role airframe and the fastest hull afloat | Durability; thin hulls, short fuel, small magazines | Be where the enemy is not, twice | Wins the approach, loses the standing fight |
| **Russia** | Heavy Howitzer (203 mm), TOSP thermobaric launcher (9 tiles, 3-tile fireball), Long-Range SAM | Deliberate destruction of positions; the best anti-infantry payload | Mobility and recon; slow batteries, blind without scouts | Reduce the position, then walk in | Every salvo is a commitment; counter-battery hurts |
| **Belarus** | Deep Recon UAV (30 vision), Sprut buggy (5.1 speed, 140 mats), Signals Bureau (+25 % research, fragile) | Map knowledge and research tempo | Survivable combat power; no national killer | Know everything, out-tech the opponent, strike where they are thin | The best eyes in the game are unarmed and easy to kill |
| **Hungary** | Hedgehog AT team (fast reload, 8 tiles), Taszar mortar team (indirect fire from a building), Reinforced Bunker (1350 hp) | Holding a line cheaply; indirect fire without vehicles | Offensive reach; short-range AT, slow mortars | Fortify, bleed the attack, counter-punch | A static army cannot chase; artillery and smoke beat it |
| **Iran** | 3rd Khordad SAM (long reach, no gun), Mohajer-6 (armed UAV), Ghadir midget submarine, Noor coast launcher (cheap, fragile) | Unmanned strike and coastal ambush; cheap sea denial | Sustained conventional combat; reload gaps, thin hulls | Deny, attrit, and never fight the fair fight | Every system has a reload window that a fast attack can exploit |
| **North Korea** | Bulsae-4 ATGM carrier (14 tiles, 8 rounds), Koksan 170 mm (longest tube), Entrenched AT Gun (1450 hp) | Long-range anti-armour and siege fires | Manoeuvre; slow hulls, long reloads | Stand off, flatten, then assault the survivors | The army is designed to besiege, not to react |

---

## 3. The thirty commanders

Each entry is a personality that must remain recognisable at every difficulty. Names are fictional; none is a depiction of a real person.

### 3.1 Lithuania — information as terrain

Lithuania's implemented kit is eyes and air denial: a 16-vision unarmed scout, a garrisonable MANPADS team, and a cheap radar post. Its commanders do not win by hitting harder; they win by knowing first and by making the coalition's shared armour arrive in the right place.

**1. Rasa Vilkas — "Sietas" (Sieve)**
- **Identity:** A territorial reconnaissance officer who ran border observation before the war. Patient, laconic, distrusts plans that need surprise. Traits: watchful, frugal, stubborn.
- **Doctrine:** reconnaissance screen / air denial. Wins by never being surprised and by denying the enemy's air reconnaissance. Prefers broken ground with long sightlines and covered withdrawal routes.
- **Strategic:** economy weighted to refineries over factories; expands by siting Forward Posts before a second production line; produces Pathfinders continuously rather than in batches; researches Manoeuvre tier 1 for smoke, then Air tier 1; heavy early radar investment; attacks only after the opponent's composition is known.
- **Tactical:** aggression low; risk low; withdraws damaged units readily; reinforces a threatened flank with infantry rather than armour; targets recon and air-defence; answers armour with shared ATGM ambushes, infantry with Kestrels, artillery by relocating the screen, air with Kestrel teams, naval by ignoring it, economic harassment with a Pathfinder-backed counter-raid.
- **Strengths:** the cheapest complete picture in the game; excellent against air-heavy and artillery-heavy opponents who need eyes.
- **Weaknesses:** cannot break a fortified line; a single armoured thrust that ignores the screen goes straight through. Countered by mass armour and by blind-fire artillery.
- **Arsenal:** favours Pathfinder, Kestrel, Forward Post; underuses main battle tanks (buys only the minimum coalition armour) and never builds a second airfield.

**2. Tomas Beržas — "Stiklas" (Glass)**
- **Identity:** A signals and counter-battery specialist who treats the battlefield as a sensor grid. Precise, intolerant of ambiguity, quietly arrogant. Traits: methodical, analytical, detached.
- **Doctrine:** sensor grid / observed fires. Wins by making every enemy position visible and then removing it with shared artillery. Prefers open maps and static fights.
- **Strategic:** economy balanced toward power headroom and radar coverage; builds two to three Forward Posts in a triangle before any armour; researches Fires tier 1 and the Fire-Control Net module; produces spotters, then self-propelled guns; defence is layered around the radar net; attack timing is tied to completing a fire mission, not to army size.
- **Tactical:** aggression medium-low; risk low; retreats batteries aggressively; reinforces the radar line first; targets enemy artillery and command posts; answers armour with observed fire, infantry with machine-gun nests, artillery with counter-battery, air with Kestrels, naval with coastal artillery only, harassment by hunting the raiders with a spotter-led patrol.
- **Strengths:** best counter-battery behaviour of any Lithuanian commander; punishes static opponents.
- **Weaknesses:** the grid is fragile — losing two posts collapses the doctrine; fast manoeuvre opponents outrun the fire missions.
- **Arsenal:** favours Forward Post, Pathfinder, shared SPG and radar modules; underuses tanks, helicopters and the navy.

**3. Aistė Narušytė — "Vėjas" (Wind)**
- **Identity:** A light-infantry raider who learned to fight in forests with borrowed transport. Restless, improvisational, contemptuous of fixed positions. Traits: bold, charming, impatient.
- **Doctrine:** raid and withdraw / air-mobile harassment. Wins by attacking the economy and the rear, never the front. Prefers wooded maps with short sightlines and multiple approach routes.
- **Strategic:** economy lean, factories early; builds one Forward Post only as a raid beacon; produces Pathfinders, APCs and Kestrel teams with occasional transport helicopters; researches Manoeuvre tier 1 for smoke and emergency power, then Air tier 1; minimal static defence; attacks by 4–6 minutes and keeps attacking.
- **Tactical:** aggression high; risk high; abandons exposed units rather than losing the tempo; reinforces a raid rather than a line; targets harvesters, refineries and isolated structures; answers armour by avoiding it, infantry with Kestrels and rifle squads, artillery by raiding it, air with Kestrels, naval by denial of the coast, harassment by raiding back harder.
- **Strengths:** the only Lithuanian commander who can actually end a match early; punishes greedy economies.
- **Weaknesses:** loses to anyone who fortifies and keeps a reserve; a failed raid leaves nothing behind.
- **Arsenal:** favours Pathfinder, APC, transport helicopter, Kestrel; underuses artillery, tanks and static defence.

### 3.2 Poland — the armoured argument

Poland's kit is a heavier tank, a tank-fighting IFV and a hardened vehicle works. All three commanders are armoured in some sense; they differ in *when* the armour is committed and what protects it.

**1. Krzysztof Zawadzki — "Młot" (Hammer)**
- **Identity:** A pre-war armoured brigade commander who believes the decisive fight is a single massed blow. Blunt, confident, dislikes subtlety. Traits: decisive, impatient, physically fearless.
- **Doctrine:** armoured breakthrough / attrition. Wins by concentrating Spearheads and driving at the command post. Prefers open ground with one clear axis.
- **Strategic:** economy secondary to production; builds the Armoured Workshop first and a second factory early; produces tanks continuously from minute three; researches Manoeuvre tier 1 then tier 2 for hull-down and active protection; light static defence; attacks as soon as six hulls exist.
- **Tactical:** aggression high; risk medium; rarely retreats; reinforces the spearhead, not the base; targets command posts and production; answers armour with Spearheads head-on, infantry with IFVs, artillery by driving through the beaten zone, air with shared AA, naval by ignoring it, harassment by detaching two hulls.
- **Strengths:** the most direct route to a knockout; excellent against unprepared or economy-focused opponents.
- **Weaknesses:** predictable axis; deep-strike and minefield-style attrition ruin the wave. Countered by Storm Shadow, Koksan and prepared anti-tank lines.
- **Arsenal:** favours Spearhead, Wilk, Armoured Workshop; underuses recon, air and static defence.

**2. Marta Zielińska — "Pancerna" (Armoured)**
- **Identity:** A mechanised infantry officer who argues that tanks without infantry are targets. Composed, sceptical, politically careful. Traits: balanced, patient, pragmatic.
- **Doctrine:** mechanised combined arms / layered assault. Wins by moving armour, infantry and fires as one formation. Prefers mixed terrain.
- **Strategic:** economy and production balanced; one Armoured Workshop plus one barracks; produces Wilk and shared IFVs alongside Spearheads, with medics and recovery; researches Manoeuvre tier 1, then Fires tier 1 for observed artillery; medium static defence around the production line; attacks at 7–9 minutes with a formed group.
- **Tactical:** aggression medium; risk medium; withdraws damaged hulls for repair; reinforces whichever arm is engaged; targets anti-tank positions first; answers armour with Wilk missiles and Spearheads, infantry with IFVs and rifles, artillery with observed counter-fire, air with shared AA, naval with coastal defence only, harassment with a mixed reaction group.
- **Strengths:** the most consistent Polish commander; hard to counter with a single arm.
- **Weaknesses:** slower to exploit a collapse; a fast raider can out-tempo the formation.
- **Arsenal:** favours Wilk, Spearhead, APC, recovery, medics; underuses air and the navy.

**3. Piotr Grabowski — "Bastion"**
- **Identity:** A defensive armour commander who fights from prepared positions and counter-attacks the exhausted attacker. Dour, meticulous, risk-averse. Traits: cautious, disciplined, quietly ruthless.
- **Doctrine:** armoured defence / counter-punch. Wins by absorbing the attack and then rolling forward over the wreckage. Prefers chokepoints and short fronts.
- **Strategic:** economy heavy, production steady; Armoured Workshop placed behind the line; produces anti-tank vehicles and Spearheads in equal measure; researches Manoeuvre tier 2 for hull-down, then Fires tier 1; heavy static defence with overlapping turrets; attacks only after the opponent's first wave is destroyed.
- **Tactical:** aggression low until the counter; risk low; retreats damaged armour consistently; reinforces the threatened sector; targets the attacker's engineer and artillery; answers armour with hull-down Spearheads and AT turrets, infantry with machine guns, artillery by dispersal, air with shared AA, naval by ignoring it, harassment with a mobile reserve.
- **Strengths:** punishes aggressive commanders; very hard to break with a first wave.
- **Weaknesses:** gives up the initiative; an opponent who simply out-economies him wins on score.
- **Arsenal:** favours Spearhead, shared TD, AT turrets, Armoured Workshop; underuses air, rockets and early aggression.

### 3.3 United Kingdom — reach and the fragile rear

Britain's kit is reach: rockets, a cruise-missile battery and a cheap, exposed airfield. Its commanders all try to win before contact — and all pay for it if contact happens on the enemy's terms.

**1. Eleanor Hayes — "Barrage"**
- **Identity:** A gunnery officer who came up through rocket troops and believes volume beats precision. Loud, energetic, uninterested in defence. Traits: aggressive, gregarious, overconfident.
- **Doctrine:** saturation fires / area denial. Wins by removing the enemy's ability to stand anywhere. Prefers static opponents and open maps.
- **Strategic:** economy strong toward power and refineries; two factories; produces Rocket Batteries and shared rocket artillery in number; researches Fires tier 1 then tier 2; light defence around the batteries; attacks once three launchers are loaded.
- **Tactical:** aggression high; risk medium; abandons a launcher rather than the barrage; reinforces the battery line; targets infantry clusters, defences and production; answers armour with massed rockets, infantry with saturation, artillery by counter-battery, air with shared AA, naval with coastal rockets, harassment by shelling the raider's origin.
- **Strengths:** deletes static defences and infantry armies; forces movement.
- **Weaknesses:** poor accuracy against dispersed targets; a fast armoured push reaches the launchers. Countered by mobile warfare and air strikes.
- **Arsenal:** favours MLRS, shared rocket artillery, Fire-Control Net; underuses tanks, infantry and the navy.

**2. James Ashcroft — "Longbow"**
- **Identity:** A deep-strike planner who treats enemy production as the real front line. Cold, exacting, secretive. Traits: patient, manipulative, perfectionist.
- **Doctrine:** deep strike / decapitation. Wins by destroying factories, airfields and command posts before the army meets. Prefers maps where the rear is reachable.
- **Strategic:** economy high, tech high; builds one Expeditionary Airfield for reconnaissance aircraft and a Storm Shadow battery as soon as 1100 mats exist; researches Air tier 1 for UAVs, then Fires; invests in Pathfinder-style vision through shared recon and UAVs; minimal army, maximum reach; attacks when a target's location is confirmed.
- **Tactical:** aggression medium; risk low; never risks the launcher; reinforces the reconnaissance screen; targets production, airfields, command posts and artillery; answers armour by blinding it, infantry by ignoring it, artillery by destroying it first, air with shared interceptors, naval with nothing, harassment by retaliating against the raider's base.
- **Strengths:** can win without a decisive battle; the best answer to turtle economies.
- **Weaknesses:** 26-tile missiles with a 14-tile minimum are useless once the enemy closes; losing the airfield blinds him. Countered by fast pushes and dispersed bases.
- **Arsenal:** favours Storm Shadow, Expeditionary Airfield, shared UAV and recon; underuses infantry, tanks and static defence.

**3. Nadia Okoro — "Bridgehead"**
- **Identity:** An expeditionary logistics officer who fights with whatever arrives first. Adaptable, dry-humoured, allergic to fixed plans. Traits: flexible, calm, opportunistic.
- **Doctrine:** expeditionary tempo / air-land manoeuvre. Wins by arriving before the defence is ready. Prefers coastal maps and short distances.
- **Strategic:** economy medium, production fast; builds the cheap Expeditionary Airfield early and accepts its fragility; produces fighters, attack helicopters and APCs; researches Air tier 1 then Manoeuvre tier 1; moderate defence; attacks at 5–7 minutes with air support.
- **Tactical:** aggression medium-high; risk medium-high; cuts losses quickly; reinforces the airhead; targets air defence and isolated infantry; answers armour with attack helicopters, infantry with air and APCs, artillery by air strike, air with interceptors, naval with a small escort, harassment by hunting the raiders with aircraft.
- **Strengths:** fast, flexible, hard to pin down; exploits an undefended flank better than any other British commander.
- **Weaknesses:** the airfield is the whole plan; heavy SAM coverage ends it. Countered by Russia's long-range SAM and Iran's Khordad.
- **Arsenal:** favours Expeditionary Airfield, fighter, attack helicopter, APC; underuses heavy armour, rockets and static defence.

### 3.4 Finland — ground and the long shot

Finland's kit is cheap infantry infrastructure, a long-reach howitzer and a 12-tile anti-tank team. Its commanders fight for ground and for time, and differ in how much ground they are willing to trade.

**1. Aino Korhonen — "Linja" (Line)**
- **Identity:** A territorial commander who mobilised the north and never gave it back. Unhurried, immovable, quietly warm. Traits: stubborn, practical, protective.
- **Doctrine:** territorial defence / infantry attrition. Wins by making every metre cost more than it is worth. Prefers forest, towns and short sightlines.
- **Strategic:** economy medium, barracks-heavy; builds Garrison Barracks in every sector rather than one large base; produces rifle squads, shared ATGM and medics; researches Manoeuvre tier 1 for smoke and emergency power; heavy static defence; attacks only to retake ground, never to raid.
- **Tactical:** aggression low; risk low; retreats to the next line, never routs; reinforces the sector under attack; targets engineers and supply; answers armour with shared ATGM and Spike teams, infantry with massed rifles, artillery by dispersing into cover, air with shared AA, naval by conceding the coast, harassment by making the raiders fight for every field.
- **Strengths:** extremely hard to knock out; the best commander at holding a narrow front.
- **Weaknesses:** cannot exploit a win; loses to an opponent who takes the whole map. Countered by siege artillery and deep strike.
- **Arsenal:** favours Garrison Barracks, shared infantry, Spike teams; underuses tanks, aircraft and the navy.

**2. Juhani Rautio — "Kaukopartio" (Long Patrol)**
- **Identity:** A pre-war artillery observer who believes the fight is decided at twelve tiles. Sparse, precise, slightly theatrical. Traits: exacting, patient, vain.
- **Doctrine:** stand-off killing / observed fire. Wins by destroying manoeuvre before it closes. Prefers ridges, lakes and open approaches.
- **Strategic:** economy high toward power and research; builds one Garrison Barracks for protection and two factories for guns; produces K9 Thunders and Spike teams in pairs; researches Fires tier 1 then Air tier 1 for UAV observation; medium static defence; attacks when the enemy is inside the gun envelope.
- **Tactical:** aggression low; risk low; withdraws guns immediately after firing; reinforces the observer screen; targets armour, artillery and command posts; answers armour with Spike and K9, infantry with shared infantry, artillery by counter-battery, air with shared AA, naval with coastal guns, harassment by shelling the raider's staging point.
- **Strengths:** the most efficient killer of armour in the coalition; punishes slow pushes.
- **Weaknesses:** blind without observers; fast light forces close inside the minimum range. Countered by recon suppression and air raids.
- **Arsenal:** favours K9, Spike, shared SPG, UAV; underuses tanks, helicopters and the navy.

**3. Sanna Lahti — "Motti"**
- **Identity:** A light-infantry officer who fights in packets and cuts roads. Restless, sardonic, fond of improvisation. Traits: cunning, impatient, gregarious.
- **Doctrine:** encirclement / interdiction. Wins by cutting a formation off from its base and eating it. Prefers woods, tracks and long flanks.
- **Strategic:** economy lean, factories early; builds cheap Garrison Barracks as forward posts; produces APCs, rifle squads and Spike teams; researches Manoeuvre tier 1; light defence; attacks at 5 minutes in three small groups.
- **Tactical:** aggression high; risk medium-high; abandons a group that is cut off; reinforces the encirclement, not the base; targets harvesters, refineries and roads; answers armour by flanking with Spike, infantry with rifles, artillery by attacking it, air by dispersion, naval by ignoring it, harassment by counter-encirclement.
- **Strengths:** punishes columns and greedy expansions; creates chaos cheaply.
- **Weaknesses:** cannot fight a set-piece battle; a concentrated opponent defeats the packets in detail. Countered by bunker lines and massed infantry.
- **Arsenal:** favours APC, Garrison Barracks, Spike, light infantry; underuses heavy armour, heavy artillery and air.

### 3.5 Sweden — tempo, and the sea

Sweden's kit is speed and flexibility: a fast IFV, a dual-role fighter, the fastest corvette and a hardened yard. Its commanders differ in which domain carries the tempo.

**1. Elin Sjöberg — "Rörlig" (Mobile)**
- **Identity:** A mechanised brigade commander who thinks in terms of who arrives second. Quick, competitive, intellectually restless. Traits: energetic, adaptable, impatient.
- **Doctrine:** mobile combined arms / tempo. Wins by being in two places before the enemy is in one. Prefers open, road-rich maps.
- **Strategic:** economy medium, production fast; one factory, one barracks; produces CV90s, APCs and shared infantry; researches Manoeuvre tier 1 then tier 2; light defence, heavy recon; attacks at 6 minutes and re-attacks continuously.
- **Tactical:** aggression high; risk medium; disengages damaged CV90s; reinforces the most advanced group; targets isolated units and production; answers armour with CV90 missiles, infantry with the 40 mm, artillery by moving, air with shared AA, naval by ignoring it, harassment by out-running it.
- **Strengths:** the best tempo commander in the game; forces the opponent to react.
- **Weaknesses:** thin hulls and short magazines; a sustained fight goes badly. Countered by Poland's Spearhead and Hungary's bunkers.
- **Arsenal:** favours CV90, APC, shared IFV; underuses static defence, heavy artillery and the navy.

**2. Magnus Åkesson — "Skärgård" (Archipelago)**
- **Identity:** A coastal flotilla commander who believes the sea decides the flank. Calm, oblique, faintly amused. Traits: patient, contrarian, detail-obsessed.
- **Doctrine:** littoral control / flanking. Wins by owning the water and landing where nobody is looking. Prefers coastal and river maps.
- **Strategic:** economy high; shipyard early; produces Visby corvettes, missile boats and landing craft; researches Naval tier 1 then tier 2, plus Air tier 1 for reconnaissance; medium coastal defence; attacks by sea once the flotilla is formed.
- **Tactical:** aggression medium; risk medium; withdraws damaged hulls to the yard; reinforces the beachhead; targets transports, coastal batteries and undefended shore; answers armour by landing behind it, infantry with naval gunfire, artillery by bombardment, air with shared AA, naval with Visby and submarines, harassment by hunting the raider with the flotilla.
- **Strengths:** the only commander who can genuinely open a second front; strong on naval maps.
- **Weaknesses:** expensive and map-dependent; useless on landlocked maps. Countered by Iran's Ghadir and Noor batteries.
- **Arsenal:** favours Visby, missile boat, landing craft, Kockums Yard, submarine; underuses heavy armour and static defence.

**3. Tove Lindqvist — "Syl" (Awl)**
- **Identity:** A fighter squadron commander who flies the strike herself in her own head. Sharp, competitive, superstitious. Traits: bold, exacting, proud.
- **Doctrine:** air-mobile precision / strike. Wins by removing the enemy's command and air defence from above. Prefers maps with reachable rear areas.
- **Strategic:** economy high, tech high; airfield by minute four; produces Gripens and shared UAVs; researches Air tier 1 then Manoeuvre tier 1; light defence, strong recon; attacks when the flightline is armed.
- **Tactical:** aggression high; risk medium-high; accepts aircraft losses only for a real target; reinforces the air campaign; targets SAM sites, command posts and artillery; answers armour from the air, infantry with strike missiles, artillery by air strike, air with the Gripen's air-to-air round, naval with a single corvette, harassment by striking the raider's base.
- **Strengths:** can decapitate a static opponent; the most efficient use of the Gripen's dual role.
- **Weaknesses:** five rounds and short fuel; a layered SAM net ends the campaign. Countered by Russia's Long-Range SAM and Iran's Khordad.
- **Arsenal:** favours Gripen, shared UAV, interceptor; underuses tanks, infantry and the navy.

### 3.6 Russia — deliberate destruction

Russia's kit is siege weight: a 203 mm howitzer, a thermobaric launcher and the longest-reaching SAM site. Its commanders agree that positions must be reduced; they disagree about what happens next.

**1. Viktor Sokolov — "Molot" (Hammer)**
- **Identity:** A siege artillery commander from the first campaign, convinced the war is won one building at a time. Heavy, deliberate, humourless. Traits: methodical, relentless, unimaginative.
- **Doctrine:** siege fires / position reduction. Wins by flattening the defence, then occupying the rubble. Prefers built-up and fortified maps.
- **Strategic:** economy high toward power and refineries; factory early, barracks second; produces Heavy Howitzers and shared howitzers in battery; researches Fires tier 1 then tier 2; heavy static defence around the guns; attacks once two batteries are in position.
- **Tactical:** aggression medium; risk low; never moves guns under fire; reinforces the battery, not the assault; targets bunkers, production and command posts; answers armour with massed 203 mm, infantry with the same, artillery by counter-battery, air with the Long-Range SAM, naval with coastal guns, harassment by shelling the raider's base.
- **Strengths:** the best structure-killer in the game; grinds fortified maps down.
- **Weaknesses:** slow to react; a mobile opponent never sits in the beaten zone. Countered by Sweden's CV90 tempo and Britain's deep strike.
- **Arsenal:** favours Heavy Howitzer, shared SPG, Long-Range SAM; underuses tanks, aircraft and the navy.

**2. Irina Volkova — "Ešelon" (Echelon)**
- **Identity:** A deep-battle staff officer who plans in echelons and reserves. Precise, cold, politically adept. Traits: calculating, patient, controlling.
- **Doctrine:** deep battle / echeloned pressure. Wins by feeding a second echelon into a defence that has already spent itself. Prefers wide maps with room to manoeuvre.
- **Strategic:** economy balanced, production high; two factories; produces a mixed armour-infantry force with TOSP support; researches Fires tier 1 then Manoeuvre tier 1; medium defence; attacks in timed waves rather than one push.
- **Tactical:** aggression medium-high; risk medium; withdraws a spent echelon; reinforces whichever echelon is winning; targets the seam between enemy formations; answers armour with combined TOSP and tanks, infantry with TOSP, artillery with counter-battery, air with shared AA, naval with coastal defence, harassment by continuing the offensive regardless.
- **Strengths:** sustains pressure better than any other Russian commander; hard to stop with a single defensive success.
- **Weaknesses:** needs a deep economy; early disruption hurts badly.
- **Arsenal:** favours TOSP, shared tanks, shared rocket artillery, Long-Range SAM; underuses static defence and the navy.

**3. Sergei Markov — "Redut" (Redoubt)**
- **Identity:** A defensive specialist who believes the attack should break on the line. Stiff, formal, quietly proud. Traits: disciplined, conservative, stubborn.
- **Doctrine:** fortified attrition / counter-attack. Wins by absorbing the first wave and answering it with fresh armour. Prefers chokepoints and short fronts.
- **Strategic:** economy high; factory late, defence early; produces anti-tank vehicles and TOSP; researches Manoeuvre tier 2 for hull-down and active protection; heavy static defence with Long-Range SAM coverage; attacks after the enemy's first wave dies.
- **Tactical:** aggression low until the counter; risk low; retreats damaged units; reinforces the threatened sector; targets the attacker's engineers and artillery; answers armour with hull-down guns, infantry with TOSP and nests, artillery by dispersal, air with the Long-Range SAM, naval by conceding the coast, harassment with an armoured reserve.
- **Strengths:** very hard to break; the best Russian commander against armoured pushes.
- **Weaknesses:** concedes tempo to an economic opponent.
- **Arsenal:** favours Long-Range SAM, TOSP, shared TD, AT turrets; underuses heavy howitzers, aircraft and the navy.

### 3.7 Belarus — the map is the weapon

Belarus's kit is vision and research speed: a 30-vision UAV, a 140-mat scout buggy and a research centre that works a fifth faster. Its commanders all trade combat power for knowledge, and differ in what they do with it.

**1. Andrei Kazlou — "Radar"**
- **Identity:** A surveillance officer who ran the national listening service. Reserved, exact, faintly menacing. Traits: analytical, patient, secretive.
- **Doctrine:** deep surveillance / technological edge. Wins by out-researching and out-seeing the opponent. Prefers large maps with long approaches.
- **Strategic:** economy high toward research and power; Signals Bureau early; produces Deep Recon UAVs continuously; researches Air tier 1 then Fires tier 1, using the 25 % research bonus to reach tier 2 first; medium defence; attacks when a technology lead is measurable.
- **Tactical:** aggression medium; risk low; protects the UAVs; reinforces the sensor net; targets enemy research and production; answers armour with shared ATGM and tanks, infantry with shared infantry, artillery by locating and countering it, air with shared AA, naval with coastal defence, harassment by watching the raid form and meeting it.
- **Strengths:** the strongest information position in the game; a technology lead compounds.
- **Weaknesses:** the UAVs are unarmed and the bureau is fragile; a fast attack ends the lead. Countered by Britain's deep strike and Sweden's air campaign.
- **Arsenal:** favours Deep Recon UAV, Signals Bureau, shared recon; underuses heavy armour, static defences and the navy.

**2. Volha Maroz — "Roj" (Swarm)**
- **Identity:** A reconnaissance troop commander who saturates a map with cheap eyes. Cheerful, chaotic, relentless. Traits: energetic, irreverent, opportunistic.
- **Doctrine:** reconnaissance saturation / map control. Wins by knowing everything and striking the emptiest point. Prefers open maps with many routes.
- **Strategic:** economy lean, factories early; produces Sprut buggies in numbers; researches Manoeuvre tier 1 for speed and smoke; light defence; attacks early and often with whatever the map shows.
- **Tactical:** aggression high; risk high; accepts heavy Sprut losses; reinforces the raid that is working; targets harvesters, undefended structures and artillery; answers armour by avoiding it, infantry with shared rifles, artillery by finding it first, air by dispersion, naval by ignoring it, harassment by swarming the raiders.
- **Strengths:** cheapest complete map picture; excellent at finding the undefended base.
- **Weaknesses:** no staying power; loses every set-piece fight. Countered by any concentrated defence.
- **Arsenal:** favours Sprut, shared recon, APC; underuses artillery, heavy armour and the navy.

**3. Mikalai Barys — "Maskirovka"**
- **Identity:** A deception officer who treats every visible position as bait. Wry, indirect, deliberately vague. Traits: cunning, patient, theatrical.
- **Doctrine:** deception / ambush defence. Wins by making the opponent attack the wrong place. Prefers broken ground, forests and towns.
- **Strategic:** economy medium; defence-heavy; produces hidden infantry and anti-tank teams with a small armoured reserve; researches Manoeuvre tier 1 for smoke, then Fires; uses the electronic-warfare superweapon as the doctrinal centrepiece; attacks only to exploit a discovered weakness.
- **Tactical:** aggression low; risk medium; withdraws before contact; reinforces the ambush; targets scouts and command posts; answers armour with ambushes, infantry with machine-gun nests, artillery by dispersion and smoke, air with shared AA, naval by ignoring it, harassment by ambushing the raiders.
- **Strengths:** punishes predictable opponents; very efficient trades.
- **Weaknesses:** cannot hold open ground; a methodical attacker who clears systematically wins.
- **Arsenal:** favours shared infantry, ATGM, smoke upgrades, electronic warfare; underuses tanks, aircraft and the navy.

### 3.8 Hungary — the line and the mortar

Hungary's kit is cheap fortification: a 1350-hp bunker, a fast-reloading anti-tank team and a mortar that fires from inside a building. Its commanders differ in whether the line or the indirect fire is the point.

**1. Bálint Farkas — "Sánc" (Rampart)**
- **Identity:** A combat engineer who built the eastern line and considers it unfinished. Gruff, practical, obsessive about fields of fire. Traits: methodical, stubborn, blunt.
- **Doctrine:** fortified line / positional defence. Wins by making the position unassailable. Prefers chokepoints and urban ground.
- **Strategic:** economy medium; bunkers before factories' second line; produces Hedgehog teams and rifles; researches Manoeuvre tier 1 for emergency power; heavy static defence in depth; attacks only after the enemy is spent.
- **Tactical:** aggression low; risk low; never leaves a position voluntarily; reinforces the bunker under attack; targets engineers and artillery; answers armour with Hedgehogs, infantry with bunkers and rifles, artillery by dispersing behind structures, air with shared AA, naval by ignoring it, harassment by sealing the approach.
- **Strengths:** the cheapest unbreakable line in the game; excellent on defensive maps.
- **Weaknesses:** cannot counter-attack far; siege artillery and deep strike beat it. Countered by Russia-pattern heavy howitzers and Storm Shadow.
- **Arsenal:** favours Bunker, Hedgehog, shared infantry; underuses tanks, aircraft and the navy.

**2. Zsófia Németh — "Akna" (Mortar)**
- **Identity:** An indirect-fire officer who put tubes where nobody expects them. Dry, precise, quietly amused. Traits: patient, inventive, detached.
- **Doctrine:** indirect defence / fire from cover. Wins by making every building a firing position. Prefers towns and broken ground.
- **Strategic:** economy medium toward research; barracks-heavy; produces Taszar mortar teams and Hedgehogs; researches Fires tier 1 for observed fire; medium defence; attacks by advancing the mortar line.
- **Tactical:** aggression medium; risk low; withdraws teams from threatened buildings; reinforces the fire line; targets infantry clusters and static defences; answers armour with Hedgehogs, infantry with mortars, artillery by occupying structures, air with shared AA, naval by ignoring it, harassment by mortaring the approach.
- **Strengths:** the only commander who can bring indirect fire into a building; very strong in urban fights.
- **Weaknesses:** short range and no answer to armour at distance. Countered by fast armour and counter-battery.
- **Arsenal:** favours Taszar, Hedgehog, Bunker, shared infantry; underuses tanks, air and the navy.

**3. Gergely Tóth — "Tartalék" (Reserve)**
- **Identity:** A reserve officer who keeps his best unit uncommitted. Calm, watchful, quietly ambitious. Traits: patient, flexible, calculating.
- **Doctrine:** defence in depth / mobile counter-attack. Wins by trading the outpost for the attacker's flank. Prefers maps with a defensible centre and open flanks.
- **Strategic:** economy medium-high; one strong centre, thin flanks; produces a small armoured reserve behind the line; researches Manoeuvre tier 1 then tier 2; medium defence forward, strong reserve; attacks the moment the enemy overextends.
- **Tactical:** aggression medium; risk medium; keeps the reserve intact; reinforces by counter-attack rather than reinforcement; targets overextended formations; answers armour with the reserve, infantry with bunkers, artillery by moving the reserve, air with shared AA, naval by ignoring it, harassment with the reserve.
- **Strengths:** punishes overextension better than any other Hungarian commander.
- **Weaknesses:** a patient attacker who does not overextend beats him on economy.
- **Arsenal:** favours Bunker, shared armour, Hedgehog; underuses artillery and air.

### 3.9 Iran — unmanned, dispersed, patient

Iran's kit is unmanned strike and cheap sea denial: an armed UAV, a long-reaching SAM with no gun, a midget submarine and a dispersed coast launcher. Its commanders never seek the fair fight, and differ in which domain they deny.

**1. Reza Farhadi — "Saya" (Shadow)**
- **Identity:** A drone unit commander who came up through signals intelligence. Soft-spoken, watchful, patient to a fault. Traits: patient, curious, unassuming.
- **Doctrine:** unmanned strike / persistent observation. Wins by finding a position and bombing it without ever committing a soldier. Prefers open maps with reachable rear areas.
- **Strategic:** economy high toward air; airfield by minute five; produces Mohajer-6 and shared UAVs continuously; researches Air tier 1 then Manoeuvre tier 1; light defence; attacks when a target is confirmed rather than when an army is ready.
- **Tactical:** aggression medium; risk low; accepts a drone loss only for a structure; reinforces the air campaign; targets air defence, artillery and production; answers armour from the air, infantry with light bombs, artillery by locating it, air with shared interceptors, naval by ignoring it, harassment by watching the raiders leave and striking their base.
- **Strengths:** the cheapest way to remove static defences; superb against turtling opponents.
- **Weaknesses:** four bombs and a thin airframe; layered SAM coverage ends it. Countered by Russia's Long-Range SAM and any concentrated AA.
- **Arsenal:** favours Mohajer-6, shared UAV, Khordad for self-defence; underuses tanks, infantry and the navy.

**2. Leila Sadeghi — "Ghadir"**
- **Identity:** A coastal flotilla officer who trained for the ambush her whole career. Sharp, secretive, competitive. Traits: bold, calculating, proud.
- **Doctrine:** coastal ambush / sea denial. Wins by making the water unusable and by sinking what tries anyway. Prefers coastal maps and chokepoints.
- **Strategic:** economy high toward naval; shipyard and two Noor batteries early; produces Ghadir submarines and missile boats; researches Naval tier 1 then tier 2; medium coastal defence; attacks by sea and by shore launch.
- **Tactical:** aggression medium; risk high with cheap hulls; trades a Ghadir for one good ship; reinforces the ambush line; targets transports, capital ships and landings; answers armour by ignoring it, infantry with coastal fire, artillery by dispersion, air with Khordad, naval with submarines and Noor salvos, harassment by ambushing the raiders at sea.
- **Strengths:** dominant on naval maps; the best trade economy in the game.
- **Weaknesses:** irrelevant inland; the submarine's 52-second battery and 9-second reveal are unforgiving. Countered by Sweden's Visby and any ASW screen.
- **Arsenal:** favours Ghadir, Noor, missile boat, Khordad; underuses armour, infantry and air.

**3. Omid Rahimi — "Tufan" (Storm)**
- **Identity:** An air-defence officer who believes the sky is the decisive flank. Tense, fast-talking, over-prepared. Traits: vigilant, reactive, perfectionist.
- **Doctrine:** area denial / air and coastal screens. Wins by making the opponent's best arm unusable. Prefers maps with predictable approach corridors.
- **Strategic:** economy medium-high; Khordad batteries and Noor launchers before armour; produces shared AA and infantry; researches Air tier 1 for interceptors; heavy static defence; attacks only when the opponent's air and navy are neutralised.
- **Tactical:** aggression low; risk low; withdraws launchers under fire; reinforces the screen; targets aircraft, helicopters and landing craft; answers armour with shared ATGM, infantry with nests, artillery by dispersal, air with overlapping Khordad coverage, naval with Noor, harassment by sealing the air and sea routes.
- **Strengths:** the strongest counter to air- and naval-heavy commanders.
- **Weaknesses:** spends the match reacting; a pure ground push beats him. Countered by Poland and North Korea.
- **Arsenal:** favours Khordad, Noor, shared AA; underuses tanks, drones and offensive infantry.

### 3.10 North Korea — the siege army

North Korea's kit is long-range anti-armour and siege fires: an eight-round 14-tile missile carrier, the longest tube in the game and an entrenched anti-tank strongpoint. Its commanders all believe the defender should be destroyed from a distance, and differ in how much manoeuvre they allow.

**1. Han Chol-su — "Koksan"**
- **Identity:** A corps artillery commander who has never fought a mobile battle and does not intend to start. Loud, certain, impatient with staff work. Traits: forceful, direct, inflexible.
- **Doctrine:** siege fires / counter-battery supremacy. Wins by out-ranging every gun on the map. Prefers static fronts and fortified maps.
- **Strategic:** economy high toward power and refineries; two factories, batteries first; produces Koksan and shared howitzers in number; researches Fires tier 1 then tier 2; heavy static defence around the guns; attacks once the battery can reach the enemy's guns.
- **Tactical:** aggression medium; risk low; never advances the battery unsupported; reinforces the gun line; targets enemy artillery, bunkers and production; answers armour with massed 170 mm, infantry with the same, artillery by counter-battery, air with shared AA, naval with coastal guns, harassment by shelling the staging area.
- **Strengths:** the longest reach in the game; wins artillery duels outright.
- **Weaknesses:** immobile and blind; a fast push reaches the battery. Countered by Sweden's tempo and Britain's deep strike.
- **Arsenal:** favours Koksan, shared SPG, Entrenched AT Gun; underuses tanks, aircraft and the navy.

**2. Ri Sol-mi — "Yŏksa" (Strongpoint)**
- **Identity:** A fortification engineer who treats every hill as a permanent position. Quiet, exacting, unyielding. Traits: disciplined, patient, severe.
- **Doctrine:** entrenched defence / anti-armour strongpoints. Wins by making the approach cost more than the objective. Prefers ridges and narrow approaches.
- **Strategic:** economy medium; strongpoints before a second factory; produces Entrenched AT Guns and Bulsae carriers; researches Manoeuvre tier 2 for hull-down; heavy defence in depth; attacks only to retake a lost strongpoint.
- **Tactical:** aggression low; risk low; never abandons a strongpoint; reinforces the threatened one; targets engineers and artillery; answers armour with Bulsae and entrenched guns, infantry with nests, artillery by dispersion, air with shared AA, naval by ignoring it, harassment by sealing the approach.
- **Strengths:** the toughest anti-armour line in the game.
- **Weaknesses:** no reach beyond the position; siege artillery beats fortifications. Countered by Russia and Britain.
- **Arsenal:** favours Entrenched AT Gun, Bulsae, shared infantry; underuses tanks, air and the navy.

**3. Kang Dae-sung — "Ch'ong" (Volley)**
- **Identity:** A missile-carrier commander who fights in ambushes from fourteen tiles. Restless, sardonic, quietly aggressive. Traits: cunning, impatient, daring.
- **Doctrine:** stand-off ambush / anti-armour manoeuvre. Wins by emptying a rack into a column and leaving. Prefers broken ground with firing lanes.
- **Strategic:** economy medium; factory early; produces Bulsae carriers with shared recon; researches Manoeuvre tier 1 for speed; light defence; attacks at 5–7 minutes against armour.
- **Tactical:** aggression high; risk medium; withdraws an emptied carrier; reinforces the ambush; targets tank columns and recovery vehicles; answers armour with Bulsae volleys, infantry by avoiding it, artillery by relocating, air with shared AA, naval by ignoring it, harassment by ambushing the raiders.
- **Strengths:** the best armour-killer per material in the game; punishes tank-heavy commanders.
- **Weaknesses:** cannot fight infantry; eight rounds then a long drive home. Countered by infantry swarms and air.
- **Arsenal:** favours Bulsae, shared recon, APC; underuses Koksan, infantry and the navy.

---

## 4. Commander comparison matrix

Aggression: 1 = deliberate, 5 = relentless. Economy: L = lean, B = balanced, H = invested.

| # | Nation | Commander | Primary | Secondary | Agg | Econ | Preferred force | Signature kit | Main strength | Main weakness |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | Lithuania | Rasa Vilkas | Recon screen | Air denial | 2 | L | Pathfinder + Kestrel + coalition armour | Pathfinder, Kestrel | Never surprised | Cannot break a line |
| 2 | Lithuania | Tomas Beržas | Sensor grid | Observed fires | 2 | B | Forward Posts + SPG | Forward Post, Fire-Control Net | Counter-battery | Grid is fragile |
| 3 | Lithuania | Aistė Narušytė | Raid and withdraw | Air-mobile harassment | 5 | L | Pathfinder + APC + Kestrel | Transport helo, APC | Ends matches early | No staying power |
| 4 | Poland | Krzysztof Zawadzki | Armoured breakthrough | Attrition | 5 | B | Spearhead mass | Spearhead, Armour Works | Direct knockout | Predictable axis |
| 5 | Poland | Marta Zielińska | Mechanised combined arms | Layered assault | 3 | B | Wilk + Spearhead + infantry | Wilk | Consistency | Slow to exploit |
| 6 | Poland | Piotr Grabowski | Armoured defence | Counter-punch | 2 | H | Hull-down armour + TD | Spearhead, AT turret | Beats first waves | Yields initiative |
| 7 | UK | Eleanor Hayes | Saturation fires | Area denial | 4 | H | MLRS + rocket artillery | Rocket Battery | Deletes static defence | Dispersed targets |
| 8 | UK | James Ashcroft | Deep strike | Decapitation | 3 | H | Storm Shadow + UAV | Storm Shadow | Wins without battle | Useless at close range |
| 9 | UK | Nadia Okoro | Expeditionary tempo | Air-land manoeuvre | 4 | B | Airfield + helo + APC | Expeditionary Airfield | Exploits flanks | Airfield is the plan |
| 10 | Finland | Aino Korhonen | Territorial defence | Infantry attrition | 1 | B | Garrison infantry + ATGM | Garrison Barracks | Holds narrow fronts | Cannot exploit |
| 11 | Finland | Juhani Rautio | Stand-off killing | Observed fire | 2 | H | K9 + Spike pairs | K9 Thunder, Spike | Kills armour at range | Blind without observers |
| 12 | Finland | Sanna Lahti | Encirclement | Interdiction | 5 | L | APC packets + Spike | Spike, APC | Punishes columns | Loses set pieces |
| 13 | Sweden | Elin Sjöberg | Mobile combined arms | Tempo | 4 | B | CV90 + APC + infantry | CV90 | Forces reaction | Thin hulls |
| 14 | Sweden | Magnus Åkesson | Littoral control | Flanking | 3 | H | Visby + landing craft | Visby, Kockums | Opens a second front | Map-dependent |
| 15 | Sweden | Tove Lindqvist | Air-mobile precision | Strike | 4 | H | Gripen + UAV | Gripen | Decapitation | Five rounds, short fuel |
| 16 | Russia | Viktor Sokolov | Siege fires | Position reduction | 3 | H | Heavy howitzer batteries | Heavy Howitzer | Grinds fortifications | Immobile |
| 17 | Russia | Irina Volkova | Deep battle | Echeloned pressure | 4 | B | Mixed armour + TOSP echelons | TOSP | Sustains pressure | Needs deep economy |
| 18 | Russia | Sergei Markov | Fortified attrition | Counter-attack | 2 | H | Hull-down guns + SAM | Long-Range SAM | Beats armoured pushes | Concedes tempo |
| 19 | Belarus | Andrei Kazlou | Deep surveillance | Technological edge | 3 | H | Deep UAV + research | Deep Recon UAV, Signals Bureau | Information + tech lead | Fragile sensors |
| 20 | Belarus | Volha Maroz | Recon saturation | Map control | 5 | L | Sprut swarms | Sprut | Finds the empty base | No staying power |
| 21 | Belarus | Mikalai Barys | Deception | Ambush defence | 2 | B | Hidden infantry + ATGM | Electronic warfare | Efficient trades | Cannot hold open ground |
| 22 | Hungary | Bálint Farkas | Fortified line | Positional defence | 1 | B | Bunkers + Hedgehogs | Bunker | Cheap unbreakable line | No counter-attack |
| 23 | Hungary | Zsófia Németh | Indirect defence | Fire from cover | 3 | B | Taszar teams in buildings | Taszar | Urban indirect fire | Short range |
| 24 | Hungary | Gergely Tóth | Defence in depth | Mobile counter-attack | 3 | H | Thin line + armoured reserve | Bunker + reserve | Punishes overextension | Loses to patience |
| 25 | Iran | Reza Farhadi | Unmanned strike | Persistent observation | 3 | H | Mohajer-6 + UAV | Mohajer-6 | Removes static defence | Four bombs |
| 26 | Iran | Leila Sadeghi | Coastal ambush | Sea denial | 3 | H | Ghadir + Noor | Ghadir, Noor | Dominant at sea | Irrelevant inland |
| 27 | Iran | Omid Rahimi | Area denial | Air/coastal screens | 2 | B | Khordad + Noor + infantry | Khordad | Counters air and navy | Purely reactive |
| 28 | N. Korea | Han Chol-su | Siege fires | Counter-battery | 3 | H | Koksan batteries | Koksan | Longest reach | Immobile and blind |
| 29 | N. Korea | Ri Sol-mi | Entrenched defence | Anti-armour strongpoints | 1 | B | Bulsae + entrenched guns | Entrenched AT Gun | Toughest AT line | No reach |
| 30 | N. Korea | Kang Dae-sung | Stand-off ambush | Anti-armour manoeuvre | 4 | B | Bulsae carriers + recon | Bulsae-4 | Best armour trade | Cannot fight infantry |

### 4.1 Overlap review

Three clusters were close enough to need explicit separation, and each is resolved by a different *execution*, not a different label:

- **Siege fires (Sokolov, Han Chol-su, Hayes).** Sokolov reduces *positions* with 203 mm and never moves; Han Chol-su fights *counter-battery* with the longest tube; Hayes saturates *area* with rockets and accepts scatter. Different targets, different target-selection weights, different willingness to relocate.
- **Fortified defence (Markov, Farkas, Ri Sol-mi, Grabowski, Korhonen).** Markov counters armour with SAM coverage and a late armoured answer; Farkas builds the cheapest dense line; Ri Sol-mi anchors anti-armour strongpoints; Grabowski keeps a mobile armoured counter-punch; Korhonen spreads cheap barracks across sectors. Each has a distinct build order and a distinct reaction to being flanked.
- **Reconnaissance (Vilkas, Maroz, Kazlou).** Vilkas screens *for* the coalition army; Maroz swarms to find the empty base; Kazlou converts vision into a research lead. Their economies differ more than their sensors do.

No two commanders share both a primary doctrine and an aggression/economy pair with the same preferred force, which is the minimum bar for a recognisable opponent.

---

## 5. Difficulty framework

Difficulty changes **execution quality**, never doctrine and never the economy. The existing `DIFFICULTY_BIAS` table already works this way and is the correct base to extend.

| Dimension | Recruit | Veteran | Elite |
|---|---|---|---|
| Decision cadence (`reactionTicks`) | ~90 ticks (4.5 s) | 20 ticks (1 s) | 8 ticks (0.4 s) |
| Scouting response (`responseWeight`) | 0.15 — mostly ignores what it sees | 0.55 | 0.95 — counters the scouted mix |
| Commit (`commitShare`) | 0.35 — feeds units in | 1.0 — one wave | 0.85 — coordinated, keeps a reserve |
| Recall on base attack | No | Yes | Yes, with 2 units held back |
| Economy protection | No — haulers work until they burn | Yes | Yes |
| Tactical abilities | No | Yes | Yes, ~0.5 s earlier |
| Threat assessment | Nearest enemy | Nearest threatening enemy | Weighted by damage, role and arrival time |
| Counter-selection | Fixed weights | Adjusts to scouted mix | Adjusts per engagement, re-checks after losses |
| Timing | Attacks when a unit exists | Attacks when the wave is complete | Attacks when the enemy is out of position |

**New execution knobs required (not implemented in this phase):** `threatHorizon` (how far ahead it predicts), `counterAccuracy` (probability of choosing the right answer given the scouted mix), `targetPriorityNoise` (mis-prioritisation rate), `retreatThreshold` (health at which it disengages), `combinedArmsTolerance` (how long it waits for the slower arm). These are all *judgement* parameters and fit the existing profile shape; none touches income, vision, build time or combat values.

A commander at Recruit still does what its doctrine says — Sokolov still shells positions, Narušytė still raids — but does it late, partially, and with the wrong target half the time.

---

## 6. Learning architecture

### 6.1 Individual commander learning

Each commander owns a parameter vector over its profile plus a small library of situational rules ("against a fortified line, prefer X"). Training runs commander-vs-commander matches on a fixed map/seed set and scores by objective outcomes, not by survival. The vector is constrained to a box around the authored doctrine, so learning refines `aggression` from 4.0 to 4.3, never from 4.0 to 1.0.

### 6.2 Shared tactical knowledge

A tactic is stored as a *tagged* record: the situation it applies to, the response, the required capabilities, and its measured effect. A commander may import a record only if its roster resolves every required capability — `productionEntries()` and the research catalogue are the gate. A record that requires a Ghadir submarine is invisible to Poland, and a record that requires armour is downgraded rather than adopted by Narušytė.

### 6.3 Boundaries and anti-collapse

- **Identity floor:** each commander's parameter vector is clamped to its authored band, and a candidate is rejected if its doctrine-classification distance from the authored profile exceeds a threshold.
- **Diversity pressure:** population selection rewards being *different from* the current best as well as winning; a shared tactic must beat the incumbent in at least two commanders' populations before promotion.
- **Validation opponents:** every promoted change is replayed against a frozen previous-generation pool and against the scripted difficulty ladder, not only against the current population.
- **Exploit screening:** matches that end in under three minutes, or that depend on a single unit type above a share threshold, are flagged and excluded from learning.
- **Human-ladder regression:** the 48-match `ai-matchups` ladder and the national identity suites are hard gates; a candidate that shifts difficulty ordering is rejected regardless of its AI-v-AI score.
- **Knowledge versioning:** every learned set carries a version and a source generation; released game data never imports a training-generation set without review.

---

## 7. Technical architecture proposal

**Fit to the existing engine, not a rewrite.** The current single planner already parameterises personality through `AIProfile`; the change is to make that profile *authored per commander* instead of hashed from the match seed.

1. **`CommanderProfile` (data, `src/data/commanders.ts`)** — id, nation, name, callsign, biography, primary/secondary doctrine, `strategy`, the eight existing scalars, doctrine tags, preferred-slot weights and capability tags. Pure data; frozen; no functions.
2. **Profile resolution (`aiProfile(seed, difficulty, commanderId?)`)** — keeps its current signature and behaviour when no commander is supplied, so every existing test, replay and save is untouched. With a commander, the authored scalars replace the seed hash and the difficulty bias is applied on top, exactly as now.
3. **Difficulty stays separate** — `DIFFICULTY_BIAS` remains the only source of level differences; commander data must not encode level behaviour.
4. **Determinism** — the profile is a pure function of (commander id, difficulty); any per-match variation continues to come from `mix32(seed)` in the same places it does today.
5. **Save compatibility** — persist `commanderId` and a `profileVersion`; a save without them resolves to the legacy seeded profile, which is what today's saves already are.
6. **Production and construction** — the existing `STRATEGY_ARMY`, `STRATEGY_OPENING` and `armyWeights()` already express doctrine as weights. Commander profiles supply *their own* weight tables rather than a new decision path.
7. **Runtime cost** — one frozen profile object per side per match; no per-tick allocation, no new scans.
8. **Additive growth** — a new commander is a new data row, not new AI code; a new nation needs only its roster plus three rows.

**Minimum changes:** add the data module, thread an optional `commanderId` through `aiProfile` and the match setup, and give `AIProfile` a few execution fields. Nothing else in the planner needs restructuring.

---

## 8. Skirmish selection experience

Flow: **opposing nation → commander (three cards) → difficulty → map and settings**. The nation picker stays as it is; the commander step is a row of three cards, each showing portrait, name and callsign, doctrine line, signature equipment chips, and two short lines — "strong at" / "struggles with". Difficulty is a separate segmented control below, so the player can see that the same commander offers three experiences. A one-line summary under the cards reads back the choice ("You will face a siege artillery commander who will not manoeuvre"). No assets are designed in this phase.

---

## 9. Implementation roadmap

| Phase | Scope | Depends on |
|---|---|---|
| **2** | `CommanderProfile` data module, 30 entries, `aiProfile` threading, profile versioning and save field. No behaviour change. | 1 |
| **3** | Doctrine-weighted production and construction: per-commander `STRATEGY_ARMY` / `STRATEGY_OPENING` tables and preferred-slot weights. | 2 |
| **4** | Tactical personality: target priority, retreat thresholds, response weights, preferred engagement range. | 2, 3 |
| **5** | Difficulty integration: the new execution knobs, and a regression proving each commander stays doctrine-recognisable at all three levels. | 3, 4 |
| **6** | Match setup and skirmish selection: commander choice threaded through scenarios, saves and multiplayer room settings. | 2 |
| **7** | Offline self-play laboratory: headless runner, resumable batches, fixed map/seed sets, result schema. | 5 |
| **8** | Evolutionary strategy optimisation within the authored bands, with diversity pressure. | 7 |
| **9** | Shared tactical knowledge: tagged records, capability gating, promotion and validation. | 8 |
| **10** | Human-vs-AI validation and the release gate: ladder, identity suites, anti-exploit screening, balance review. | 5, 9 |
| **11** | Skirmish opponent-selection UI and final presentation of the roster. | 6, 10 |

The order follows dependencies: profiles must exist before weights, weights before tactical behaviour, behaviour before difficulty can judge it, and nothing learned is trustworthy before the ladder gate exists.

---

## 10. Open dependencies

- **Doctrine tags are display-only today.** `NationDef.doctrine` is a string; the commander layer needs its own structured tags.
- **`AIStrategy` has five values**, not thirty. Commanders must map onto the existing five for force selection or the weight tables must become per-commander. Phase 3 assumes the latter.
- **No naval-aware AI planning** exists beyond production; Sadeghi's and Åkesson's doctrines depend on it and cannot be judged until Phase 4.
- **No `commanderId` in scenario or save schemas**; Phase 2 adds it with a legacy default.
- **The 900-second benchmark ceiling** truncates roughly half of measured matches, so self-play scoring must use objective deltas, not only wins.

