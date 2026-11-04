/**
 * The Baltic Line — twelve operations.
 *
 * The campaign is one continuous account of the coalition defence of the Baltic
 * coast, told through the battlegroups the player's commander is given: a
 * Lithuanian beachhead, Polish armour, a UK task force, a Finnish screen, then a
 * Swedish counter-stroke. Each operation names the force it hands the commander,
 * and the roster the operation itself supports.
 *
 * The mission documents are authored data. Objectives, regions, triggers and
 * cinematics all use the same runtime the campaign and skirmish share; nothing
 * in this file adds a rule the simulation does not already enforce.
 */
import type { CampaignVeteranSlot } from '../../campaign/types';
import type { MissionEntityDoc, MissionObjectiveDoc, MissionTriggerDoc } from '../../mission/types';
import {
  AMBER_COAST_REGIONS,
  CONVOY_LANE_REGIONS,
  CORRIDOR_BREAK_REGIONS,
  FOUNDRY_RELIEF_REGIONS,
  GRANITE_STEPS_REGIONS,
  KESTREL_BEACH_REGIONS,
  LAPLAND_WATCH_REGIONS,
  RAIL_JUNCTION_REGIONS,
  RUST_PASS_REGIONS,
  SIGNAL_HILL_REGIONS,
  STRAITS_FINAL_REGIONS,
  STRAIT_DENIAL_REGIONS,
} from './mapsBaltic';
import {
  announce,
  breakCommandPost,
  buildOperation,
  cleanSweepTrigger,
  deadline,
  destroyEntity,
  objective,
  regionReport,
  secureRegion,
  type AuthoredOperation,
} from './missionKit';

const KESTREL: CampaignVeteranSlot = { key: 'kestrel-rifle', veteranId: 'vet-kestrel', defId: 'rifle' };
const VILKAS: CampaignVeteranSlot = { key: 'vilkas-medic', veteranId: 'vet-vilkas', defId: 'medic' };

/** The two headquarters every operation's document names. */
function commandPair(): MissionEntityDoc[] {
  return [
    { key: 'own-hq', name: 'Coalition Command Post', role: 'protected' },
    { key: 'enemy-hq', name: 'Corps Command Post', role: 'objective' },
  ];
}

/** The shared bonus objective: break them with our own headquarters standing. */
function cleanSweepObjective(): MissionObjectiveDoc {
  return objective('clean-sweep', 'Break their command post with ours intact', 'bonus', {
    description: 'A clean operation: their headquarters falls and the coalition command post still stands.',
    protectedEntities: ['own-hq'],
  });
}

/* ------------------------------------------------------------------ */
/* 01 — Kestrel Beachhead                                              */
/* ------------------------------------------------------------------ */

const kestrelBeachhead: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 1,
  id: 'baltic-01',
  code: 'BALTIC / 01',
  name: 'Kestrel Beachhead',
  mapId: 'kestrel-beach',
  focus: 'Beachhead · Hold the line',
  situation:
    'The 11th Corps has dug into the ridge above Kestrel Bay. A Lithuanian battlegroup holds the western beachhead while the convoy carrying the next echelon is still at sea.',
  context:
    'Kestrel Bay is the coalition northern supply route. Lose the beachhead and the expeditionary corps can roll up the coast before the next convoy lands.',
  threat: 'Corps armour and rifle strength on the eastern plateau, and pressure on the beachhead line.',
  playerNationId: 'lithuania',
  opponentNationId: 'russia',
  briefing: {
    summary:
      'The corps is dug in above the bay and the convoy is still at sea. Hold the beachhead until it lands, then break their command post on the eastern plateau.',
    subtitle: 'Beachhead · Hold the line',
    context:
      'Kestrel Bay is the coalition northern supply route. Lose the beachhead and the expeditionary corps can roll up the coast before the next convoy arrives.',
    commanderNote:
      '{{callsign}}, the beach is yours. Ten minutes of held ground buys the convoy its landing; after that the corps has to answer for the ridge.',
    friendly:
      'Lithuanian battlegroup: rifle sections, anti-tank teams, a reconnaissance troop and an engineer party, with the command post on the beachhead. The armour, the guns and the air are still at sea — the convoy brings all three.',
    enemy:
      '11th Expeditionary Corps: matched armour and rifle strength holding the eastern plateau and the village crossroads.',
    enemyIntent:
      'Probe the beachhead, fix the landing force, and break the command post before the convoy gets ashore.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section'],
    instructions: [
      'Keep at least three units inside the beachhead line until the convoy lands at 10:00.',
      'Losing the command post ends the operation.',
      'Once the convoy is ashore, break the corps command post on the eastern plateau.',
      'The village crossroads carries their forward supply — take it when the line is secure.',
    ],
  },
  debrief: {
    victory:
      'The convoy is ashore and the beachhead holds. With the corps command post broken, the ridge is open and the coalition can push inland.',
    defeat:
      'The beachhead line did not hold to the convoy, or the command post fell. The corps still owns the ridge, and the next convoy will have to find another landing.',
  },
  objectives: [
    objective('hold-beachhead', 'Hold the beachhead line until the convoy lands', 'primary', {
      description:
        'At 10:00, at least three of your units must be inside the beachhead line. An unheld line at the deadline fails the operation.',
    }),
    objective('break-corps', 'Break the corps command post on the eastern plateau', 'primary', {
      description: 'The corps cannot hold the ridge without its command post.',
      dependsOn: ['hold-beachhead'],
    }),
    objective('secure-village', 'Take the village crossroads', 'secondary', {
      description:
        'The relay and depot east of the pass supply the corps line. Two units in the village secure it.',
    }),
    cleanSweepObjective(),
  ],
  variables: [
    { id: 'convoy', type: 'string', default: 'inbound', description: 'Landing state of the coalition convoy.' },
  ],
  regions: [
    KESTREL_BEACH_REGIONS.beachhead,
    KESTREL_BEACH_REGIONS.village,
    KESTREL_BEACH_REGIONS.pass,
  ],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'corps-hq-broken',
      objective: 'break-corps',
      message: 'Corps command post destroyed. The ridge is open.',
    }),
    ...deadline({
      id: 'beachhead-held',
      seconds: 600,
      objective: 'hold-beachhead',
      region: 'beachhead',
      atLeast: 3,
      successMessage: 'Convoy is ashore. The beachhead holds — take the fight to the ridge.',
      failureMessage: 'The beachhead line is empty at the deadline. The convoy has no landing.',
      unlock: 'break-corps',
      variable: { id: 'convoy', value: 'landed' },
    }),
    secureRegion({
      id: 'pass-crossed',
      objective: 'break-corps',
      region: 'ridge-pass',
      atLeast: 2,
      message: 'Through the ridge pass — the corps plateau is in reach.',
      priority: 15,
    }),
    secureRegion({
      id: 'village-taken',
      objective: 'secure-village',
      region: 'village',
      atLeast: 2,
      message: 'Village crossroads secured — the corps line loses its forward supply.',
      priority: 20,
    }),
    announce('convoy-final-approach', 420, 'Convoy is on final approach: three minutes to the beachhead.'),
  ],
  entities: [...commandPair(), { key: 'village-relay', name: 'Village Relay', role: 'asset' }],
  opening: {
    speaker: 'Baltic Task Force Command',
    lines: [
      '{{callsign}}, the corps is dug in above the bay and the convoy is still at sea. Hold the beachhead until it lands.',
      'The ridge pass is the only way east. Everything the corps has is behind it.',
    ],
    target: { kind: 'position', x: 22, z: 38 },
    zoom: 40,
  },
  inMission: {
    id: 'convoy-approach',
    atSeconds: 420,
    speaker: 'Beachmaster',
    lines: ['Convoy is on final approach. Beachhead traffic is heavy — hold the line.'],
    target: { kind: 'position', x: 20, z: 44 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Kestrel Beachhead is accepted. The ridge is open — the passes come next.'],
  },
  veterans: [KESTREL],
});

