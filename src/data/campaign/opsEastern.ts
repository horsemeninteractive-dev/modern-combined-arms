/**
 * The Eastern Corridor — twelve operations.
 *
 * The same war from the corps' side: a landing that becomes an occupation, an
 * industrial city that eats a division, allies who arrive with drones and siege
 * guns because the corps has spent its own stocks, and a coalition
 * counter-offensive that forces the corridor to defend what it took.
 *
 * The commander is the corps officer the player names. Each operation hands
 * that officer a different national contingent, because the corridor is held by
 * a coalition, not by one army.
 */
import type { CampaignVeteranSlot } from '../../campaign/types';
import type { MissionEntityDoc, MissionObjectiveDoc } from '../../mission/types';
import {
  COAST_ROAD_REGIONS,
  DEPOT_WAR_REGIONS,
  DRONE_LINE_REGIONS,
  FOUNDRY_FALLS_REGIONS,
  FOUNDRY_POCKET_REGIONS,
  GUN_LINE_REGIONS,
  IRON_COLUMN_REGIONS,
  KESTREL_REACH_REGIONS,
  RED_BEACH_REGIONS,
  STRAITS_TERMS_REGIONS,
  STRAIT_BLOCKADE_REGIONS,
  WINTER_ROAD_REGIONS,
} from './mapsEastern';
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

const VOLKOV: CampaignVeteranSlot = { key: 'volkov-rifle', veteranId: 'vet-volkov', defId: 'rifle' };
const AMARI: CampaignVeteranSlot = { key: 'amari-atgm', veteranId: 'vet-amari', defId: 'atgm' };

function commandPair(): MissionEntityDoc[] {
  return [
    { key: 'own-hq', name: 'Corps Command Post', role: 'protected' },
    { key: 'enemy-hq', name: 'Coalition Command Post', role: 'objective' },
  ];
}

function cleanSweepObjective(): MissionObjectiveDoc {
  return objective('clean-sweep', 'Break their command post with ours intact', 'bonus', {
    description: 'Their headquarters falls and the corps command post still stands.',
    protectedEntities: ['own-hq'],
  });
}

/* ------------------------------------------------------------------ */
/* 01 — Red Beach                                                      */
/* ------------------------------------------------------------------ */

const redBeach: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 1,
  id: 'corridor-01',
  code: 'CORRIDOR / 01',
  name: 'Red Beach',
  mapId: 'red-beach',
  focus: 'Assault · Break the pass',
  situation:
    'The corps has landed on the eastern plateau. The coalition holds the beachhead and the ridge pass between the landing and the sea lane, and the second echelon is waiting offshore.',
  context:
    'The landing is the corridor opening move. Without the pass there is no route to the coast, and the corps has nowhere to put its second echelon.',
  threat: 'Coalition armour and prepared defences at the pass mouth and on the beachhead.',
  playerNationId: 'russia',
  opponentNationId: 'lithuania',
  briefing: {
    summary:
      'Force the ridge pass so the second echelon can cross, then break the coalition command post on the western beachhead.',
    subtitle: 'Assault · Break the pass',
    context:
      'Without the pass there is no route to the coast, and the corps has nowhere to put its second echelon. The landing only becomes an offensive once the ridge road is open.',
    commanderNote:
      '{{callsign}}, the beach is ours but the pass is not. Get the armour through it before the coalition digs in on both mouths.',
    friendly:
      'Russian naval infantry landing force: rifle sections, anti-tank teams, an engineer party and a single MBT, with the command post on the eastern plateau. No guns and no air — the second echelon brings both.',
    enemy:
      'Lithuanian battlegroup: matched armour and rifle strength holding the western beachhead and the village crossroads.',
    enemyIntent:
      'Hold the pass mouth, keep the corps armour off the ridge road and buy time for coalition reinforcements to land.',
    personnel: ['Sgt. Dmitri Volkov — 1st Naval Infantry Section'],
    instructions: [
      'Put at least three units inside the ridge pass to open it for the second echelon.',
      'Breaking the coalition command post ends the operation.',
      'Losing your command post ends the operation.',
      'The village depot at the western mouth of the pass carries their forward supply.',
    ],
  },
  debrief: {
    victory:
      'The pass is open and the coalition command post is gone. The second echelon has a road to the coast and the landing has become an offensive.',
    defeat:
      'The pass stayed shut, or the corps command post fell. The landing is contained on the plateau.',
  },
  objectives: [
    objective('open-the-pass', 'Open the ridge pass for the second echelon', 'primary', {
      description: 'Three units inside the ridge pass open the ridge road.',
    }),
    objective('break-coalition-cp', 'Break the coalition command post', 'primary', {
      description: 'Their beachhead command post is what holds the ridge road shut.',
      dependsOn: ['open-the-pass'],
    }),
    objective('take-the-village', 'Take the village depot', 'secondary', {
      description: 'The village at the western mouth of the pass supplies the coalition line.',
    }),
    objective('second-echelon', 'Hold the pass while the second echelon crosses', 'bonus', {
      description: 'Keep three units in the pass after their command post falls.',
    }),
  ],
  variables: [
    { id: 'echelon', type: 'string', default: 'waiting', description: 'State of the corps second echelon.' },
  ],
  regions: [RED_BEACH_REGIONS.pass, RED_BEACH_REGIONS.beachhead, RED_BEACH_REGIONS.plateau],
  triggers: [
    {
      id: 'second-echelon',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'second-echelon', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'regionOccupied', region: 'ridge-pass', team: 0, atLeast: 3 },
      ],
      actions: [
        { kind: 'setObjective', objective: 'second-echelon', state: 'complete' },
        { kind: 'message', text: 'Pass held — the second echelon is crossing the ridge road.' },
      ],
    },
    breakCommandPost({
      id: 'coalition-hq-broken',
      objective: 'break-coalition-cp',
      message: 'Coalition command post destroyed. The beachhead is ours.',
    }),
    secureRegion({
      id: 'pass-open',
      objective: 'open-the-pass',
      region: 'ridge-pass',
      atLeast: 3,
      message: 'Ridge pass open. The second echelon is moving up — break their beachhead command post.',
      unlock: 'break-coalition-cp',
      variable: { id: 'echelon', value: 'crossing' },
    }),
    secureRegion({
      id: 'village-taken',
      objective: 'take-the-village',
      region: 'beachhead',
      atLeast: 2,
      message: 'Village depot taken — their forward supply is cut.',
      priority: 25,
    }),
    regionReport({
      id: 'plateau-recon',
      region: 'plateau',
      atLeast: 2,
      text: 'We hold the plateau edge. Their beachhead is overlooked from here.',
    }),
    announce('echelon-staged', 300, 'Second echelon is staged behind the beachhead. The pass is the bottleneck.'),
    announce('coalition-reinforcements', 480, 'Coalition reinforcements are landing on the western beach.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'village-relay', name: 'Village Relay', role: 'asset' },
    { key: 'coalition-radar', name: 'Coalition Radar', role: 'objective' },
  ],
  opening: {
    speaker: 'Corps Landing Command',
    lines: [
      '{{callsign}}, the beach is ours. The ridge pass is not, and the second echelon is waiting offshore.',
      'Push the armour through the pass and the landing becomes an offensive.',
    ],
    target: { kind: 'position', x: 76, z: 30 },
    zoom: 38,
  },
  inMission: {
    id: 'echelon-ashore',
    atSeconds: 420,
    speaker: 'Corps Landing Command',
    lines: ['Second echelon is ashore. The pass is the only road that matters now.'],
    target: { kind: 'position', x: 52, z: 30 },
    zoom: 34,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Red Beach is accepted. The corridor has its ridge road — the foundry city is next.'],
  },
  veterans: [VOLKOV],
});

