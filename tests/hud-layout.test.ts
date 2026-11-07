import { describe, expect, it } from 'vitest';
import {
  PRODUCTION_TABS,
  cardArtState,
  edgeAutoScrollVelocity,
  edgePanVector,
  minimapBackingSize,
  minimapStatus,
  productionBlockReason,
  productionCardState,
  productionDomain,
  resolveHudLayout,
  structureTab,
  toggleHudPanel,
} from '../src/ui/hudLayout';

describe('battle HUD layout selection', () => {
  it('uses the desktop composition at the reference desktop sizes', () => {
    expect(resolveHudLayout(1280, 720, false)).toBe('desktop');
    expect(resolveHudLayout(1920, 1080, false)).toBe('desktop');
  });

  it('uses the mobile composition at both landscape phone sizes', () => {
    expect(resolveHudLayout(844, 390, false)).toBe('mobile');
    expect(resolveHudLayout(667, 375, false)).toBe('mobile');
  });

  it('prefers the touch composition for a coarse-pointer tablet', () => {
    expect(resolveHudLayout(1024, 768, true)).toBe('mobile');
    expect(resolveHudLayout(1024, 768, false)).toBe('desktop');
  });

  it('uses the touch composition on a short desktop window', () => {
    expect(resolveHudLayout(1200, 460, false)).toBe('mobile');
  });
});

describe('edge panning', () => {
  // Desktop battlefield between a 96 px rail, a 236 px sidebar and a 156 px
  // console. The old canvas-edge test could only fire along the top.
  const view = { left: 96, top: 0, right: 1044, bottom: 564 };
  const margin = 18;
  const speed = 4;

  it('pans from all four inner edges of the battlefield', () => {
    expect(edgePanVector(100, 300, view, margin, speed)).toEqual({ dx: -speed, dz: 0 });
    expect(edgePanVector(1040, 300, view, margin, speed)).toEqual({ dx: speed, dz: 0 });
    expect(edgePanVector(500, 5, view, margin, speed)).toEqual({ dx: 0, dz: -speed });
    expect(edgePanVector(500, 560, view, margin, speed)).toEqual({ dx: 0, dz: speed });
  });

  it('does not pan from the middle of the battlefield', () => {
    expect(edgePanVector(570, 280, view, margin, speed)).toEqual({ dx: 0, dz: 0 });
  });

  it('does not pan while the pointer is over a HUD panel', () => {
    // Rail on the left, sidebar on the right, console below: each used to sit
    // inside the old canvas-edge band and could never trigger.
    expect(edgePanVector(20, 300, view, margin, speed)).toEqual({ dx: 0, dz: 0 });
    expect(edgePanVector(1200, 300, view, margin, speed)).toEqual({ dx: 0, dz: 0 });
    expect(edgePanVector(500, 700, view, margin, speed)).toEqual({ dx: 0, dz: 0 });
  });
});

describe('production categories', () => {
  it('has one panel per force type and no overview', () => {
    expect(PRODUCTION_TABS.map((t) => t.id)).toEqual(['base', 'defence', 'land', 'air', 'sea']);
    expect(PRODUCTION_TABS.some((t) => /OVERVIEW|ALL/.test(t.label))).toBe(false);
  });

  it('reads the SEA tab as the naval domain so a shipyard appears there', () => {
    expect(productionDomain('sea')).toBe('naval');
    expect(productionDomain('land')).toBe('land');
    expect(productionDomain('air')).toBe('air');
    expect(productionDomain('base')).toBeNull();
    expect(productionDomain('defence')).toBeNull();
  });

  it('sites weapon structures under defence and everything else under base', () => {
    expect(structureTab(true)).toBe('defence');
    expect(structureTab(false)).toBe('base');
  });
});

describe('tactical minimap availability', () => {
  it('stays dead without a radar, during a brownout and only wakes when both are healthy', () => {
    expect(minimapStatus(false, false)).toEqual({ online: false, reason: 'no-radar' });
    expect(minimapStatus(true, true)).toEqual({ online: false, reason: 'brownout' });
    expect(minimapStatus(false, true)).toEqual({ online: false, reason: 'no-radar' });
    expect(minimapStatus(true, false)).toEqual({ online: true, reason: null });
  });
});

describe('tactical minimap backing store', () => {
  it('renders at device density instead of the 96x72 map raster', () => {
    expect(minimapBackingSize(300, 160, 1)).toEqual({ width: 300, height: 160 });
    expect(minimapBackingSize(300, 160, 2)).toEqual({ width: 600, height: 320 });
    expect(minimapBackingSize(301, 161, 1.5)).toEqual({ width: 452, height: 242 });
  });

  it('caps extreme density and never drops below CSS resolution', () => {
    expect(minimapBackingSize(300, 160, 3)).toEqual({ width: 600, height: 320 });
    expect(minimapBackingSize(300, 160, 0.9)).toEqual({ width: 300, height: 160 });
    expect(minimapBackingSize(300, 160, 0)).toEqual({ width: 300, height: 160 });
    expect(minimapBackingSize(300, 160, Number.NaN)).toEqual({ width: 300, height: 160 });
  });
});