/* ------------------------------------------------------------------ */
/* 02 — Rust Pass                                                      */
/* ------------------------------------------------------------------ */

const rustPass: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 2,
  id: 'baltic-02',
  code: 'BALTIC / 02',
  name: 'Rust Pass',
  mapId: 'rust-pass',
  focus: 'Armour · Two passes',
  situation:
    'Polish armour has landed behind the beachhead and must force the two passes of Rust Valley before Belarus can fortify the ridgeline.',
  context:
    'The passes are the only armoured route between the coast and the eastern plain. Whoever holds the high ground decides where the next phase is fought.',
  threat: 'Massed armour and prepared anti-tank screens in both passes, with a forward depot feeding them.',
  playerNationId: 'poland',
  opponentNationId: 'belarus',
  briefing: {
    subtitle: 'Armour · Two passes',
    context:
      'The two passes are the only armoured route between the coast and the eastern plain. Polish armour has to force them before Belarus fortifies the ridgeline.',
    commanderNote:
      '{{callsign}}, you have the armour and nothing else. No guns, no air. Take both passes and the eastern plain is ours.',
    friendly:
      'Polish armoured battlegroup: two MBTs, two rifle sections, anti-tank teams and engineers. Both passes must be held at once.',
    enemy:
      'Belarusian armoured group: matched armour dug into the massif, with anti-tank screens covering each pass mouth.',
    enemyIntent:
      'Hold both pass mouths, bleed the armour in the narrows and keep the forward depot running.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section', 'Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Open the north pass first: three units inside it.',
      'Then open the south pass before their reserves arrive.',
      'Losing the command post ends the operation.',
      'Their forward depot sits behind the south pass; taking it cuts their repair chain.',
    ],
  },
  debrief: {
    victory:
      'Both passes are open. Belarus has withdrawn behind the eastern plain, and coalition armour can choose its own ground for the first time this campaign.',
    defeat:
      'The passes stayed shut, or the command post fell. The armour is spent against the massif and the eastern plain stays closed.',
  },
  objectives: [
    objective('open-north-pass', 'Open the north pass', 'primary', {
      description: 'Three units inside the north pass clear the narrows for the column.',
    }),
    objective('open-south-pass', 'Open the south pass', 'primary', {
      description: 'The second pass must fall before their reserves arrive.',
      dependsOn: ['open-north-pass'],
    }),
    objective('break-belarus-hq', 'Break the Belarusian command post', 'primary', {
      description: 'Beyond the passes, their headquarters is what holds the eastern plain.',
      dependsOn: ['open-south-pass'],
    }),
    objective('take-depot', 'Take the forward depot', 'secondary', {
      description: 'The depot behind the south pass repairs their armour. Two units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [RUST_PASS_REGIONS.northPass, RUST_PASS_REGIONS.southPass, RUST_PASS_REGIONS.depot],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'belarus-hq-broken',
      objective: 'break-belarus-hq',
      message: 'Belarusian command post destroyed. The eastern plain is open.',
    }),
    secureRegion({
      id: 'north-pass-open',
      objective: 'open-north-pass',
      region: 'north-pass',
      atLeast: 3,
      message: 'North pass open — the column is through the first narrows.',
      unlock: 'open-south-pass',
    }),
    secureRegion({
      id: 'south-pass-open',
      objective: 'open-south-pass',
      region: 'south-pass',
      atLeast: 3,
      message: 'South pass open. Their reserves are still an hour out — break the command post.',
      unlock: 'break-belarus-hq',
    }),
    secureRegion({
      id: 'depot-taken',
      objective: 'take-depot',
      region: 'depot',
      atLeast: 2,
      message: 'Forward depot taken — their armour loses its repair chain.',
      priority: 25,
    }),
    announce('belarus-reserves', 300, 'Belarusian reserves are moving up from the eastern plain.'),
    announce('massif-shelled', 480, 'Their anti-tank screens are still holding the south mouth.'),
  ],
  entities: [...commandPair(), { key: 'belarus-depot', name: 'Belarusian Forward Depot', role: 'objective' }],
  opening: {
    speaker: 'Polish Armoured Command',
    lines: [
      '{{callsign}}, the beachhead bought us the time to land the armour. The passes are what we bought it for.',
      'Two passes, one column. Take the north mouth, then the south.',
    ],
    target: { kind: 'position', x: 30, z: 32 },
    zoom: 38,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Rust Pass is accepted. The eastern plain is open; the foundry city is next.'],
  },
  veterans: [KESTREL, VILKAS],
});

/* ------------------------------------------------------------------ */
/* 03 — Strait Denial                                                  */
/* ------------------------------------------------------------------ */