/* ------------------------------------------------------------------ */
/* 02 — Foundry Pocket                                                 */
/* ------------------------------------------------------------------ */

const foundryPocket: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 2,
  id: 'corridor-02',
  code: 'CORRIDOR / 02',
  name: 'Foundry Pocket',
  mapId: 'foundry-pocket',
  focus: 'Urban · The pocket',
  situation:
    'Belarusian troops push into the foundry district. The Polish garrison holds the warehouses, the rail link and the foundry core itself.',
  context:
    'The foundry city is the corridor industrial anchor. Its rail link decides who can sustain the advance through the winter.',
  threat: 'Urban ambushes in the tenements, fortified hardpoints in the foundry core and close-range armour.',
  playerNationId: 'belarus',
  opponentNationId: 'poland',
  briefing: {
    subtitle: 'Urban · The pocket',
    context:
      'The foundry city is the corridor industrial anchor. Its rail link decides who can sustain the advance through the winter.',
    commanderNote:
      '{{callsign}}, take the tenements first. An armoured column that drives straight into the core never comes out.',
    friendly:
      'Belarusian city group: an armoured company with rifle sections and engineers. Armour only — the guns arrive with the next convoy.',
    enemy:
      'Polish city garrison: armour, anti-tank teams and infantry holding the tenements, the rail link and the foundry core.',
    enemyIntent:
      'Hold the tenements, keep the rail link open and make the corridor fight for every block.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section', 'Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Take the tenements: three units inside them.',
      'Then the rail link.',
      'Break the Polish command post west of the city.',
      'The foundry core is the prize, but it is a secondary objective — do not bleed the armour for it early.',
    ],
  },
  debrief: {
    victory:
      'The pocket is closed and the rail link is the corridor’s. The foundry city is producing for the east now.',
    defeat:
      'The tenements or the rail link held, or the city group command post fell. The pocket is still open.',
  },
  objectives: [
    objective('take-tenements', 'Take the tenements', 'primary', {
      description: 'Three units inside the tenement blocks.',
    }),
    objective('take-rail-link', 'Take the rail link', 'primary', {
      description: 'The rail link is how the corridor feeds the city.',
      dependsOn: ['take-tenements'],
    }),
    objective('break-polish-hq', 'Break the Polish command post', 'primary', {
      description: 'Their headquarters is west of the city, behind the last blocks.',
      dependsOn: ['take-rail-link'],
    }),
    objective('take-foundry-core', 'Take the foundry core', 'secondary', {
      description: 'The core is fortified. Three units inside it take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [
    FOUNDRY_POCKET_REGIONS.tenements,
    FOUNDRY_POCKET_REGIONS.rail,
    FOUNDRY_POCKET_REGIONS.foundry,
  ],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'polish-hq-broken',
      objective: 'break-polish-hq',
      message: 'Polish command post destroyed. The pocket is closed.',
    }),
    secureRegion({
      id: 'tenements-taken',
      objective: 'take-tenements',
      region: 'tenements',
      atLeast: 3,
      message: 'Tenements taken. The rail link is next.',
      unlock: 'take-rail-link',
    }),
    secureRegion({
      id: 'rail-link-taken',
      objective: 'take-rail-link',
      region: 'rail',
      atLeast: 3,
      message: 'Rail link taken. Break their command post west of the city.',
      unlock: 'break-polish-hq',
    }),
    secureRegion({
      id: 'foundry-core-taken',
      objective: 'take-foundry-core',
      region: 'foundry',
      atLeast: 3,
      message: 'Foundry core taken — the works are ours.',
      priority: 25,
    }),
    announce('street-fighting', 240, 'The garrison is fighting from the cellars. Clear the blocks one at a time.'),
    announce('polish-counterattack', 420, 'Polish armour is counter-attacking the rail link.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'foundry-core', name: 'Foundry Core', role: 'objective' },
    { key: 'rail-depot', name: 'Rail Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Belarusian City Command',
    lines: [
      '{{callsign}}, the foundry city feeds the corridor. Its rail link is the prize.',
      'Tenements first. Do not drive armour into the core.',
    ],
    target: { kind: 'position', x: 74, z: 32 },
    zoom: 34,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Foundry Pocket is accepted. The city produces for the corridor now.'],
  },
  veterans: [VOLKOV, AMARI],
});

/* ------------------------------------------------------------------ */
/* 03 — Strait Blockade                                                */
/* ------------------------------------------------------------------ */

