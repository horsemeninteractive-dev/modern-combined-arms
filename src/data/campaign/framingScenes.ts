/**
 * Shipped campaign framing scenes.
 *
 * Every campaign opens before its first deployment, breathes between accepted
 * operations and closes after the last one. Those three moments belong to the
 * campaign, not to any operation, so they live on the campaign definition and
 * share the mission presentation format: the same ordered timeline, the same
 * camera and card beats, the same validation and the same playback clock.
 *
 * The prose is written against the corridor rather than against one theatre.
 * Intermission is the only scene that plays more than once, so it names no
 * operation and no objective: it describes the state every accepted operation
 * leaves behind. Camera beats target the two command posts every operation
 * authors, which keeps a scene valid on all twelve theatres instead of pinning
 * a map coordinate that only exists on one.
 */
import type { MissionCinematicDoc, MissionCinematicStep } from '../../mission/types';

/** Campaign scene contexts, kept local so this module has no storage coupling. */
type FramingContext = 'campaignIntro' | 'intermission' | 'campaignFinale';

/** The dip every framing scene uses, so chained scenes read as one presentation. */
function scene(
  id: string,
  kind: FramingContext,
  steps: MissionCinematicStep[],
): MissionCinematicDoc {
  return {
    id,
    kind,
    skippable: true,
    transition: {
      in: { kind: 'fade', durationSeconds: 1 },
      out: { kind: 'fade', durationSeconds: 1.1 },
    },
    steps,
    dialogue: [],
  };
}

/* ------------------------------------------------------------------ */
/* The Baltic Line                                                     */
/* ------------------------------------------------------------------ */

export const BALTIC_FRAMING_SCENES: readonly MissionCinematicDoc[] = [
  scene('baltic-intro', 'campaignIntro', [
    {
      kind: 'card',
      heading: 'Chapter I',
      subheading: 'The Baltic Line',
      body: 'Kestrel Bay · 04:40 · the convoy is still at sea',
      durationSeconds: 3.2,
    },
    { kind: 'music', track: 'theatre-of-operations', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 54,
      durationSeconds: 2.8,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'The corps is dug in above Kestrel Bay, and the convoy that carries our armour is still at sea.',
      durationSeconds: 6,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'Lithuania holds the beachhead. Poland brings the armour. Britain keeps the sea lane open.',
      durationSeconds: 5.8,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'Twelve operations to hold the line — and then twelve to take it back.',
      durationSeconds: 5.2,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 36,
      durationSeconds: 3,
      holdSeconds: 0.8,
    },
  ]),
  scene('baltic-intermission', 'intermission', [
    {
      kind: 'card',
      heading: 'Intermission',
      subheading: 'The line moves east',
      durationSeconds: 2.6,
    },
    { kind: 'music', track: 'silent-front', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 44,
      durationSeconds: 2.4,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'One more stretch of the line is ours. What is left of the corps falls back on the next river.',
      durationSeconds: 5.6,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'Replacements come forward, the wounded go back, and the map is redrawn before dawn.',
      durationSeconds: 5.2,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'The next objective is already written. Rest while the guns are quiet.',
      durationSeconds: 4.8,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 50,
      durationSeconds: 3,
      holdSeconds: 0.3,
    },
  ]),
  scene('baltic-finale', 'campaignFinale', [
    {
      kind: 'card',
      heading: 'The Baltic Line',
      subheading: 'The straits are held',
      durationSeconds: 3,
    },
    { kind: 'music', track: 'forward-command', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 58,
      durationSeconds: 3,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'The last corps command post on the straits has gone quiet.',
      durationSeconds: 4.8,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'Kestrel Bay, the passes, the foundry, the granite: every stretch of the corridor is coalition ground.',
      durationSeconds: 6.4,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Baltic Command',
      text: 'Finland and Sweden hold the north. The Baltic is a coalition sea again.',
      durationSeconds: 5.4,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 32,
      durationSeconds: 3,
      holdSeconds: 1,
    },
    {
      kind: 'card',
      heading: 'Campaign complete',
      subheading: 'The Baltic Line · held',
      durationSeconds: 3.4,
    },
  ]),
];

/* ------------------------------------------------------------------ */
/* The Eastern Corridor                                                */
/* ------------------------------------------------------------------ */

export const EASTERN_FRAMING_SCENES: readonly MissionCinematicDoc[] = [
  scene('eastern-intro', 'campaignIntro', [
    {
      kind: 'card',
      heading: 'Chapter I',
      subheading: 'The Eastern Corridor',
      body: 'Red Beach · 03:10 · the second echelon waits offshore',
      durationSeconds: 3.2,
    },
    { kind: 'music', track: 'forward-command', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 54,
      durationSeconds: 2.8,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'The corps lands at first light and does not stop at the waterline.',
      durationSeconds: 5.2,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Belarus takes the cities. Iran supplies the reach. The siege guns come up by rail.',
      durationSeconds: 5.8,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Twelve operations to the coast — and then twelve to hold it.',
      durationSeconds: 5,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 36,
      durationSeconds: 3,
      holdSeconds: 0.8,
    },
  ]),
  scene('eastern-intermission', 'intermission', [
    {
      kind: 'card',
      heading: 'Intermission',
      subheading: 'The corridor moves west',
      durationSeconds: 2.6,
    },
    { kind: 'music', track: 'silent-front', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 44,
      durationSeconds: 2.4,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'The pass is open and the coast is one road nearer. The second echelon is ashore.',
      durationSeconds: 5.4,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Supply trains follow the armour now. What the coalition breaks, the depots replace.',
      durationSeconds: 5.2,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Let them dig in ahead of us. They will be digging on ground we intend to take.',
      durationSeconds: 5.2,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 50,
      durationSeconds: 3,
      holdSeconds: 0.3,
    },
  ]),
  scene('eastern-finale', 'campaignFinale', [
    {
      kind: 'card',
      heading: 'The Eastern Corridor',
      subheading: 'The straits are ours',
      durationSeconds: 3,
    },
    { kind: 'music', track: 'forward-command', durationSeconds: 0 },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'enemy-hq' },
      zoom: 58,
      durationSeconds: 3,
      holdSeconds: 0.4,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'The last coalition command post on the coast has gone silent.',
      durationSeconds: 4.8,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Red Beach, the foundry, the blockade, the winter road: the corridor runs to the sea and holds it.',
      durationSeconds: 6.4,
      pauseSeconds: 0.3,
    },
    {
      kind: 'line',
      speaker: 'Corridor Command',
      text: 'Iran and North Korea fed the long war. The straits answer to the pact now.',
      durationSeconds: 5.4,
    },
    {
      kind: 'camera',
      target: { kind: 'entity', entity: 'own-hq' },
      zoom: 32,
      durationSeconds: 3,
      holdSeconds: 1,
    },
    {
      kind: 'card',
      heading: 'Campaign complete',
      subheading: 'The Eastern Corridor · held',
      durationSeconds: 3.4,
    },
  ]),
];