const straitDenial: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 3,
  id: 'baltic-03',
  code: 'BALTIC / 03',
  name: 'Strait Denial',
  mapId: 'strait-denial',
  focus: 'Naval · Channel',
  situation:
    "A UK task force is ordered to cut the expeditionary corps' sea lane through the Kestrel Straits and hold the islands that anchor it.",
  context:
    'The straits carry the corps sea resupply. Cutting the lane buys the coalition weeks and threatens the island chain the blockade depends on.',
  threat: 'Corps corvettes and missile boats, a coastal battery, and a radar station on the outer isle.',
  playerNationId: 'uk',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Naval · Channel',
    context:
      "The straits carry the corps' sea resupply. Cutting the lane buys the coalition weeks and threatens the island chain that anchors the blockade.",
    commanderNote:
      '{{callsign}}, this is a naval fight with ground lodgements. You have one yard and no air cover — keep the hulls alive.',
    friendly:
      'UK littoral task force: two missile boats, one corvette, a rifle company and an engineer party, with a yard on the inner coast.',
    enemy:
      'Corps coastal group: corvettes, missile boats, a coastal battery covering the anchorage and a radar station on the outer isle.',
    enemyIntent:
      'Keep the channel open for the corps resupply run and break any lodgement on the islands.',
    personnel: ['Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Put two units on the radar isle and take the station.',
      'Then break the corps command post ashore.',
      'Their anchorage is the resupply point — two units there cut it.',
      'You have no air support in this operation. Do not expect it.',
    ],
  },
  debrief: {
    victory:
      'The radar isle is ours and the corps command post is gone. The channel is denied; the corps resupply run has to go around the islands.',
    defeat:
      'The island stayed in corps hands, or the task force command post fell. The straits remain a corps highway.',
  },
  objectives: [
    objective('take-radar-isle', 'Take the radar isle', 'primary', {
      description: 'The station on the outer isle watches the whole channel. Two units take it.',
    }),
    objective('break-corps-cp', 'Break the corps command post', 'primary', {
      description: 'Ashore, their headquarters coordinates the channel traffic.',
      dependsOn: ['take-radar-isle'],
    }),
    objective('take-anchorage', 'Take the eastern anchorage', 'secondary', {
      description: 'The anchorage is where the resupply run ends. Two units there cut it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [STRAIT_DENIAL_REGIONS.radar, STRAIT_DENIAL_REGIONS.channel, STRAIT_DENIAL_REGIONS.anchorage],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'corps-hq-broken',
      objective: 'break-corps-cp',
      message: 'Corps command post destroyed. The channel is ours.',
    }),
    secureRegion({
      id: 'radar-isle-taken',
      objective: 'take-radar-isle',
      region: 'radar-isle',
      atLeast: 2,
      message: 'Radar isle taken — the channel is blind to the corps.',
      unlock: 'break-corps-cp',
    }),
    secureRegion({
      id: 'anchorage-taken',
      objective: 'take-anchorage',
      region: 'anchorage',
      atLeast: 2,
      message: 'Anchorage taken — their resupply run has nowhere to unload.',
      priority: 25,
    }),
    regionReport({
      id: 'channel-recon',
      region: 'channel',
      atLeast: 2,
      text: 'Channel recon: no mine line on the eastern edge — the approach to the anchorage is open.',
    }),
    announce('channel-contact', 180, 'Corps corvettes are running the channel under battery cover.'),
    announce('battery-active', 360, 'Their coastal battery is still firing on the approaches.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'isle-radar', name: 'Radar Station', role: 'objective' },
    { key: 'corps-battery', name: 'Corps Coastal Battery', role: 'objective' },
    { key: 'own-yard', name: 'Coalition Shipyard', role: 'protected' },
  ],
  opening: {
    speaker: 'UK Task Force Command',
    lines: [
      '{{callsign}}, the corps runs its resupply through this channel. We are here to stop it.',
      'The radar isle first. Everything after that is a surface action.',
    ],
    target: { kind: 'position', x: 24, z: 30 },
    zoom: 38,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Strait Denial is accepted. The channel is closed for the season.'],
  },
  veterans: [VILKAS],
});

/* ------------------------------------------------------------------ */
/* 04 — Night Watch                                                    */
/* ------------------------------------------------------------------ */

const nightWatch: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 4,
  id: 'baltic-04',
  code: 'BALTIC / 04',
  name: 'Night Watch',
  mapId: 'lapland-watch',
  focus: 'Recon · Night',
  situation:
    'A Finnish jaeger battlegroup screens the forest road north of the bay. A corps night column is moving to turn the beachhead from the inland flank.',
  context:
    'The road is the only winter route to the northern flank. If the corps crosses the ice unchecked, the beachhead is taken from behind.',
  threat: 'A corps night column with infantry fighting vehicles, moving under forest cover without artillery support.',
  playerNationId: 'finland',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Recon · Night',
    context:
      'The road is the only winter route to the northern flank. If the corps crosses the ice unchecked, the beachhead is taken from behind.',
    commanderNote:
      '{{callsign}}, there is no artillery tonight and no armour to speak of. You have a drone and the trees.',
    friendly:
      'Finnish jaeger battlegroup: rifle sections, anti-tank teams, a reconnaissance drone and engineers. Daylight arrives at 06:00 — the operation starts at 22:00.',
    enemy:
      'Corps night column: infantry fighting vehicles and rifle sections moving south down the forest road.',
    enemyIntent:
      'Cross the ice before dawn, then roll up the forward depot and the tower.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section'],
    instructions: [
      'Hold the ice crossing until 08:00 — at least two units on it.',
      'Then break the corps night column command post.',
      'The watchtower is your observation post; do not lose it.',
      'Air is limited to one drone. Keep it alive.',
    ],
  },
  debrief: {
    victory:
      'The crossing held until dawn and the night column broke. The corps has lost its northern turning move.',
    defeat:
      'The crossing was lost before dawn, or the command post fell. The corps is behind the beachhead.',
  },
  objectives: [
    objective('hold-crossing', 'Hold the ice crossing until 08:00', 'primary', {
      description: 'At 08:00, two units must be on the crossing. Losing it fails the night watch.',
    }),
    objective('break-night-column', 'Break the corps night column command post', 'primary', {
      description: 'Dawn is when the column is most exposed.',
      dependsOn: ['hold-crossing'],
    }),
    objective('hold-depot', 'Keep the forward depot', 'secondary', {
      description: 'The depot feeds the whole northern screen. Two units on it hold it.',
    }),
    objective('keep-tower', 'Keep the watchtower standing', 'bonus', {
      description: 'The tower is the only observation over the treeline.',
      protectedEntities: ['own-tower'],
    }),
  ],
  variables: [
    { id: 'dawn', type: 'string', default: 'night', description: 'Whether the night watch has ended.' },
  ],
  regions: [LAPLAND_WATCH_REGIONS.crossing, LAPLAND_WATCH_REGIONS.treeline, LAPLAND_WATCH_REGIONS.depot],
  triggers: [
    {
      id: 'tower-kept',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'keep-tower', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'entityAlive', entity: 'own-tower' },
      ],
      actions: [
        { kind: 'setObjective', objective: 'keep-tower', state: 'complete' },
        { kind: 'message', text: 'The tower is still standing and the column is broken.' },
      ],
    },
    breakCommandPost({
      id: 'column-hq-broken',
      objective: 'break-night-column',
      message: 'Night column command post destroyed. The corps is falling back through the trees.',
    }),
    ...deadline({
      id: 'crossing-held',
      seconds: 480,
      objective: 'hold-crossing',
      region: 'crossing',
      atLeast: 2,
      successMessage: 'Dawn. The crossing held — the column is caught in the open.',
      failureMessage: 'The crossing is lost. The corps is behind the beachhead.',
      unlock: 'break-night-column',
      variable: { id: 'dawn', value: 'dawn' },
    }),
    secureRegion({
      id: 'depot-held',
      objective: 'hold-depot',
      region: 'depot',
      atLeast: 2,
      message: 'Forward depot held — the northern screen still has supply.',
      priority: 20,
    }),
    regionReport({
      id: 'treeline-recon',
      region: 'treeline',
      atLeast: 2,
      text: 'Patrols are in the treeline. The column is hugging the trees instead of the road.',
    }),
    announce('tower-sighting', 240, 'The tower reports movement on the treeline. They are closer than we thought.'),
    announce('pre-dawn', 420, 'Forty minutes to first light. The column is bunching on the road.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'own-tower', name: 'Watchtower', role: 'protected' },
    { key: 'corps-post', name: 'Corps Forward Post', role: 'objective' },
  ],
  opening: {
    speaker: 'Finnish Jaeger Command',
    lines: [
      '{{callsign}}, it is 22:00 and the corps is moving down the forest road.',
      'Hold the crossing until dawn. There is no artillery tonight.',
    ],
    target: { kind: 'position', x: 40, z: 52 },
    zoom: 34,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Night Watch is accepted. The northern flank held until first light.'],
  },
  veterans: [KESTREL],
});

/* ------------------------------------------------------------------ */
/* 05 — Foundry Relief                                                 */
/* ------------------------------------------------------------------ */