const straitBlockade: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 3,
  id: 'corridor-03',
  code: 'CORRIDOR / 03',
  name: 'Strait Blockade',
  mapId: 'strait-blockade',
  focus: 'Naval · Blockade',
  situation:
    "The coalition's island chain keeps the Kestrel Straits open. The corps must close the sea lane before the next convoy runs it.",
  context:
    'Closing the straits severs the coalition island chain and forces its naval group back to port, ending the convoy route for the season.',
  threat: 'A coalition naval group, a coastal battery and a radar station on the isle that watches the channel.',
  playerNationId: 'russia',
  opponentNationId: 'uk',
  briefing: {
    subtitle: 'Naval · Blockade',
    context:
      'Closing the straits severs the coalition island chain and forces its naval group back to port, ending the convoy route for the season.',
    commanderNote:
      '{{callsign}}, hold the blockade line for eight minutes and the convoy does not run. Then go and break their yard.',
    friendly:
      'Corps blockade group: two missile boats, a corvette, rifle sections and a yard on the eastern shore.',
    enemy:
      'Coalition channel group: corvettes, a coastal battery and a radar station watching the isle.',
    enemyIntent:
      'Break the blockade, keep the channel open and get the convoy through before the season turns.',
    personnel: ['Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Hold the blockade line until 08:00 — three units inside it.',
      'Then break the coalition command post.',
      'Take the radar isle so their convoy is blind.',
      'Losing the corps yard is a bonus objective, not a defeat condition.',
    ],
  },
  debrief: {
    victory:
      'The line held and their command post is gone. The channel is closed; the convoy route ends for the season.',
    defeat:
      'The blockade did not hold, or the corps command post fell. The convoy ran the straits again.',
  },
  objectives: [
    objective('hold-blockade', 'Hold the blockade line until 08:00', 'primary', {
      description: 'Three units inside the blockade line at 08:00.',
    }),
    objective('break-coalition-cp', 'Break the coalition command post', 'primary', {
      description: 'Their channel command post directs the convoy escorts.',
      dependsOn: ['hold-blockade'],
    }),
    objective('take-radar-isle', 'Take the radar isle', 'secondary', {
      description: 'The isle watches the whole channel. Two units take it.',
    }),
    objective('keep-corps-yard', 'Keep the corps shipyard', 'bonus', {
      description: 'The yard keeps the blockade hulls at sea.',
      protectedEntities: ['corps-yard'],
    }),
  ],
  variables: [
    { id: 'blockade', type: 'string', default: 'forming', description: 'State of the blockade line.' },
  ],
  regions: [
    STRAIT_BLOCKADE_REGIONS.channel,
    STRAIT_BLOCKADE_REGIONS.isle,
    STRAIT_BLOCKADE_REGIONS.yard,
  ],
  triggers: [
    {
      id: 'yard-kept',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'keep-corps-yard', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'entityAlive', entity: 'corps-yard' },
      ],
      actions: [
        { kind: 'setObjective', objective: 'keep-corps-yard', state: 'complete' },
        { kind: 'message', text: 'Yard intact and their command post broken — the hulls stay at sea.' },
      ],
    },
    breakCommandPost({
      id: 'coalition-hq-broken',
      objective: 'break-coalition-cp',
      message: 'Coalition command post destroyed. The straits are closed.',
    }),
    ...deadline({
      id: 'blockade-held',
      seconds: 480,
      objective: 'hold-blockade',
      region: 'channel',
      atLeast: 3,
      successMessage: 'The convoy has turned back. The blockade held.',
      failureMessage: 'Blockade broken. The convoy is through the straits.',
      unlock: 'break-coalition-cp',
      variable: { id: 'blockade', value: 'closed' },
    }),
    secureRegion({
      id: 'radar-isle-taken',
      objective: 'take-radar-isle',
      region: 'radar-isle',
      atLeast: 2,
      message: 'Radar isle taken — their convoy is running blind.',
      priority: 25,
    }),
    regionReport({
      id: 'yard-recon',
      region: 'yard',
      atLeast: 2,
      text: 'The yard is ours. Everything the coalition lands has to come through it.',
    }),
    announce('convoy-sailing', 180, 'Coalition convoy has sailed. All hulls to the blockade line.'),
    announce('escort-sighted', 360, 'Escorts are pushing the channel. Hold the line.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'corps-yard', name: 'Corps Shipyard', role: 'protected' },
    { key: 'coalition-yard', name: 'Coalition Shipyard', role: 'objective' },
    { key: 'isle-radar', name: 'Radar Station', role: 'objective' },
  ],
  opening: {
    speaker: 'Corps Blockade Command',
    lines: [
      '{{callsign}}, the coalition runs its convoys through this channel. Not this season.',
      'Hold the line for eight minutes, then break their command post.',
    ],
    target: { kind: 'position', x: 78, z: 30 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Strait Blockade is accepted. The convoy route is closed for the season.'],
  },
  veterans: [AMARI],
});

/* ------------------------------------------------------------------ */
/* 04 — Iron Column                                                    */
/* ------------------------------------------------------------------ */

const ironColumn: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 4,
  id: 'corridor-04',
  code: 'CORRIDOR / 04',
  name: 'Iron Column',
  mapId: 'iron-column',
  focus: 'Armour · The breach',
  situation:
    'A Belarusian armoured column is ordered to break the prepared Polish line that has held the corridor for a fortnight.',
  context:
    'The line is the last prepared position between the corridor and the coastal plain. Break it and the corridor runs to the water.',
  threat: 'Trench belts, hardpoints and anti-tank teams, with coalition armour behind the line.',
  playerNationId: 'belarus',
  opponentNationId: 'poland',
  briefing: {
    subtitle: 'Armour · The breach',
    context:
      'The line is the last prepared position between the corridor and the coastal plain. Break it and the corridor runs to the water.',
    commanderNote:
      '{{callsign}}, this is an armoured breach at dusk. One pass, one column, no second try before dark.',
    friendly:
      'Belarusian armoured column: three MBTs, an anti-tank vehicle, rifle sections and engineers.',
    enemy:
      'Polish defence line: two trench belts, a bunker hardpoint, anti-tank teams and armour behind the line.',
    enemyIntent:
      'Hold the breach, bleed the column in the trench belts and counter-attack with armour at last light.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section', 'Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Breach the line: three units through the breach.',
      'Then take their gun line.',
      'Break the Polish command post.',
      'The north pass is a secondary route — opening it splits their defence.',
    ],
  },
  debrief: {
    victory:
      'The line is broken and the gun line is ours. The coastal plain is open and the corridor runs to the water.',
    defeat:
      'The breach failed, or the column command post fell. The Polish line held again.',
  },
  objectives: [
    objective('breach-line', 'Breach the prepared line', 'primary', {
      description: 'Three units through the breach in the trench belt.',
    }),
    objective('take-gun-line', 'Take the coalition gun line', 'primary', {
      description: 'Their guns cover the whole breach.',
      dependsOn: ['breach-line'],
    }),
    objective('break-polish-hq', 'Break the Polish command post', 'primary', {
      description: 'Their headquarters sits behind the gun line.',
      dependsOn: ['take-gun-line'],
    }),
    objective('open-north-pass', 'Open the north pass', 'secondary', {
      description: 'A second route splits their defence.',
    }),
    cleanSweepObjective(),
  ],
  regions: [IRON_COLUMN_REGIONS.breach, IRON_COLUMN_REGIONS.northPass, IRON_COLUMN_REGIONS.gunline],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'polish-hq-broken',
      objective: 'break-polish-hq',
      message: 'Polish command post destroyed. The coastal plain is open.',
    }),
    secureRegion({
      id: 'line-breached',
      objective: 'breach-line',
      region: 'breach',
      atLeast: 3,
      message: 'Line breached. Their guns are exposed — take the gun line.',
      unlock: 'take-gun-line',
    }),
    secureRegion({
      id: 'gun-line-taken',
      objective: 'take-gun-line',
      region: 'gunline',
      atLeast: 3,
      message: 'Gun line taken. Break their command post.',
      unlock: 'break-polish-hq',
    }),
    secureRegion({
      id: 'north-pass-open',
      objective: 'open-north-pass',
      region: 'north-pass',
      atLeast: 2,
      message: 'North pass open — their defence is split.',
      priority: 25,
    }),
    announce('last-light', 300, 'Last light in five minutes. The armour must be through the breach by then.'),
    announce('polish-counterattack', 480, 'Polish armour is forming behind the line. Expect a counter-attack.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'coalition-bunker', name: 'Coalition Bunker', role: 'objective' },
    { key: 'coalition-depot', name: 'Coalition Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Belarusian Column Command',
    lines: [
      '{{callsign}}, the Polish line has held for a fortnight. It breaks tonight.',
      'One pass, one column. Get the armour through the breach before last light.',
    ],
    target: { kind: 'position', x: 72, z: 32 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Iron Column is accepted. The coastal plain is open to the corridor.'],
  },
  veterans: [VOLKOV, AMARI],
});

