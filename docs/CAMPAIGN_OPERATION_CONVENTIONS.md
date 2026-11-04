# Campaign operation conventions

The campaign is two twelve-operation chains: `baltic-01..12` in the Baltic Line
([opsBaltic.ts](../src/data/campaign/opsBaltic.ts)) and `corridor-01..12` in the
Eastern Corridor ([opsEastern.ts](../src/data/campaign/opsEastern.ts)). This note
records the conventions both chains follow so the next operation is written the
same way.

## Documents, not templates

An operation is a `CampaignMission` in [src/data/campaign.ts](../src/data/campaign.ts)
carrying a real, versioned `MissionDoc`. Each operation is built with
`buildOperation(spec)` from [missionKit.ts](../src/data/campaign/missionKit.ts)
and owns its own objectives, regions, triggers and cinematics; the kit only
generates the shared briefing/debrief/cinematic/consequence scaffolding.

Authoring rules that follow from the runtime:

- Only these conditions exist: `elapsed`, `variable`, `objective`,
  `entityAlive`, `entityDead`, `regionOccupied`.
- Only these actions execute: `setObjective`, `setVariable`, `message`.
  `activateAiGroup`, `spawnReinforcement` and `endMission` are deferred
  placeholders — never author them and never imply they run.
- Victory is every `primary` objective complete. One failed primary is a
  defeat, and the engine also ends the operation when the player's command post
  (or any other keyed command post the player owns) falls.
- A hidden objective (dependency or `initialState: 'hidden'`) is invisible to
  the HUD. If a trigger has to complete it, the trigger must also wait for the
  objective to be `active`, and some authored action should activate it so the
  document reads honestly.

## Identifiers

| Kind | Convention | Example |
| --- | --- | --- |
| Operation / mission id | `campaign-prefix-NN`, stable forever | `baltic-01`, `corridor-01` |
| Theatre / map id | names the operation's ground, one per operation | `kestrel-beach`, `red-beach` |
| Objective id | kebab-case verb phrase, mission-scoped | `hold-beachhead`, `break-corps` |
| Trigger id | names the event, not the action order | `beachhead-held`, `beachhead-lost`, `pass-open` |
| Region id | names the ground | `beachhead`, `village`, `ridge-pass` |
| Entity key | role-prefixed, stable across replays | `own-hq`, `enemy-hq` |

Trigger ids are also the tie-break for equal priorities, so they should read in
the order the operation is likely to reach.

## Entities and veterans