const foundryRelief: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 5,
  id: 'baltic-05',
  code: 'BALTIC / 05',
  name: 'Foundry Relief',
  mapId: 'foundry-relief',
  focus: 'Urban · Relief',
  situation:
    'The foundry city has held out for a week. A Polish relief column is moving in from the west to break the Belarusian ring around the works.',
  context:
    'The foundry is the last heavy industry on the northern coast. If it falls, every replacement hull has to come by sea.',
  threat: 'Belarusian infantry holds the old town and the rail yard, with armour behind the foundry works.',
  playerNationId: 'poland',
  opponentNationId: 'belarus',
  briefing: {
    subtitle: 'Urban · Relief',
    context:
      'The foundry is the last heavy industry on the northern coast. If it falls, every replacement hull has to come by sea.',
    commanderNote:
      '{{callsign}}, this is street fighting with a clock. The garrison is still inside — every hour they hold buys us a street.',
    friendly:
      'Polish relief column: two MBTs, an infantry fighting vehicle, artillery observers and engineers, with light air support.',
    enemy:
      'Belarusian city group: infantry in the old town and rail yard, armour behind the foundry works.',
    enemyIntent:
      'Hold the old town, keep the rail yard open and crush the garrison inside the works.',
    personnel: ['Cpl. Tomas Vilkas — Field Medical', 'Sgt. Emilija Raudonė — 1st Rifle Section'],
    instructions: [
      'Link up with the garrison in the foundry works — three units inside.',
      'Then clear the rail yard so the relief can be supplied.',
      'Break their command post east of the city.',
      'The old town is a secondary objective. It can wait; the works cannot.',
    ],
  },
  debrief: {
    victory:
      'The works are relieved and the rail yard is clear. The foundry city is still producing, and the corridor has lost its industrial prize.',
    defeat:
      'The relief never reached the works, or the column command post fell. The foundry city is lost.',
  },
  objectives: [
    objective('reach-foundry', 'Reach the foundry works', 'primary', {
      description: 'Three units inside the works link up with the garrison.',
    }),
    objective('clear-railyard', 'Clear the rail yard', 'primary', {
      description: 'The yard is the only way to supply the relief.',
      dependsOn: ['reach-foundry'],
    }),
    objective('break-city-hq', 'Break the Belarusian command post', 'primary', {
      description: 'Their headquarters sits east of the city, behind the ring.',
      dependsOn: ['clear-railyard'],
    }),
    objective('clear-oldtown', 'Clear the old town', 'secondary', {
      description: 'Belarusian infantry still hold the old town. Three units clear it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [FOUNDRY_RELIEF_REGIONS.foundry, FOUNDRY_RELIEF_REGIONS.railyard, FOUNDRY_RELIEF_REGIONS.oldtown],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'city-hq-broken',
      objective: 'break-city-hq',
      message: 'Belarusian command post destroyed. The ring is broken.',
    }),
    secureRegion({
      id: 'foundry-reached',
      objective: 'reach-foundry',
      region: 'foundry',
      atLeast: 3,
      message: 'Linked up with the garrison — the works are still ours.',
      unlock: 'clear-railyard',
    }),
    secureRegion({
      id: 'railyard-cleared',
      objective: 'clear-railyard',
      region: 'railyard',
      atLeast: 3,
      message: 'Rail yard cleared. The relief can be supplied — break their command post.',
      unlock: 'break-city-hq',
    }),
    secureRegion({
      id: 'oldtown-cleared',
      objective: 'clear-oldtown',
      region: 'oldtown',
      atLeast: 3,
      message: 'Old town cleared — their infantry is falling back.',
      priority: 25,
    }),
    announce('garrison-pressure', 240, 'The garrison reports pressure on the works from the north.'),
    announce('civilian-lanes', 420, 'Civilian lanes are still open. Keep the armour off them.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'foundry-works', name: 'Foundry Works', role: 'protected' },
    { key: 'rail-depot', name: 'Rail Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Polish Relief Command',
    lines: [
      '{{callsign}}, the foundry has held for a week. We are the relief.',
      'The works first, then the rail yard. Do not let the armour get boxed in the streets.',
    ],
    target: { kind: 'position', x: 22, z: 32 },
    zoom: 34,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Foundry Relief is accepted. The city is still ours — and still producing.'],
  },
  veterans: [VILKAS, KESTREL],
});

/* ------------------------------------------------------------------ */
/* 06 — Granite Steps                                                  */
/* ------------------------------------------------------------------ */

const graniteSteps: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 6,
  id: 'baltic-06',
  code: 'BALTIC / 06',
  name: 'Granite Steps',
  mapId: 'granite-terraces',
  focus: 'Uplands · Terrain',
  situation:
    'A Swedish armoured group works up the granite terraces to break the corps hold on the uplands and open the road to the coast plain.',
  context:
    'The uplands overlook both the beachhead and the eastern plain. Whoever holds the upper terrace sees everything the other side does.',
  threat: 'Corps mountain troops and anti-tank teams on the terrace edges, with armour behind the upper step.',
  playerNationId: 'sweden',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Uplands · Terrain',
    context:
      'The uplands overlook both the beachhead and the eastern plain. Whoever holds the upper terrace sees everything the other side does.',
    commanderNote:
      '{{callsign}}, the terraces are staircases. Take the lower step, then the upper. Do not try to climb both at once.',
    friendly:
      'Swedish armoured group: two MBTs, an anti-tank vehicle, artillery observers and engineers.',
    enemy:
      'Corps mountain group: anti-tank teams on each terrace edge and armour behind the upper step.',
    enemyIntent:
      'Hold the terrace edges, keep the quarry open for material, and make every step cost a company.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section'],
    instructions: [
      'Take the lower step first: three units on the terrace.',
      'Then the upper step.',
      'Break their command post north of the quarry.',
      'The quarry supplies their works — taking it is worth the detour.',
    ],
  },
  debrief: {
    victory:
      'Both terraces are ours and the corps has pulled off the uplands. The coast plain is visible from the upper step.',
    defeat:
      'The terraces held against us, or the command post fell. The uplands stay in corps hands.',
  },
  objectives: [
    objective('take-lower-step', 'Take the lower step', 'primary', {
      description: 'Three units on the lower terrace clear the approach.',
    }),
    objective('take-upper-step', 'Take the upper step', 'primary', {
      description: 'The upper terrace overlooks the coast plain.',
      dependsOn: ['take-lower-step'],
    }),
    objective('break-mountain-hq', 'Break the corps mountain command post', 'primary', {
      description: 'Beyond the quarry, their headquarters anchors the uplands.',
      dependsOn: ['take-upper-step'],
    }),
    objective('seize-quarry', 'Seize the quarry', 'secondary', {
      description: 'The quarry feeds their construction. Two units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [GRANITE_STEPS_REGIONS.lower, GRANITE_STEPS_REGIONS.upper, GRANITE_STEPS_REGIONS.quarry],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'mountain-hq-broken',
      objective: 'break-mountain-hq',
      message: 'Corps mountain command post destroyed. The uplands are ours.',
    }),
    secureRegion({
      id: 'lower-step-taken',
      objective: 'take-lower-step',
      region: 'lower-step',
      atLeast: 3,
      message: 'Lower step taken. The next terrace is in grenade range.',
      unlock: 'take-upper-step',
    }),
    secureRegion({
      id: 'upper-step-taken',
      objective: 'take-upper-step',
      region: 'upper-step',
      atLeast: 3,
      message: 'Upper step taken — we can see the coast plain.',
      unlock: 'break-mountain-hq',
    }),
    secureRegion({
      id: 'quarry-seized',
      objective: 'seize-quarry',
      region: 'quarry',
      atLeast: 2,
      message: 'Quarry seized — their construction chain is cut.',
      priority: 25,
    }),
    announce('terrace-fire', 300, 'Their anti-tank teams are still on the terrace edges.'),
    announce('weather-turning', 540, 'Cloud is coming in from the coast. Air support will be limited.'),
  ],
  entities: [...commandPair(), { key: 'quarry', name: 'Quarry Works', role: 'asset' }],
  opening: {
    speaker: 'Swedish Armoured Command',
    lines: [
      '{{callsign}}, the uplands are a staircase and the corps is on the top step.',
      'Take the lower terrace, then the upper. Nothing else matters until the heights are ours.',
    ],
    target: { kind: 'position', x: 26, z: 48 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Granite Steps is accepted. The uplands are ours; the coast plain is next.'],
  },
  veterans: [KESTREL],
});