/* ------------------------------------------------------------------ */
/* 05 — Drone Line                                                     */
/* ------------------------------------------------------------------ */

const droneLine: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 5,
  id: 'corridor-05',
  code: 'CORRIDOR / 05',
  name: 'Drone Line',
  mapId: 'drone-line',
  focus: 'Air · Reach',
  situation:
    'An Iranian expeditionary group lands at the corridor to break the coalition air-defence net that has been shutting down corps reconnaissance.',
  context:
    'The corridor has spent its own air stocks. The Iranian group brings the drones and the reach to keep the front observed.',
  threat: 'A stacked coalition air-defence net, a radar station and interceptors over open farmland.',
  playerNationId: 'iran',
  opponentNationId: 'uk',
  briefing: {
    subtitle: 'Air · Reach',
    context:
      'The corridor has spent its own air stocks. The Iranian group brings the drones and the reach to keep the front observed.',
    commanderNote:
      '{{callsign}}, you are here because we cannot see. Kill their radar and the rest of the corridor can fly again.',
    friendly:
      'Iranian expeditionary group: reconnaissance drones, interceptors, armour and artillery support.',
    enemy:
      'Coalition air-defence group: radar station, two SAM batteries, interceptors and armour.',
    enemyIntent:
      'Keep the radar running, keep the net stacked and blind every corps sortie.',
    personnel: ['Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Destroy the coalition radar station first.',
      'Then break their command post.',
      'Hold the air-defence net ground so their interceptors cannot re-establish.',
      'You have no navy in this operation.',
    ],
  },
  debrief: {
    victory:
      'The radar is down and their command post is broken. The corridor can see its own front again.',
    defeat:
      'The radar survived, or the expeditionary group command post fell. The net still blinds the corridor.',
  },
  objectives: [
    objective('destroy-radar', 'Destroy the coalition radar station', 'primary', {
      description: 'The station is what coordinates the whole air-defence net.',
    }),
    objective('break-ad-hq', 'Break the coalition air-defence command post', 'primary', {
      description: 'Their headquarters keeps the net stacked.',
      dependsOn: ['destroy-radar'],
    }),
    objective('hold-net', 'Hold the air-defence net ground', 'secondary', {
      description: 'Three units on the net ground keep their interceptors from re-establishing.',
    }),
    cleanSweepObjective(),
  ],
  regions: [DRONE_LINE_REGIONS.radar, DRONE_LINE_REGIONS.net, DRONE_LINE_REGIONS.launch],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'ad-hq-broken',
      objective: 'break-ad-hq',
      message: 'Coalition air-defence command post destroyed. The net is down.',
    }),
    destroyEntity({
      id: 'radar-down',
      objective: 'destroy-radar',
      entity: 'coalition-radar',
      message: 'Coalition radar destroyed. Their interceptors are flying blind.',
      unlock: 'break-ad-hq',
    }),
    secureRegion({
      id: 'net-held',
      objective: 'hold-net',
      region: 'net',
      atLeast: 3,
      message: 'Net ground held — their interceptors cannot re-establish.',
      priority: 25,
    }),
    regionReport({
      id: 'radar-recon',
      region: 'radar',
      atLeast: 2,
      text: 'Radar site secured. Their picture of the belt is gone.',
    }),
    regionReport({
      id: 'launch-recon',
      region: 'launch',
      atLeast: 2,
      text: 'Launch crews are in the belt. Their aircraft still have to come to us.',
    }),
    announce('sam-lock', 240, 'Their SAM batteries have a lock on the launch belt. Move the drones.'),
    announce('interceptors-up', 420, 'Coalition interceptors are up. Keep the armour under the trees.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'coalition-radar', name: 'Coalition Radar Station', role: 'objective' },
    { key: 'net-relay', name: 'Air Defence Relay', role: 'asset' },
  ],
  opening: {
    speaker: 'Iranian Expeditionary Command',
    lines: [
      '{{callsign}}, the corridor cannot see its own front. That is why we are here.',
      'Kill the radar and their net collapses.',
    ],
    target: { kind: 'position', x: 72, z: 32 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Drone Line is accepted. The corridor can see its front again.'],
  },
  veterans: [AMARI],
});

/* ------------------------------------------------------------------ */
/* 06 — Kestrel Reach                                                  */
/* ------------------------------------------------------------------ */