describe('production card queue display', () => {
  const queue = [
    { defId: 'rifleman', remaining: 2, total: 5 },
    { defId: 'rifleman', remaining: 5, total: 5 },
    { defId: 'mbt', remaining: 8, total: 8 },
  ];

  it('counts every queued copy and drives progress only from the training head', () => {
    expect(productionCardState(queue, 'rifleman')).toEqual({
      queued: 2,
      active: true,
      progress: 0.6,
    });
    expect(productionCardState(queue, 'mbt')).toEqual({
      queued: 1,
      active: false,
      progress: 0,
    });
  });

  it('shows no badge or wipe for a unit type that is not queued', () => {
    expect(productionCardState(queue, 'medic')).toEqual({
      queued: 0,
      active: false,
      progress: 0,
    });
    expect(productionCardState([], 'rifleman')).toEqual({
      queued: 0,
      active: false,
      progress: 0,
    });
  });
});

describe('production card art states', () => {
  it('shows the model, greys it, or silhouettes it by unlock and cost', () => {
    // Buyable now: the full model.
    expect(cardArtState(true, true)).toBe('ready');
    // Unlocked but the player cannot pay: greyed, still recognisable.
    expect(cardArtState(true, false)).toBe('short');
    // Missing technology wins over cost: a locked card is a silhouette.
    expect(cardArtState(false, true)).toBe('locked');
    expect(cardArtState(false, false)).toBe('locked');
  });
});

describe('production card block reasons', () => {
  it('names affordability, capacity and tech blocks in one vocabulary', () => {
    expect(productionBlockReason('Insufficient materials.')).toEqual({ text: 'NO MATERIALS', tone: 'materials' });
    expect(productionBlockReason('Insufficient requisition.')).toEqual({ text: 'NO REQUISITION', tone: 'requisition' });
    expect(productionBlockReason('Production queue is full.')).toEqual({ text: 'QUEUE FULL', tone: 'queue' });
    expect(productionBlockReason('Requires an operational airfield.')).toEqual({ text: 'NEEDS AIRFIELD', tone: 'tech' });
    expect(productionBlockReason('An operational Vehicle Factory builds engineers.')).toEqual({ text: 'NEEDS VEHICLE FACTORY', tone: 'tech' });
    expect(productionBlockReason('Facility still under construction.')).toEqual({ text: 'UNDER CONSTRUCTION', tone: 'tech' });
    expect(productionBlockReason('Something unexpected.')).toEqual({ text: 'UNAVAILABLE', tone: 'other' });
  });

  it('names a full flight line as space, not as a missing facility', () => {
    // Exactly the sentence `productionStatus` returns once every position is
    // promised, airborne hulls included: the airfield stands, so a NEEDS
    // AIRFIELD label would send the player to build one they already own.
    expect(productionBlockReason('No free flight-line position (4/4).')).toEqual({
      text: 'NO FREE FLIGHT LINE',
      tone: 'space',
    });
    expect(productionBlockReason('No free helicopter position (2/2).')).toEqual({
      text: 'NO FREE HELO PAD',
      tone: 'space',
    });
    expect(productionBlockReason('Helicopters require an operational heliport.')).toEqual({
      text: 'NEEDS HELIPORT',
      tone: 'tech',
    });
  });
});

describe('production drag edge auto-scroll', () => {
  it('ramps up toward the leading edge and down toward the trailing edge', () => {
    expect(edgeAutoScrollVelocity(250, 100, 400, 40, 800)).toBe(0);
    expect(edgeAutoScrollVelocity(120, 100, 400, 40, 800)).toBeCloseTo(-400, 5);
    expect(edgeAutoScrollVelocity(100, 100, 400, 40, 800)).toBe(-800);
    expect(edgeAutoScrollVelocity(380, 100, 400, 40, 800)).toBeCloseTo(400, 5);
    expect(edgeAutoScrollVelocity(400, 100, 400, 40, 800)).toBe(800);
  });

  it('clamps beyond the panel and ignores degenerate geometry', () => {
    expect(edgeAutoScrollVelocity(20, 100, 400, 40, 800)).toBe(-800);
    expect(edgeAutoScrollVelocity(520, 100, 400, 40, 800)).toBe(800);
    expect(edgeAutoScrollVelocity(250, 100, 100, 40, 800)).toBe(0);
    expect(edgeAutoScrollVelocity(250, 100, 400, 0, 800)).toBe(0);
    expect(edgeAutoScrollVelocity(250, 100, 400, 40, 0)).toBe(0);
  });

  it('shrinks both bands in a panel shorter than two edge zones', () => {
    // 40px high, 80px requested band: each band is 20px and they meet in the middle.
    expect(edgeAutoScrollVelocity(100, 100, 140, 80, 900)).toBe(-900);
    expect(edgeAutoScrollVelocity(120, 100, 140, 80, 900)).toBe(0);
    expect(edgeAutoScrollVelocity(140, 100, 140, 80, 900)).toBe(900);
  });
});

describe('battle HUD panel state', () => {
  it('opens a different panel and closes the active one on a second tap', () => {
    expect(toggleHudPanel('none', 'production')).toBe('production');
    expect(toggleHudPanel('production', 'production')).toBe('none');
    expect(toggleHudPanel('production', 'objective')).toBe('objective');
  });

  it('keeps every transient panel mutually exclusive', () => {
    expect(toggleHudPanel('objective', 'groups')).toBe('groups');
    expect(toggleHudPanel('groups', 'map')).toBe('map');
    expect(toggleHudPanel('map', 'selection')).toBe('selection');
  });
});