/* ------------------------------------------------------------------ */
/* 07 — Amber Coast                                                    */
/* ------------------------------------------------------------------ */

const amberCoast: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 7,
  id: 'baltic-07',
  code: 'BALTIC / 07',
  name: 'Amber Coast',
  mapId: 'amber-coast',
  focus: 'Coastal · Combined',
  situation:
    'With the passes open, a Lithuanian coastal group pushes down the amber coast to take the corps harbour that supplies the whole northern flank.',
  context:
    'The harbour is where the corps lands everything it needs. Take it and the northern flank has to be supplied by road for the rest of the war.',
  threat: 'Corps armour on the coast road, a coastal battery over the anchorage and a yard that keeps repairing hulls.',
  playerNationId: 'lithuania',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Coastal · Combined',
    context:
      'The harbour is where the corps lands everything it needs. Take it and the northern flank has to be supplied by road.',
    commanderNote:
      '{{callsign}}, this is the first operation where you have guns, boats and tanks at once. Use all three or use none well.',
    friendly:
      'Lithuanian coastal group: two MBTs, an anti-tank vehicle, artillery, missile boats and a yard on the sand coast.',
    enemy:
      'Corps coastal group: armour on the coast road, a coastal battery over the anchorage and a corvette on patrol.',
    enemyIntent:
      'Keep the harbour open, hold the dune belt and shell anything that comes down the road.',
    personnel: ['Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Take the dune belt first: three units among the dunes.',
      'Then cut the harbour: three units inside it.',
      'The coastal battery covers the anchorage. Silence it or avoid the water.',
      'Break their command post to finish the operation.',
    ],
  },
  debrief: {
    victory:
      'The harbour is cut and the corps command post is gone. The northern flank is supplied by road now, and the road runs through us.',
    defeat:
      'The dunes or harbour held against us, or the group command post fell. The corps still lands at will.',
  },
  objectives: [
    objective('take-dunes', 'Take the dune belt', 'primary', {
      description: 'The dunes overlook the coast road and the harbour approach.',
    }),
    objective('cut-harbour', 'Cut the harbour', 'primary', {
      description: 'Three units in the harbour close it to the corps.',
      dependsOn: ['take-dunes'],
    }),
    objective('break-coastal-hq', 'Break the corps coastal command post', 'primary', {
      description: 'Their headquarters sits behind the harbour road.',
      dependsOn: ['cut-harbour'],
    }),
    objective('clear-coast-road', 'Clear the coast road', 'secondary', {
      description: 'Their armour uses the road as a highway. Three units clear it.',
    }),
    objective('keep-yard', 'Keep the shipyard operational', 'bonus', {
      description: 'The yard is the only repair facility on this coast.',
      protectedEntities: ['own-yard'],
    }),
  ],
  regions: [AMBER_COAST_REGIONS.dunes, AMBER_COAST_REGIONS.harbour, AMBER_COAST_REGIONS.road],
  triggers: [
    {
      id: 'yard-kept',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'keep-yard', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'entityAlive', entity: 'own-yard' },
      ],
      actions: [
        { kind: 'setObjective', objective: 'keep-yard', state: 'complete' },
        { kind: 'message', text: 'The yard is intact and their command post is broken.' },
      ],
    },
    breakCommandPost({
      id: 'coastal-hq-broken',
      objective: 'break-coastal-hq',
      message: 'Corps coastal command post destroyed. The harbour is closed.',
    }),
    secureRegion({
      id: 'dunes-taken',
      objective: 'take-dunes',
      region: 'dunes',
      atLeast: 3,
      message: 'Dune belt taken. The harbour is in view.',
      unlock: 'cut-harbour',
    }),
    secureRegion({
      id: 'harbour-cut',
      objective: 'cut-harbour',
      region: 'harbour',
      atLeast: 3,
      message: 'Harbour cut — nothing lands here now. Break their command post.',
      unlock: 'break-coastal-hq',
    }),
    secureRegion({
      id: 'road-cleared',
      objective: 'clear-coast-road',
      region: 'coast-road',
      atLeast: 3,
      message: 'Coast road cleared — their armour has to take the dunes.',
      priority: 25,
    }),
    announce('battery-fire', 300, 'Their coastal battery still covers the anchorage. Keep the boats inshore.'),
    announce('second-landing', 480, 'Corps landing craft are forming up offshore. Finish the harbour.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'own-yard', name: 'Coalition Shipyard', role: 'protected' },
    { key: 'corps-yard', name: 'Corps Shipyard', role: 'objective' },
    { key: 'corps-battery', name: 'Coastal Battery', role: 'objective' },
  ],
  opening: {
    speaker: 'Lithuanian Coastal Command',
    lines: [
      '{{callsign}}, the corps lands everything it needs at this harbour.',
      'Take the dunes, then the harbour. After that their northern flank is a road.',
    ],
    target: { kind: 'position', x: 28, z: 42 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Amber Coast is accepted. The corps has lost its northern port.'],
  },
  veterans: [VILKAS],
});

/* ------------------------------------------------------------------ */
/* 08 — Signal Hill                                                    */
/* ------------------------------------------------------------------ */