const kestrelReach: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 6,
  id: 'corridor-06',
  code: 'CORRIDOR / 06',
  name: 'Kestrel Reach',
  mapId: 'kestrel-reach',
  focus: 'River · Crossing',
  situation:
    'A Belarusian river group must cross the Kestrel Reach and take the far bank before the coalition blows the bridges.',
  context:
    'The reach is the last natural barrier before the coastal road. Cross it and the corridor has a route to the water.',
  threat: 'Coalition armour and anti-tank teams on the far bank, with artillery registered on both crossings.',
  playerNationId: 'belarus',
  opponentNationId: 'lithuania',
  briefing: {
    subtitle: 'River · Crossing',
    context:
      'The reach is the last natural barrier before the coastal road. Cross it and the corridor has a route to the water.',
    commanderNote:
      '{{callsign}}, two bridges and a mill crossing. Take the bridge, hold the far bank, and do not let them blow the second span.',
    friendly:
      'Belarusian river group: armour, artillery and rifle sections, with engineers for the crossings.',
    enemy:
      'Lithuanian river group: armour and anti-tank teams on the far bank, with a depot feeding them.',
    enemyIntent:
      'Hold the far bank, keep the bridges covered and blow them if the corridor crosses.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section'],
    instructions: [
      'Take the bridge: three units across it.',
      'Then take the far bank.',
      'Break their command post beyond the depot.',
      'The mill crossing is a secondary route and a good place to flank.',
    ],
  },
  debrief: {
    victory:
      'The far bank is ours and the bridges stand. The corridor has a route to the coastal road.',
    defeat:
      'The bridge or the far bank held, or the river group command post fell. The reach is still a barrier.',
  },
  objectives: [
    objective('take-bridge', 'Take the river bridge', 'primary', {
      description: 'Three units across the bridge establish the bridgehead.',
    }),
    objective('take-far-bank', 'Take the far bank', 'primary', {
      description: 'The far bank is where their armour is waiting.',
      dependsOn: ['take-bridge'],
    }),
    objective('break-river-hq', 'Break the Lithuanian command post', 'primary', {
      description: 'Their headquarters is beyond the depot on the far side.',
      dependsOn: ['take-far-bank'],
    }),
    objective('take-mill', 'Take the mill crossing', 'secondary', {
      description: 'A second crossing splits their defence. Two units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [KESTREL_REACH_REGIONS.bridge, KESTREL_REACH_REGIONS.farBank, KESTREL_REACH_REGIONS.mill],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'river-hq-broken',
      objective: 'break-river-hq',
      message: 'Lithuanian command post destroyed. The reach is crossed.',
    }),
    secureRegion({
      id: 'bridge-taken',
      objective: 'take-bridge',
      region: 'bridge',
      atLeast: 3,
      message: 'Bridge taken and intact. Push for the far bank.',
      unlock: 'take-far-bank',
    }),
    secureRegion({
      id: 'far-bank-taken',
      objective: 'take-far-bank',
      region: 'far-bank',
      atLeast: 3,
      message: 'Far bank taken. Break their command post.',
      unlock: 'break-river-hq',
    }),
    secureRegion({
      id: 'mill-taken',
      objective: 'take-mill',
      region: 'mill',
      atLeast: 2,
      message: 'Mill crossing taken — their defence is split.',
      priority: 25,
    }),
    announce('bridges-wired', 240, 'Engineers report both spans are wired. They will blow them if we cross.'),
    announce('artillery-registered', 420, 'Coalition artillery is registered on the bridge. Move fast.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'mill', name: 'Mill Crossing', role: 'asset' },
    { key: 'coalition-depot', name: 'Coalition Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Belarusian River Command',
    lines: [
      '{{callsign}}, the reach is the last barrier before the coastal road.',
      'Take the bridge intact, then the far bank. They will try to blow it behind us.',
    ],
    target: { kind: 'position', x: 74, z: 34 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Kestrel Reach is accepted. The crossing is open and the coastal road is next.'],
  },
  veterans: [VOLKOV],
});

/* ------------------------------------------------------------------ */
/* 07 — Coast Road                                                     */
/* ------------------------------------------------------------------ */

const coastRoad: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 7,
  id: 'corridor-07',
  code: 'CORRIDOR / 07',
  name: 'Coast Road',
  mapId: 'coast-road',
  focus: 'Coastal · Shore push',
  situation:
    'A corps coastal column pushes down the shore road to take the coalition harbour that supplies the northern islands.',
  context:
    'The harbour is the last coalition landing point on this coast. Take it and the islands have to be supplied by air.',
  threat: 'Coalition armour on the road, a yard and a coastal battery over the anchorage.',
  playerNationId: 'russia',
  opponentNationId: 'finland',
  briefing: {
    subtitle: 'Coastal · Shore push',
    context:
      'The harbour is the last coalition landing point on this coast. Take it and the islands have to be supplied by air.',
    commanderNote:
      '{{callsign}}, the road is under naval gunfire for most of its length. Keep the column off the sand.',
    friendly:
      'Corps coastal column: armour, missile boats and rifle sections, with a yard on the eastern shore.',
    enemy:
      'Finnish coastal group: armour, a yard, a coastal battery and infantry on the headland.',
    enemyIntent:
      'Hold the headland, shell the road and keep the harbour open.',
    personnel: ['Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Take the headland first: three units on it.',
      'Then cut the harbour.',
      'Their coastal battery covers the approach. Silence it or stay off the sand.',
      'Break their command post to finish the operation.',
    ],
  },
  debrief: {
    victory:
      'The harbour is cut and their command post is gone. The islands are supplied by air now, and badly.',
    defeat:
      'The headland or harbour held, or the coastal column command post fell. The harbour still works.',
  },
  objectives: [
    objective('take-headland', 'Take the headland', 'primary', {
      description: 'The headland overlooks the road and the harbour mouth.',
    }),
    objective('cut-harbour', 'Cut the harbour', 'primary', {
      description: 'Three units in the harbour close it.',
      dependsOn: ['take-headland'],
    }),
    objective('break-coastal-hq', 'Break the Finnish command post', 'primary', {
      description: 'Their headquarters sits behind the harbour road.',
      dependsOn: ['cut-harbour'],
    }),
    objective('hold-road', 'Hold the coast road', 'secondary', {
      description: 'Their armour uses the road to move between the yard and the harbour.',
    }),
    objective('keep-yard', 'Keep the corps shipyard', 'bonus', {
      description: 'The yard keeps the column supplied by sea.',
      protectedEntities: ['corps-yard'],
    }),
  ],
  regions: [COAST_ROAD_REGIONS.headland, COAST_ROAD_REGIONS.harbour, COAST_ROAD_REGIONS.road],
  triggers: [
    {
      id: 'yard-kept',
      priority: 58,
      once: true,
      conditions: [
        { kind: 'objective', objective: 'keep-yard', state: 'active' },
        { kind: 'entityDead', entity: 'enemy-hq' },
        { kind: 'entityAlive', entity: 'corps-yard' },
      ],
      actions: [
        { kind: 'setObjective', objective: 'keep-yard', state: 'complete' },
        { kind: 'message', text: 'Yard intact and their command post broken.' },
      ],
    },
    breakCommandPost({
      id: 'coastal-hq-broken',
      objective: 'break-coastal-hq',
      message: 'Finnish command post destroyed. The harbour is cut.',
    }),
    secureRegion({
      id: 'headland-taken',
      objective: 'take-headland',
      region: 'headland',
      atLeast: 3,
      message: 'Headland taken. The harbour is under our guns.',
      unlock: 'cut-harbour',
    }),
    secureRegion({
      id: 'harbour-cut',
      objective: 'cut-harbour',
      region: 'harbour',
      atLeast: 3,
      message: 'Harbour cut. Break their command post.',
      unlock: 'break-coastal-hq',
    }),
    secureRegion({
      id: 'road-held',
      objective: 'hold-road',
      region: 'coast-road',
      atLeast: 3,
      message: 'Coast road held — their armour is cut off from the harbour.',
      priority: 25,
    }),
    announce('naval-gunfire', 240, 'Their coastal battery is walking shells down the road.'),
    announce('coalition-evacuation', 480, 'Coalition shipping is loading at the harbour. Finish it.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'corps-yard', name: 'Corps Shipyard', role: 'protected' },
    { key: 'coalition-yard', name: 'Coalition Shipyard', role: 'objective' },
    { key: 'coalition-depot', name: 'Coalition Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Corps Coastal Command',
    lines: [
      '{{callsign}}, that harbour is the last place the coalition can land on this coast.',
      'Take the headland, then cut the harbour.',
    ],
    target: { kind: 'position', x: 76, z: 28 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Coast Road is accepted. The islands are on air supply now.'],
  },
  veterans: [AMARI],
});

/* ------------------------------------------------------------------ */
/* 08 — Gun Line                                                       */
/* ------------------------------------------------------------------ */

const gunLine: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 8,
  id: 'corridor-08',
  code: 'CORRIDOR / 08',
  name: 'Gun Line',
  mapId: 'gun-line',
  focus: 'Siege · Fortified grid',
  situation:
    'A North Korean siege group arrives at the corridor to break the fortified Polish grid that has stopped every frontal attack.',
  context:
    'The grid covers the only approach to the coastal plain. The corridor has the guns to flatten it, if the guns survive.',
  threat: 'A fortified grid of hardpoints, trenches and anti-tank teams, with armour behind it.',
  playerNationId: 'northKorea',
  opponentNationId: 'poland',
  briefing: {
    subtitle: 'Siege · Fortified grid',
    context:
      'The grid covers the only approach to the coastal plain. The corridor has the guns to flatten it, if the guns survive.',
    commanderNote:
      '{{callsign}}, we are here to do the one thing the corridor cannot: stand off and flatten them. Keep the guns alive.',
    friendly:
      'Korean siege group: two self-propelled guns, a rocket battery, armour and rifle sections.',
    enemy:
      'Polish fortified grid: bunkers, trench lines, machine-gun nests and armour behind the works.',
    enemyIntent:
      'Hold the grid, make every metre cost a company and counter-attack with armour when the guns move.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section'],
    instructions: [
      'Take the grid: three units inside the fortified line.',
      'Destroy the main bunker.',
      'Break the Polish command post behind the works.',
      'Their depot is a secondary objective; it is where the grid is resupplied.',
    ],
  },
  debrief: {
    victory:
      'The grid is broken and their command post is gone. The approach to the coastal plain is open.',
    defeat:
      'The grid held, or the siege group command post fell. The fortifications are still intact.',
  },
  objectives: [
    objective('take-grid', 'Take the fortified grid', 'primary', {
      description: 'Three units inside the fortified line.',
    }),
    objective('destroy-bunker', 'Destroy the main bunker', 'primary', {
      description: 'The bunker anchors the whole grid.',
      dependsOn: ['take-grid'],
    }),
    objective('break-grid-hq', 'Break the Polish command post', 'primary', {
      description: 'Their headquarters is behind the works.',
      dependsOn: ['destroy-bunker'],
    }),
    objective('hold-revetments', 'Hold the revetments', 'secondary', {
      description: 'The revetments protect the gun line. Two units hold them.',
    }),
    cleanSweepObjective(),
  ],
  regions: [GUN_LINE_REGIONS.line, GUN_LINE_REGIONS.revetments, GUN_LINE_REGIONS.grid],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'grid-hq-broken',
      objective: 'break-grid-hq',
      message: 'Polish command post destroyed. The grid is broken.',
    }),
    secureRegion({
      id: 'grid-taken',
      objective: 'take-grid',
      region: 'gun-line',
      atLeast: 3,
      message: 'Grid taken. The bunker is exposed to the guns.',
      unlock: 'destroy-bunker',
    }),
    destroyEntity({
      id: 'bunker-destroyed',
      objective: 'destroy-bunker',
      entity: 'coalition-bunker',
      message: 'Main bunker destroyed. Their line has a hole in it.',
      unlock: 'break-grid-hq',
    }),
    secureRegion({
      id: 'revetments-held',
      objective: 'hold-revetments',
      region: 'revetments',
      atLeast: 2,
      message: 'Revetments held — the guns are still in action.',
      priority: 25,
    }),
    announce('counter-battery', 300, 'Coalition counter-battery fire is ranging on the guns. Move them.'),
    regionReport({
      id: 'grid-recon',
      region: 'grid',
      atLeast: 2,
      text: 'Survey teams are in the grid. The bunker is laid out exactly as the aerial photographs showed.',
    }),
    announce('grid-reinforced', 480, 'Their armour is moving up behind the grid. Finish the bunker.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'coalition-bunker', name: 'Coalition Bunker', role: 'objective' },
    { key: 'coalition-depot', name: 'Coalition Depot', role: 'objective' },
  ],
  opening: {
    speaker: 'Korean Siege Command',
    lines: [
      '{{callsign}}, the corridor has thrown men at that grid for a month. We brought guns.',
      'Take the line, then flatten the bunker.',
    ],
    target: { kind: 'position', x: 72, z: 32 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Gun Line is accepted. The approach to the coastal plain is open.'],
  },
  veterans: [VOLKOV],
});