- The campaign builder re-keys the two command posts it finds: `own-hq` (the
  player's) and `enemy-hq` (the opposing one). Those two keys always exist.
- Any other entity an operation refers to must be placed and keyed by its own
  theatre (`structure(defId, owner, x, z, { key })` or `unit(..., key)`), using
  the same key as the document's `entities` entry. A keyed ruin is how the
  quarry works in `baltic-06`; a keyed vehicle is how a named asset works.
- Never rely on an unkeyed placement being addressable: regions and
  `regionOccupied` are the tool for ground that has no authored identity.
- `protectedEntities` on an objective records which authored key has to survive
  for a clean result. Both openings mark their bonus objective with `own-hq`.
- A veteran slot (`veterans[]`) must not appear in the document's `entities`
  list: the builder appends it only when the named individual is alive and
  actually deployed. Naming it in the document would duplicate the key.
- Names in `briefing.personnel` are prose. They must match the campaign roster
  in `VETERAN_NAMES` so a reformatted roster does not silently disagree with
  the briefing.

## Objectives

- Primary objectives are the win conditions and nothing else. Two phases are
  the useful maximum for an opening: secure the footing, then break the
  opponent.
- Dependencies are used for genuine phases, and the dependent objective opens
  hidden. Never use a dependency to restate the same requirement.
- Secondary objectives are one extra spatial goal the map already supports
  (`take the village`, `secure the crossroads`).
- Bonus objectives reward execution, not extra tasks: "break their command post
  with your own intact" or "hold the pass after the breakthrough".
- Objective titles appear in three places — the document, the HUD string list
  (`CampaignMission.objectives`) and the briefing instructions. Keep the same
  phrase in all three.

## Triggers

- Priority selects between mutually exclusive outcomes: the success case runs
  first and the failure case is conditioned on the objective still being
  `active`. That is how an if/else is expressed, because conditions are AND-only.
- A deadline trigger is a single evaluation at `elapsed`; it must have both an
  outcome that completes and an outcome that fails, or the operation can stall.
- Timed messages are clock facts the player can verify ("convoy is on final
  approach"), never claims about AI behaviour the mission cannot observe.
- Every trigger that completes an objective carries a `message` so the player
  sees the transition in the log as well as the objective panel.

## Regions

- Regions are authored in tile coordinates and must sit inside the theatre.
- Every region must be observed by a trigger, an AI group or a reinforcement,
  or it is dead data (the validator warns).
- Regions used for objectives are sized to the ground the player will fight
  over, not to the single tile of a structure.

## Cinematics

- Exactly one sequence per context: `opening`, `inMission`, `ending`. The
  runtime plays one per context; a second is silently ignored.
- `inMission` requires `atSeconds`.
- The opening frames friendly ground only. Nothing that is still under fog is
  filmed, because an unexplored framing is a black frame.
- Keep sequences short: a cut, one or two lines, a pull-back. Camera positions
  for a status beat sit on the player's own side of the map.
- Speakers are commands and callsigns ("Baltic Task Force Command",
  "Beachmaster"), not the player's own name.

## Briefings and debriefs

`briefing.summary`, `friendly` and `enemy` are required; `subtitle`, `context`,
`commanderNote`, `enemyIntent`, `personnel` and `instructions` are used in both
openings. Rules:

- `summary` is what the player is about to do, `context` is why it matters.
- `enemy` is the order of battle, `enemyIntent` is what they are trying to do.
- `instructions` repeat the observable rules: the deadline, the entity that must
  survive, how many units a region needs.
- `{{callsign}}` appears once per operation at most.
- Debrief copy describes the outcome in narrative terms and never contradicts
  `MissionResult`: no casualty figures, no claims about objectives the result
  does not carry.

## Campaign progression

- Operations are ordered by array position; `mission.campaign.order` must match
  (`1..12`). Each campaign's operations array is the unlock order, and every
  operation has its own theatre.
- `side` equals the campaign `allianceId` (`defender`, `eastern`).
- Consequences write campaign variables that already exist in
  `CampaignDef.variables` — currently `standing` and `lastOperation`.
- Cross-campaign consequences (the Baltic beachhead state mattering to the
  eastern corridor) are **not** representable: campaign runs are independent.
  That remains a design opportunity, not something an operation may fake.

## Per-operation roster and technology

Every operation theatre declares a `restrictions` block on the player's
`TheatrePlayerSpec` (`units`, `buildings`, `technologies`). The values name
canonical slots or concrete ids and are enforced by the simulation, not by the
UI alone: `unitDefinitionUnlocked`, research and construction all consult them.

- Early operations restrict the widest platforms (heavy armour, air, naval) and
  the technologies that unlock them; later operations widen the list.
- Restrictions are authored per side. A corridor operation fighting the same
theatre as a Baltic operation may have a different list.
- The research panel shows restricted nodes as outside this operation. Do not
  describe them as research the player can pursue.
- A restricted platform must not appear in the operation's starting force.
  Tests in [campaign-restrictions.test.ts](../tests/campaign-restrictions.test.ts)
  check the starting force, production and research against the list.

## Checklist for a new operation

1. Author or pick a bespoke theatre and add it to `OPERATION_SCENARIOS` with
   `campaign`. Do not reuse a competitive map for campaign content.
2. Write the operation with `buildOperation` and give it its own theatre.
3. Reference `own-hq`, `enemy-hq`, keyed theatre entities and regions only.
4. Give every primary a trigger that can complete it, and the operation a
   defeat path the runtime can reach. Observe every authored region.
5. Watch the validator: zero errors and zero warnings on the campaign definition.
6. Add the operation to [campaign-chain.test.ts](../tests/campaign-chain.test.ts)
   and its roster limits to [campaign-restrictions.test.ts](../tests/campaign-restrictions.test.ts).