const signalHill: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 8,
  id: 'baltic-08',
  code: 'BALTIC / 08',
  name: 'Signal Hill',
  mapId: 'signal-hill',
  focus: 'Air · Radar hill',
  situation:
    'Both sides can operate aircraft now. A UK expeditionary air group is ordered to take the radar hill that controls the airspace over the bay.',
  context:
    'The hill radar sees every sortie on both sides. Taking it blinds the corps air group; losing it does the same to us.',
  threat: 'Corps interceptors and strike fighters, a pair of SAM batteries and a fortified radar crown.',
  playerNationId: 'uk',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Air · Radar hill',
    context:
      'The hill radar sees every sortie on both sides. Taking it blinds the corps air group; losing it does the same to us.',
    commanderNote:
      '{{callsign}}, this is the first operation where air matters more than armour. Own the hill and their fighters fly blind.',
    friendly:
      'UK expeditionary air group: interceptors and strike fighters from a forward strip, with armour and anti-tank support.',
    enemy:
      'Corps air group: fighters, interceptors, two SAM batteries and the radar crown on the hill.',
    enemyIntent:
      'Keep the hill radar running and shoot down anything that climbs for it.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section', 'Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Take the hill: three units on the radar crown.',
      'Destroy the radar station on the crown.',
      'Break their air group command post.',
      'Keep the valley road open — it is the only ground approach to the hill.',
    ],
  },
  debrief: {
    victory:
      'The hill is ours and the radar is down. The corps air group is flying blind over the bay.',
    defeat:
      'The hill stayed in corps hands, or the air group command post fell. The corps still sees the whole bay.',
  },
  objectives: [
    objective('take-hill', 'Take signal hill', 'primary', {
      description: 'Three units on the radar crown.',
    }),
    objective('destroy-radar', 'Destroy the hill radar', 'primary', {
      description: 'The station is what coordinates the corps air group.',
      dependsOn: ['take-hill'],
    }),
    objective('break-air-hq', 'Break the corps air group command post', 'primary', {
      description: 'Their air group is commanded from the eastern strip.',
      dependsOn: ['destroy-radar'],
    }),
    objective('hold-valley', 'Hold the northern valley', 'secondary', {
      description: 'The valley road is the only ground approach to the hill.',
    }),
    cleanSweepObjective(),
  ],
  regions: [SIGNAL_HILL_REGIONS.hill, SIGNAL_HILL_REGIONS.valley, SIGNAL_HILL_REGIONS.airstrip],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'air-hq-broken',
      objective: 'break-air-hq',
      message: 'Corps air group command post destroyed. The airspace is ours.',
    }),
    secureRegion({
      id: 'hill-taken',
      objective: 'take-hill',
      region: 'signal-hill',
      atLeast: 3,
      message: 'Hill taken. The radar crown is exposed — put a satchel on it.',
      unlock: 'destroy-radar',
    }),
    destroyEntity({
      id: 'radar-down',
      objective: 'destroy-radar',
      entity: 'hill-radar',
      message: 'Hill radar destroyed. Their fighters are flying on guesswork.',
      unlock: 'break-air-hq',
    }),
    secureRegion({
      id: 'valley-held',
      objective: 'hold-valley',
      region: 'valley',
      atLeast: 2,
      message: 'Valley held — the hill approach stays open.',
      priority: 25,
    }),
    regionReport({
      id: 'airstrip-recon',
      region: 'airstrip',
      atLeast: 3,
      text: 'Forward strip taken. Their fighters are still flying from the main field, not from here.',
    }),
    announce('air-contacts', 240, 'Corps fighters are up. Our strip is under threat.'),
    announce('sam-active', 360, 'Their SAM batteries are still active. Keep the aircraft low.'),
  ],
  entities: [...commandPair(), { key: 'hill-radar', name: 'Hill Radar Station', role: 'objective' }],
  opening: {
    speaker: 'UK Air Group Command',
    lines: [
      '{{callsign}}, both sides can fly now. That hill is the whole air war.',
      'Take the crown, kill the radar, then break their air group on the ground.',
    ],
    target: { kind: 'position', x: 20, z: 34 },
    zoom: 34,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Signal Hill is accepted. The corps air group is blind over the bay.'],
  },
  veterans: [KESTREL, VILKAS],
});

/* ------------------------------------------------------------------ */
/* 09 — Convoy Lane                                                    */
/* ------------------------------------------------------------------ */

const convoyLane: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 9,
  id: 'baltic-09',
  code: 'BALTIC / 09',
  name: 'Convoy Lane',
  mapId: 'convoy-lane',
  focus: 'Naval · Escort',
  situation:
    'The second convoy is running the northern passage. A Finnish escort group must hold the lane open until it clears the coast.',
  context:
    'The convoy carries the Swedish armour that the counter-offensive depends on. If the lane closes, there is no counter-offensive.',
  threat: 'Corps corvettes and missile boats working the lane, with a coastal battery over the anchorage.',
  playerNationId: 'finland',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Naval · Escort',
    context:
      'The convoy carries the Swedish armour the counter-offensive depends on. If the lane closes, there is no counter-offensive.',
    commanderNote:
      '{{callsign}}, the convoy does not stop for us. Hold the lane for nine minutes and it gets through.',
    friendly:
      'Finnish escort group: two missile boats, a corvette, rifle sections and a yard on the landing beach.',
    enemy:
      'Corps interdiction group: corvettes, missile boats and a coastal battery covering the anchorage.',
    enemyIntent:
      'Close the lane, sink what escorts it and keep the anchorage open for their own resupply.',
    personnel: ['Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Hold the convoy lane until 09:00 — at least two units inside it.',
      'Then break the corps interdiction command post.',
      'The anchorage is their reload point; two units there cut it.',
      'Losing the convoy depot ends the escort.',
    ],
  },
  debrief: {
    victory:
      'The convoy cleared the coast. The Swedish armour is ashore, and the counter-offensive has its spearhead.',
    defeat:
      'The lane did not hold, or the escort command post fell. The convoy turned back.',
  },
  objectives: [
    objective('hold-lane', 'Hold the convoy lane until 09:00', 'primary', {
      description: 'At 09:00, two units must be inside the lane.',
    }),
    objective('break-interdiction-hq', 'Break the corps interdiction command post', 'primary', {
      description: 'Their headquarters directs the attacks on the lane.',
      dependsOn: ['hold-lane'],
    }),
    objective('secure-anchorage', 'Secure the anchorage', 'secondary', {
      description: 'Their boats reload here. Two units take it.',
    }),
    objective('keep-convoy-depot', 'Keep the convoy depot', 'bonus', {
      description: 'The depot is where the convoy cargo is landed.',
      protectedEntities: ['convoy-depot'],
    }),
  ],
  variables: [
    { id: 'convoyState', type: 'string', default: 'running', description: 'State of the second convoy.' },
  ],
  regions: [CONVOY_LANE_REGIONS.lane, CONVOY_LANE_REGIONS.beach, CONVOY_LANE_REGIONS.anchorage],
  triggers: [
    {
      id: 'depot-kept',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'keep-convoy-depot', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'entityAlive', entity: 'convoy-depot' },
      ],
      actions: [
        { kind: 'setObjective', objective: 'keep-convoy-depot', state: 'complete' },
        { kind: 'message', text: 'The depot is intact and the interdiction group is broken.' },
      ],
    },
    breakCommandPost({
      id: 'interdiction-hq-broken',
      objective: 'break-interdiction-hq',
      message: 'Corps interdiction command post destroyed. The lane is clear.',
    }),
    ...deadline({
      id: 'lane-held',
      seconds: 540,
      objective: 'hold-lane',
      region: 'lane',
      atLeast: 2,
      successMessage: 'The convoy is through. The lane held.',
      failureMessage: 'The lane is closed. The convoy has turned back.',
      unlock: 'break-interdiction-hq',
      variable: { id: 'convoyState', value: 'through' },
    }),
    secureRegion({
      id: 'anchorage-secured',
      objective: 'secure-anchorage',
      region: 'anchorage',
      atLeast: 2,
      message: 'Anchorage secured — their boats have nowhere to reload.',
      priority: 25,
    }),
    regionReport({
      id: 'beach-recon',
      region: 'beach',
      atLeast: 2,
      text: 'Beach parties are ashore. The anchorage can be approached from the sand, not only the lane.',
    }),
    announce('convoy-entering', 180, 'Convoy is entering the lane. All escorts to station.'),
    announce('convoy-midpoint', 360, 'Convoy is at the midpoint. They know we are here.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'convoy-depot', name: 'Convoy Depot', role: 'protected' },
    { key: 'corps-battery', name: 'Coastal Battery', role: 'objective' },
  ],
  opening: {
    speaker: 'Finnish Escort Command',
    lines: [
      '{{callsign}}, the second convoy is entering the lane. It carries the Swedish armour.',
      'Hold the lane for nine minutes. Then go and break the group that closed it.',
    ],
    target: { kind: 'position', x: 20, z: 40 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Convoy Lane is accepted. The armour is ashore and the counter-offensive is on.'],
  },
  veterans: [VILKAS],
});