/* ------------------------------------------------------------------ */
/* 09 — Winter Road                                                    */
/* ------------------------------------------------------------------ */

const winterRoad: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 9,
  id: 'corridor-09',
  code: 'CORRIDOR / 09',
  name: 'Winter Road',
  mapId: 'winter-road',
  focus: 'Winter · Frozen corridor',
  situation:
    'A corps winter column must move down the frozen road to reach the forward depot before the coalition counter-offensive cuts it.',
  context:
    'The depot is what keeps the northern corridor alive through the winter. Lose it and the whole northern group is on half rations.',
  threat: 'A coalition winter group holding the treeline, a forward post and the depot itself.',
  playerNationId: 'russia',
  opponentNationId: 'sweden',
  briefing: {
    subtitle: 'Winter · Frozen corridor',
    context:
      'The depot is what keeps the northern corridor alive through the winter. Lose it and the whole northern group is on half rations.',
    commanderNote:
      '{{callsign}}, the road is the only way through and it is frozen solid. Whoever holds the treeline holds the road.',
    friendly:
      'Corps winter column: armour, a reconnaissance drone, rifle sections and engineers.',
    enemy:
      'Swedish winter group: armour, anti-tank teams and infantry in the treeline and at the forward post.',
    enemyIntent:
      'Hold the treeline, cut the road and take the depot before the column reaches it.',
    personnel: ['Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Take the winter road: three units on it.',
      'Then take the depot.',
      'Break their command post.',
      'The treeline is a secondary objective — it is where their anti-tank teams hide.',
    ],
  },
  debrief: {
    victory:
      'The road and the depot are ours. The northern corridor is supplied through the winter.',
    defeat:
      'The road or depot held, or the winter column command post fell. The northern group is on half rations.',
  },
  objectives: [
    objective('take-road', 'Take the winter road', 'primary', {
      description: 'Three units on the road clear the way down.',
    }),
    objective('take-depot', 'Take the forward depot', 'primary', {
      description: 'The depot is what the column came for.',
      dependsOn: ['take-road'],
    }),
    objective('break-winter-hq', 'Break the Swedish command post', 'primary', {
      description: 'Their headquarters is south of the depot.',
      dependsOn: ['take-depot'],
    }),
    objective('hold-treeline', 'Hold the treeline', 'secondary', {
      description: 'Three units in the treeline stop their anti-tank teams returning.',
    }),
    cleanSweepObjective(),
  ],
  regions: [WINTER_ROAD_REGIONS.road, WINTER_ROAD_REGIONS.treeline, WINTER_ROAD_REGIONS.depot],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'winter-hq-broken',
      objective: 'break-winter-hq',
      message: 'Swedish command post destroyed. The road is ours.',
    }),
    secureRegion({
      id: 'road-taken',
      objective: 'take-road',
      region: 'winter-road',
      atLeast: 3,
      message: 'Winter road taken. The depot is next.',
      unlock: 'take-depot',
    }),
    secureRegion({
      id: 'depot-taken',
      objective: 'take-depot',
      region: 'depot',
      atLeast: 3,
      message: 'Forward depot taken. Break their command post.',
      unlock: 'break-winter-hq',
    }),
    secureRegion({
      id: 'treeline-held',
      objective: 'hold-treeline',
      region: 'treeline',
      atLeast: 3,
      message: 'Treeline held — their anti-tank teams are pushed out.',
      priority: 25,
    }),
    announce('ice-thinning', 300, 'The ice is thinning on the marsh. Keep the armour on the road.'),
    announce('coalition-push', 480, 'Coalition infantry is pushing the treeline. Hold the road.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'coalition-depot', name: 'Forward Depot', role: 'objective' },
    { key: 'coalition-post', name: 'Coalition Forward Post', role: 'objective' },
  ],
  opening: {
    speaker: 'Corps Winter Command',
    lines: [
      '{{callsign}}, the northern corridor lives on that depot. So do we.',
      'Down the road, take the depot, break their command post.',
    ],
    target: { kind: 'position', x: 40, z: 20 },
    zoom: 34,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Winter Road is accepted. The northern group is supplied through the ice.'],
  },
  veterans: [AMARI],
});