/* ------------------------------------------------------------------ */
/* 10 — Rail Junction                                                  */
/* ------------------------------------------------------------------ */

const railJunction: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 10,
  id: 'baltic-10',
  code: 'BALTIC / 10',
  name: 'Rail Junction',
  mapId: 'rail-junction',
  focus: 'Logistics · Junction',
  situation:
    'The counter-offensive needs a rail head. A Polish rail group is ordered to take the junction that feeds the whole corridor.',
  context:
    'Every corps division east of the junction is supplied through it. Take it and the corridor has to be fed by truck for a hundred kilometres.',
  threat: 'Belarusian armour and rocket artillery defending the junction, the yards and a fortified depot.',
  playerNationId: 'poland',
  opponentNationId: 'belarus',
  briefing: {
    subtitle: 'Logistics · Junction',
    context:
      'Every corps division east of the junction is supplied through it. Take it and the corridor has to be fed by truck.',
    commanderNote:
      '{{callsign}}, this is a supply fight. The junction first, then the yards, then their headquarters. Their rockets will find you in the open.',
    friendly:
      'Polish rail group: armour, artillery and rocket support, with engineers and a forward air controller.',
    enemy:
      'Belarusian rail group: armour, rocket artillery and infantry holding the junction and the depot.',
    enemyIntent:
      'Keep the junction running, keep the yards open and break any push across the open farmland.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section'],
    instructions: [
      'Take the junction: three units on it.',
      'Then the freight yards.',
      'Break their command post beyond the depot.',
      'Their depot store is a secondary objective — it is where the rockets are reloaded.',
    ],
  },
  debrief: {
    victory:
      'The junction and the yards are ours. The corridor is being fed by truck, and the trucks are ours to shell.',
    defeat:
      'The junction held against us, or the rail group command post fell. The corridor still has its rail head.',
  },
  objectives: [
    objective('take-junction', 'Take the rail junction', 'primary', {
      description: 'Three units on the junction stop the corridor rail traffic.',
    }),
    objective('take-yards', 'Take the freight yards', 'primary', {
      description: 'The yards are where the junction traffic is loaded.',
      dependsOn: ['take-junction'],
    }),
    objective('break-rail-hq', 'Break the Belarusian rail command post', 'primary', {
      description: 'Their headquarters is beyond the depot, east of the yards.',
      dependsOn: ['take-yards'],
    }),
    objective('hold-depot', 'Hold the supply depot', 'secondary', {
      description: 'Their rockets reload here. Two units hold it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [RAIL_JUNCTION_REGIONS.junction, RAIL_JUNCTION_REGIONS.yards, RAIL_JUNCTION_REGIONS.depot],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'rail-hq-broken',
      objective: 'break-rail-hq',
      message: 'Belarusian rail command post destroyed. The corridor has lost its rail head.',
    }),
    secureRegion({
      id: 'junction-taken',
      objective: 'take-junction',
      region: 'junction',
      atLeast: 3,
      message: 'Junction taken. Traffic is stopping — now the yards.',
      unlock: 'take-yards',
    }),
    secureRegion({
      id: 'yards-taken',
      objective: 'take-yards',
      region: 'yards',
      atLeast: 3,
      message: 'Yards taken. Break their command post beyond the depot.',
      unlock: 'break-rail-hq',
    }),
    secureRegion({
      id: 'depot-held',
      objective: 'hold-depot',
      region: 'depot',
      atLeast: 2,
      message: 'Depot held — their rocket reloads are cut.',
      priority: 25,
    }),
    announce('rocket-fire', 300, 'Rocket artillery is ranging on the junction. Spread out.'),
    announce('corridor-trucks', 480, 'The corridor is switching to trucks. Finish the junction.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'junction-shed', name: 'Junction Freight Shed', role: 'objective' },
    { key: 'depot-store', name: 'Supply Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Polish Rail Command',
    lines: [
      '{{callsign}}, everything east of that junction is fed through it.',
      'Take the junction, then the yards. Their rockets will make the open ground expensive.',
    ],
    target: { kind: 'position', x: 22, z: 32 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Rail Junction is accepted. The corridor is on trucks, and the trucks are ours.'],
  },
  veterans: [KESTREL],
});

/* ------------------------------------------------------------------ */
/* 11 — Corridor Break                                                 */
/* ------------------------------------------------------------------ */

const corridorBreak: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 11,
  id: 'baltic-11',
  code: 'BALTIC / 11',
  name: 'Corridor Break',
  mapId: 'corridor-break',
  focus: 'Counter-offensive · Breakthrough',
  situation:
    'The counter-offensive has its armour and its rail head. A Swedish breakthrough group is ordered to break the corridor itself between the two ridge systems.',
  context:
    'The corridor is the corps main supply route. Breaking it here splits the northern and southern groups for the rest of the war.',
  threat: 'Corps armour, rocket artillery and a fortified ridge gate, with air support on both sides.',
  playerNationId: 'sweden',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Counter-offensive · Breakthrough',
    context:
      'The corridor is the corps main supply route. Breaking it here splits the northern and southern groups for the rest of the war.',
    commanderNote:
      '{{callsign}}, this is the operation the whole campaign was for. Break the corridor and the corps has two fronts.',
    friendly:
      'Swedish breakthrough group: armour, anti-tank vehicles, artillery, rocket support and strike aircraft.',
    enemy:
      'Corps corridor group: armour and rocket artillery behind a fortified ridge gate.',
    enemyIntent:
      'Hold the gate, keep the corridor open and counter-attack anything that reaches the relay.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section', 'Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Take the ridge gate first: two units in it.',
      'Then take the corridor itself — four units inside.',
      'Break their command post in the rear area.',
      'Their depot in the rear is a secondary objective.',
    ],
  },
  debrief: {
    victory:
      'The corridor is broken. The corps has two fronts now, and neither can supply the other by the northern route.',
    defeat:
      'The gate or the corridor held, or the breakthrough command post fell. The corridor is still open.',
  },
  objectives: [
    objective('take-gate', 'Take the ridge gate', 'primary', {
      description: 'The gate is the only armoured entrance to the corridor.',
    }),
    objective('take-corridor', 'Take the corridor', 'primary', {
      description: 'Four units inside the corridor cut the corps main supply route.',
      dependsOn: ['take-gate'],
    }),
    objective('break-corridor-hq', 'Break the corps corridor command post', 'primary', {
      description: 'Their headquarters is in the rear area beyond the relay.',
      dependsOn: ['take-corridor'],
    }),
    objective('take-rear-area', 'Take the rear area', 'secondary', {
      description: 'Their depot stocks the whole corridor. Two units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [CORRIDOR_BREAK_REGIONS.corridor, CORRIDOR_BREAK_REGIONS.gate, CORRIDOR_BREAK_REGIONS.rear],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'corridor-hq-broken',
      objective: 'break-corridor-hq',
      message: 'Corps corridor command post destroyed. The corridor is cut.',
    }),
    secureRegion({
      id: 'gate-taken',
      objective: 'take-gate',
      region: 'ridge-gate',
      atLeast: 2,
      message: 'Ridge gate taken. The corridor is open to us.',
      unlock: 'take-corridor',
    }),
    secureRegion({
      id: 'corridor-taken',
      objective: 'take-corridor',
      region: 'corridor',
      atLeast: 4,
      message: 'Corridor taken — their main supply route is cut. Break their headquarters.',
      unlock: 'break-corridor-hq',
    }),
    secureRegion({
      id: 'rear-taken',
      objective: 'take-rear-area',
      region: 'rear-area',
      atLeast: 2,
      message: 'Rear area taken — the corridor depot is ours.',
      priority: 25,
    }),
    announce('corps-counterattack', 300, 'Corps armour is counter-attacking the gate. Hold it.'),
    announce('air-interdiction', 480, 'Their aircraft are working the corridor. Keep the armour dispersed.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'corridor-relay', name: 'Corridor Relay', role: 'objective' },
    { key: 'corps-depot', name: 'Corridor Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Swedish Breakthrough Command',
    lines: [
      '{{callsign}}, this is the operation the campaign was for. The corridor is their main supply route.',
      'Take the gate, then the corridor. Break it and the corps has two fronts.',
    ],
    target: { kind: 'position', x: 22, z: 34 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Corridor Break is accepted. The corps has two fronts, and neither can supply the other.'],
  },
  veterans: [KESTREL, VILKAS],
});

/* ------------------------------------------------------------------ */
/* 12 — Kestrel Straits                                                */
/* ------------------------------------------------------------------ */

const kestrelStraits: AuthoredOperation = buildOperation({
  campaignId: 'baltic-line',
  side: 'defender',
  order: 12,
  id: 'baltic-12',
  code: 'BALTIC / 12',
  name: 'Kestrel Straits',
  mapId: 'straits-final',
  focus: 'Finale · Straits',
  situation:
    'The corridor is broken and the corps is pulling back on the straits. A UK combined task force is ordered to take the islands, close the channel and finish the campaign.',
  context:
    'The straits are the last route out of the corridor. Close them and the corps northern group is cut off from its own coast.',
  threat: 'Corps coastal command: two batteries, a yard, fighters, corvettes and a fortified naval base.',
  playerNationId: 'uk',
  opponentNationId: 'russia',
  briefing: {
    subtitle: 'Finale · Straits',
    context:
      'The straits are the last route out of the corridor. Close them and the corps northern group is cut off from its coast.',
    commanderNote:
      '{{callsign}}, everything you have is in this task force. Air, sea and ground, one last time.',
    friendly:
      'UK combined task force: full armour, artillery, air and naval support, with both a yard and an airfield.',
    enemy:
      'Corps coastal command: two coastal batteries, a yard, fighters, corvettes and a fortified naval base.',
    enemyIntent:
      'Hold the islands, keep the channel open and evacuate the northern group through it.',
    personnel: ['Sgt. Emilija Raudonė — 1st Rifle Section', 'Cpl. Tomas Vilkas — Field Medical'],
    instructions: [
      'Take the outer islands first: two units on them.',
      'Then close the strait — three units inside it.',
      'Silence the coastal battery covering the channel.',
      'Break their coastal command post to finish the campaign.',
    ],
  },
  debrief: {
    victory:
      'The straits are closed and the corps northern group is cut off. The Baltic Line has held, and the coast is the coalition again.',
    defeat:
      'The islands or the strait held against us, or the task force command post fell. The corps still has its exit.',
  },
  objectives: [
    objective('take-islands', 'Take the outer islands', 'primary', {
      description: 'The islands anchor the channel and the radar.',
    }),
    objective('close-strait', 'Close the strait', 'primary', {
      description: 'Three units inside the strait stop the evacuation.',
      dependsOn: ['take-islands'],
    }),
    objective('break-coastal-command', 'Break the corps coastal command post', 'primary', {
      description: 'Their naval base is the last headquarters in the north.',
      dependsOn: ['close-strait'],
    }),
    objective('silence-battery', 'Silence the channel battery', 'secondary', {
      description: 'One battery still covers the whole channel.',
    }),
    cleanSweepObjective(),
  ],
  regions: [STRAITS_FINAL_REGIONS.strait, STRAITS_FINAL_REGIONS.islands, STRAITS_FINAL_REGIONS.navalBase],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'coastal-command-broken',
      objective: 'break-coastal-command',
      message: 'Corps coastal command destroyed. The straits are closed.',
    }),
    secureRegion({
      id: 'islands-taken',
      objective: 'take-islands',
      region: 'islands',
      atLeast: 2,
      message: 'Outer islands taken. The channel is in our hands.',
      unlock: 'close-strait',
    }),
    secureRegion({
      id: 'strait-closed',
      objective: 'close-strait',
      region: 'strait',
      atLeast: 3,
      message: 'Strait closed. Nothing leaves the north. Break their coastal command.',
      unlock: 'break-coastal-command',
    }),
    destroyEntity({
      id: 'battery-silenced',
      objective: 'silence-battery',
      entity: 'corps-battery',
      message: 'Channel battery silenced — the approaches are open.',
      priority: 30,
    }),
    regionReport({
      id: 'naval-base-recon',
      region: 'naval-base',
      atLeast: 3,
      text: 'Naval base under our guns. Their loading is in disorder — the evacuation is stalling.',
    }),
    announce('evacuation-begins', 300, 'The corps is loading transports at the naval base. They are leaving.'),
    announce('last-convoy', 540, 'Their last convoy is forming. Close the strait.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'isle-radar', name: 'Island Radar', role: 'objective' },
    { key: 'corps-battery', name: 'Channel Battery', role: 'objective' },
    { key: 'corps-yard', name: 'Corps Shipyard', role: 'objective' },
    { key: 'own-yard', name: 'Coalition Shipyard', role: 'protected' },
  ],
  opening: {
    speaker: 'UK Combined Command',
    lines: [
      '{{callsign}}, the corridor is broken and the corps is pulling back on the straits.',
      'Take the islands, close the channel, and finish it.',
    ],
    target: { kind: 'position', x: 20, z: 38 },
    zoom: 36,
  },
  ending: {
    speaker: 'Coalition Command',
    lines: ['Kestrel Straits is accepted. The Baltic Line held. The coast is ours.'],
  },
  veterans: [KESTREL, VILKAS],
});

/** The Baltic Line, in campaign order. */
export const BALTIC_OPERATIONS: readonly AuthoredOperation[] = Object.freeze([
  kestrelBeachhead,
  rustPass,
  straitDenial,
  nightWatch,
  foundryRelief,
  graniteSteps,
  amberCoast,
  signalHill,
  convoyLane,
  railJunction,
  corridorBreak,
  kestrelStraits,
]);

/** Unused import guard: keeps `MissionTriggerDoc` available for future missions. */
export type { MissionTriggerDoc };