/* ------------------------------------------------------------------ */
/* 10 — Depot War                                                      */
/* ------------------------------------------------------------------ */

const depotWar: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 10,
  id: 'corridor-10',
  code: 'CORRIDOR / 10',
  name: 'Depot War',
  mapId: 'depot-war',
  focus: 'Logistics · Supply',
  situation:
    'With the coalition counter-offensive under way, a Belarusian supply group is ordered to take the two depots that feed the coalition northern flank.',
  context:
    'The coalition counter-offensive runs on those depots. Take them and the counter-offensive stops where it stands.',
  threat: 'Coalition armour and infantry between the depots, with artillery registered on the open farmland.',
  playerNationId: 'belarus',
  opponentNationId: 'poland',
  briefing: {
    subtitle: 'Logistics · Supply',
    context:
      'The coalition counter-offensive runs on those depots. Take them and the counter-offensive stops where it stands.',
    commanderNote:
      '{{callsign}}, this is not a battle for ground. It is a battle for two warehouses and a silo.',
    friendly:
      'Belarusian supply group: armour, artillery and rifle sections, with engineers.',
    enemy:
      'Polish supply group: armour, anti-tank teams and infantry holding both depots and the silo.',
    enemyIntent:
      'Hold both depots, keep the silo and buy the counter-offensive its supply.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section'],
    instructions: [
      'Take the north depot first.',
      'Then the south depot.',
      'Break their command post.',
      'The grain silo is worth taking — it is their last reserve.',
    ],
  },
  debrief: {
    victory:
      'Both depots are ours and their command post is gone. The coalition counter-offensive has to halt and re-supply.',
    defeat:
      'The depots held, or the supply group command post fell. The counter-offensive is still supplied.',
  },
  objectives: [
    objective('take-north-depot', 'Take the north depot', 'primary', {
      description: 'Three units inside the north depot.',
    }),
    objective('take-south-depot', 'Take the south depot', 'primary', {
      description: 'Both depots have to fall for the counter-offensive to stall.',
      dependsOn: ['take-north-depot'],
    }),
    objective('break-supply-hq', 'Break the Polish command post', 'primary', {
      description: 'Their headquarters sits east of the depots.',
      dependsOn: ['take-south-depot'],
    }),
    objective('take-silo', 'Take the grain silo', 'secondary', {
      description: 'Their last reserve is in the silo. Two units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [DEPOT_WAR_REGIONS.northDepot, DEPOT_WAR_REGIONS.southDepot, DEPOT_WAR_REGIONS.silo],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'supply-hq-broken',
      objective: 'break-supply-hq',
      message: 'Polish command post destroyed. The counter-offensive has no supply.',
    }),
    secureRegion({
      id: 'north-depot-taken',
      objective: 'take-north-depot',
      region: 'north-depot',
      atLeast: 3,
      message: 'North depot taken. Now the south.',
      unlock: 'take-south-depot',
    }),
    secureRegion({
      id: 'south-depot-taken',
      objective: 'take-south-depot',
      region: 'south-depot',
      atLeast: 3,
      message: 'South depot taken. Break their command post.',
      unlock: 'break-supply-hq',
    }),
    secureRegion({
      id: 'silo-taken',
      objective: 'take-silo',
      region: 'silo',
      atLeast: 2,
      message: 'Grain silo taken — their last reserve is ours.',
      priority: 25,
    }),
    announce('counter-offensive', 240, 'The coalition counter-offensive is still moving. Cut its supply.'),
    announce('depot-convoy', 420, 'A supply convoy is running between the depots. Intercept it.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'north-depot', name: 'North Depot', role: 'objective' },
    { key: 'south-depot', name: 'South Depot', role: 'objective' },
    { key: 'silo', name: 'Grain Silo', role: 'asset' },
  ],
  opening: {
    speaker: 'Belarusian Supply Command',
    lines: [
      '{{callsign}}, the counter-offensive runs on two depots and a silo.',
      'Take them and it stops where it stands.',
    ],
    target: { kind: 'position', x: 74, z: 32 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Depot War is accepted. The counter-offensive has to halt and re-supply.'],
  },
  veterans: [VOLKOV],
});

/* ------------------------------------------------------------------ */
/* 11 — Foundry Falls                                                  */
/* ------------------------------------------------------------------ */

const foundryFalls: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 11,
  id: 'corridor-11',
  code: 'CORRIDOR / 11',
  name: 'Foundry Falls',
  mapId: 'foundry-falls',
  focus: 'Urban · Decisive',
  situation:
    'The coalition counter-offensive has reached the foundry city. The corps must hold the city, or lose the corridor industrial base entirely.',
  context:
    'The foundry is the only heavy industry the corridor holds. Losing it means every replacement hull comes a thousand kilometres by rail.',
  threat: 'Coalition armour and artillery in the streets, with air support over the whole grid.',
  playerNationId: 'russia',
  opponentNationId: 'poland',
  briefing: {
    subtitle: 'Urban · Decisive',
    context:
      'The foundry is the only heavy industry the corridor holds. Losing it means every replacement hull comes a thousand kilometres by rail.',
    commanderNote:
      '{{callsign}}, this is the city we took two years ago. Hold it or the campaign is over.',
    friendly:
      'Corps city group: full armour, artillery, rocket support and strike aircraft.',
    enemy:
      'Polish city group: armour, artillery and infantry inside the grid, with air support.',
    enemyIntent:
      'Take the foundry core, cut the station and break the corps hold on the city.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section', 'Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Hold the foundry core: four units inside it.',
      'Then take the rail station.',
      'Break their command post.',
      'The north yards are a secondary objective — they are their staging ground.',
    ],
  },
  debrief: {
    victory:
      'The core held and the station is ours. The foundry city stays in the corridor, and the counter-offensive has run out of cities to take.',
    defeat:
      'The core or the station fell, or the city group command post was lost. The findustry is gone.',
  },
  objectives: [
    objective('hold-core', 'Hold the foundry core', 'primary', {
      description: 'Four units inside the core keep the works running.',
    }),
    objective('take-station', 'Take the rail station', 'primary', {
      description: 'The station is how the coalition is feeding the assault.',
      dependsOn: ['hold-core'],
    }),
    objective('break-city-hq', 'Break the Polish command post', 'primary', {
      description: 'Their headquarters is west of the grid.',
      dependsOn: ['take-station'],
    }),
    objective('take-yards', 'Take the north yards', 'secondary', {
      description: 'Their staging ground. Three units take it.',
    }),
    cleanSweepObjective(),
  ],
  regions: [FOUNDRY_FALLS_REGIONS.core, FOUNDRY_FALLS_REGIONS.station, FOUNDRY_FALLS_REGIONS.yards],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'city-hq-broken',
      objective: 'break-city-hq',
      message: 'Polish command post destroyed. The counter-offensive has lost its spearhead.',
    }),
    secureRegion({
      id: 'core-held',
      objective: 'hold-core',
      region: 'core',
      atLeast: 4,
      message: 'Foundry core held. The works are still running.',
      unlock: 'take-station',
    }),
    secureRegion({
      id: 'station-taken',
      objective: 'take-station',
      region: 'station',
      atLeast: 3,
      message: 'Rail station taken. Break their command post.',
      unlock: 'break-city-hq',
    }),
    secureRegion({
      id: 'yards-taken',
      objective: 'take-yards',
      region: 'yards',
      atLeast: 3,
      message: 'North yards taken — their staging ground is ours.',
      priority: 25,
    }),
    announce('coalition-push', 240, 'Coalition armour is pushing the western grid.'),
    announce('air-raid', 420, 'Coalition aircraft are working the foundry. Get the guns under cover.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'foundry-core', name: 'Foundry Core', role: 'protected' },
    { key: 'station-depot', name: 'Rail Station', role: 'objective' },
    { key: 'city-hall', name: 'City Hall', role: 'asset' },
  ],
  opening: {
    speaker: 'Corps City Command',
    lines: [
      '{{callsign}}, the counter-offensive is at the edge of the foundry.',
      'Hold the core. Everything else follows from that.',
    ],
    target: { kind: 'position', x: 78, z: 32 },
    zoom: 34,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Foundry Falls is accepted. The city stays with the corridor.'],
  },
  veterans: [VOLKOV, AMARI],
});

/* ------------------------------------------------------------------ */
/* 12 — Straits Terms                                                  */
/* ------------------------------------------------------------------ */

const straitsTerms: AuthoredOperation = buildOperation({
  campaignId: 'eastern-corridor',
  side: 'eastern',
  order: 12,
  id: 'corridor-12',
  code: 'CORRIDOR / 12',
  name: 'Straits Terms',
  mapId: 'straits-terms',
  focus: 'Finale · The straits',
  situation:
    'The war has reached the water. The corps holds the straits and the coalition wants them open. Both sides know this is the last operation that matters.',
  context:
    'Whoever holds the straits at the end of the season writes the terms. The corps intends to be the one holding them.',
  threat: 'A coalition combined task force: two yards, air support, coastal batteries and armour.',
  playerNationId: 'russia',
  opponentNationId: 'uk',
  briefing: {
    subtitle: 'Finale · The straits',
    context:
      'Whoever holds the straits at the end of the season writes the terms. The corps intends to be the one holding them.',
    commanderNote:
      '{{callsign}}, everything the corridor has left is in this command. Hold the straits and we negotiate from the water.',
    friendly:
      'Corps coastal command: full armour, artillery, air and naval support, with a yard and an airfield.',
    enemy:
      'Coalition straits command: two yards, air support, coastal batteries and armour.',
    enemyIntent:
      'Open the straits, break the corps coastal command and force the corridor to terms.',
    personnel: ['Sgt. Dmitri Volkov — 1st Rifle Section', 'Cpl. Nadia Amari — Anti-Tank Team'],
    instructions: [
      'Take the signal island first.',
      'Then hold the strait: three units inside it.',
      'Break the coalition command post.',
      'Their coastal battery covers the channel. Silence it if you can.',
    ],
  },
  debrief: {
    victory:
      'The straits are held and the coalition command post is gone. The corridor negotiates from the water.',
    defeat:
      'The island or the strait fell, or the coastal command post was lost. The coalition opens the channel.',
  },
  objectives: [
    objective('take-island', 'Take the signal island', 'primary', {
      description: 'The island watches the whole strait.',
    }),
    objective('hold-strait', 'Hold the strait', 'primary', {
      description: 'Three units inside the strait close it to the coalition.',
      dependsOn: ['take-island'],
    }),
    objective('break-straits-hq', 'Break the coalition command post', 'primary', {
      description: 'Their headquarters is the last coalition command on the coast.',
      dependsOn: ['hold-strait'],
    }),
    objective('silence-battery', 'Silence the coastal battery', 'secondary', {
      description: 'One battery still covers the channel.',
    }),
    cleanSweepObjective(),
  ],
  regions: [STRAITS_TERMS_REGIONS.strait, STRAITS_TERMS_REGIONS.island, STRAITS_TERMS_REGIONS.base],
  triggers: [
    cleanSweepTrigger(),
    breakCommandPost({
      id: 'straits-hq-broken',
      objective: 'break-straits-hq',
      message: 'Coalition command post destroyed. The straits are held.',
    }),
    secureRegion({
      id: 'island-taken',
      objective: 'take-island',
      region: 'island',
      atLeast: 2,
      message: 'Signal island taken. The strait is in our hands.',
      unlock: 'hold-strait',
    }),
    secureRegion({
      id: 'strait-held',
      objective: 'hold-strait',
      region: 'strait',
      atLeast: 3,
      message: 'Strait held. Break their command post and the campaign is over.',
      unlock: 'break-straits-hq',
    }),
    destroyEntity({
      id: 'battery-silenced',
      objective: 'silence-battery',
      entity: 'coalition-battery',
      message: 'Coalition coastal battery silenced. The channel is open to us.',
      priority: 30,
    }),
    announce('coalition-fleet', 300, 'Coalition hulls are forming up outside the strait.'),
    regionReport({
      id: 'base-recon',
      region: 'base',
      atLeast: 2,
      text: 'We are inside the base perimeter. The loading bays are in range of the strait battery.',
    }),
    announce('terms-offered', 540, 'Coalition command is offering terms. Answer with the guns.'),
  ],
  entities: [
    ...commandPair(),
    { key: 'signal-island', name: 'Signal Island', role: 'objective' },
    { key: 'coalition-battery', name: 'Coalition Coastal Battery', role: 'objective' },
    { key: 'coalition-yard', name: 'Coalition Shipyard', role: 'objective' },
    { key: 'corps-yard', name: 'Corps Shipyard', role: 'protected' },
  ],
  opening: {
    speaker: 'Corps Coastal Command',
    lines: [
      '{{callsign}}, the season ends here. Whoever holds the straits writes the terms.',
      'Take the island, hold the strait, break their command post.',
    ],
    target: { kind: 'position', x: 82, z: 34 },
    zoom: 36,
  },
  ending: {
    speaker: 'Corps Command',
    lines: ['Straits Terms is accepted. The corridor negotiates from the water.'],
  },
  veterans: [VOLKOV, AMARI],
});

/** The Eastern Corridor, in campaign order. */
export const EASTERN_OPERATIONS: readonly AuthoredOperation[] = Object.freeze([
  redBeach,
  foundryPocket,
  straitBlockade,
  ironColumn,
  droneLine,
  kestrelReach,
  coastRoad,
  gunLine,
  winterRoad,
  depotWar,
  foundryFalls,
  straitsTerms,
]);
