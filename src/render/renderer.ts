import { ELEVATION_HEIGHT, HARVESTER_CAPACITY, TICK_RATE, TILE_SIZE } from '../sim/constants';
import { Terrain, tileIndex } from '../sim/terrain';
import { effectivePixelRatio } from '../settings';
import { BUILDINGS } from '../data/buildings';
import { UNITS } from '../data/units';
import { NATION_LIST } from '../data/factions';
import { footprintCenter } from '../sim/map';
import type { Scenario } from '../sim/scenario';
import type { Entity } from '../sim/types';
import type { Game } from '../sim/game';
import { Camera } from './camera';
import {
  StaticMesh,
  FlagMesh,
  InstancedMesh,
  bindTextureUnit,
  MESH_FLAG_TEXTURE_UNIT,
  MESH_FOG_OLD_TEXTURE_UNIT,
  MESH_FOG_TEXTURE_UNIT,
  MESH_MATERIAL_TEXTURE_UNIT,
  PROP_MATERIAL_TEXTURE_UNIT,
  createProgram,
  type PropInstance,
  type MeshBuffers,
} from './gl';
import {
  MESH_FS,
  MESH_VS,
  PROP_FS,
  PROP_VS,
  TERRAIN_FS,
  TERRAIN_VS,
  WATER_FS,
  WATER_VS,
} from './shaders';
import { buildingStyle, buildingTopHeight, FALLBACK_BUILDING } from './buildingMeshes';
import {
  buildFlagRig,
  flagColorForOwner,
  flagMountFor,
  flagNationForFaction,
  flagOwnerForBuilding,
  flagTextureUrl,
  flagWindYaw,
  type FlagNation,
} from './flags';
import {
  AIR_UNIT_ALTITUDE,
  unitStyle,
  unitVisualScale,
  unitShadowRadius,
  unitGroundMarker,
  FALLBACK_STYLE,
  type EntityStyle,
} from './unitMeshes';
import {
  buildBushMesh,
  buildFenceMesh,
  buildGrassTuftMesh,
  buildLampMesh,
  buildOreMesh,
  buildReedMesh,
  buildRockMesh,
  buildRubbleMesh,
  buildShrubMesh,
  buildSignPostMesh,
  buildTreeMesh,
  buildUtilityPoleMesh,
} from './geometry';
import { materialLut } from './materials';
import {
  buildPropInstances,
  buildRoadDetails,
  buildShoreTexture,
  buildTerrainGeometry,
  isWaterAt,
  tileWorldHeight,
  type TerrainGeometry,
} from './terrainMesh';
import { ParticleSystem } from './particles';
import { ParticleGpu, type GpuParticle } from './particleGpu';
import { LightGpu, type GpuLight } from './lightGpu';
import { buildLightView, oreGlowLights, structureWindowGlow, windowGlow } from './lightView';
import { dayNightAt, type DayNightState } from '../sim/dayNight';
import { weatherFor, type WeatherProfile } from '../sim/weather';
import { DecalGpu } from './decalGpu';
import { DecalStore, decalAlpha, type GroundDecal } from './decalStore';
import { ShadowGpu, type GpuShadow } from './shadowGpu';
import type { Vec3 } from './math';
import { teamColorForOwner } from './teamColor';
import { limbModelMatrix, turretModelMatrix, unitBodyHeading } from './unitTransform';
import { rotateLocalOffset } from '../core/math';
import {
  eventVisibleToLocal,
  pointVisibleToLocal,
  projectileVisibleToLocal,
  sampleProjectile,
  staticMuzzleAnchor,
  weaponFxProfile,
  WreckStore,
  type ProjectileSample,
} from './combatFx';

const NEAR = 1;
const FAR = 3000;

/** Seconds between fog-mask uploads: the mask is rebuilt every third tick. */
const FOG_UPDATE_SECONDS = 3 / TICK_RATE;
/**
 * The occluded-unit silhouette is pulled this many world units toward the eye
 * in view depth. Anything closer to the camera than that occludes it, anything
 * further away — a ridge several tiles in front of the unit — does not.
 */
const SILHOUETTE_DEPTH_PULL = 8;
const SILHOUETTE_ALPHA = 0.5;

interface VisualEntity {
  x: number;
  z: number;
  facing: number;
  turret: number;
  /**
   * Heading of the last real displacement. Vehicles are drawn on this while
   * moving so a collision nudge or a wall-slip correction turns the hull onto
   * the direction it is actually travelling instead of sliding it sideways.
   */
  motion: number;
  /** Last simulated position, used to measure that displacement. */
  lastX: number;
  lastZ: number;
  trailTimer: number;
  damageTimer: number;
  /** Infantry walk cycle phase in radians and 0..1 blend. */
  gait: number;
  pace: number;
  /** 0 stowed .. 1 deployed, visual-only launcher elevation. */
  elevation: number;
  /** 0 closed .. 1 fully raised, for a production building's shutter. */
  door: number;
  /** Seconds the shutter stays up after the last unit rolled out. */
  doorHold: number;
  /** Production queue length seen last tick, to detect a finished unit. */
  doorQueue: number;
  /**
   * Seconds left of a unit's drive out of its factory bay. Set when a unit
   * first appears beside a producer, so it is drawn at the doorway and eases
   * out to the apron instead of popping into the open.
   */
  emerge: number;
  /** 0..1 share of the cruise altitude reached, so a fighter climbs out of its hangar. */
  emergeAlt: number;
  /** Seconds until the next track decal is stamped. */
  trackTimer: number;
}

interface MeshProgram {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

export interface RenderSettings {
  effects: boolean;
  shake: boolean;
  showFog: boolean;
  /** Construction guidance lines; enabled only by placement mode. */
  grid: boolean;
  /** Fraction of the device pixel ratio used for the battlefield canvas. */
  renderScale: number;
  /** Flat projected ground shadows for units, structures and props. */
  shadows: boolean;
  /** Team-coloured outlines where a unit is hidden behind a structure. */
  silhouettes: boolean;
  /** Animated water normals; off keeps the sea but freezes the ripple. */
  waterDetail: boolean;
  /** Building and vehicle lights after dark. Presentation only. */
  nightLights: boolean;
  /** Multiplier for additive light intensity; never changes detection. */
  lightBloom: number;
}

interface TerrainGpu {
  vao: WebGLVertexArrayObject;
  count: number;
}

function uniformMap(gl: WebGL2RenderingContext, program: WebGLProgram, names: string[]): Record<string, WebGLUniformLocation | null> {
  const out: Record<string, WebGLUniformLocation | null> = {};
  for (const n of names) out[n] = gl.getUniformLocation(program, n);
  return out;
}

function makeTerrainGpu(gl: WebGL2RenderingContext, data: TerrainGeometry): TerrainGpu {
  const vao = gl.createVertexArray()!;
  gl.bindVertexArray(vao);
  const interleaved = new Float32Array((data.positions.length / 3) * 15);
  for (let i = 0, v = 0; i < data.positions.length; i += 3, v += 15) {
    interleaved[v] = data.positions[i];
    interleaved[v + 1] = data.positions[i + 1];
    interleaved[v + 2] = data.positions[i + 2];
    interleaved[v + 3] = data.normals[i];
    interleaved[v + 4] = data.normals[i + 1];
    interleaved[v + 5] = data.normals[i + 2];
    interleaved[v + 6] = data.colors[i];
    interleaved[v + 7] = data.colors[i + 1];
    interleaved[v + 8] = data.colors[i + 2];
    interleaved[v + 9] = data.uvs[(i / 3) * 2];
    interleaved[v + 10] = data.uvs[(i / 3) * 2 + 1];
    interleaved[v + 11] = data.grounds[(i / 3) * 4];
    interleaved[v + 12] = data.grounds[(i / 3) * 4 + 1];
    interleaved[v + 13] = data.grounds[(i / 3) * 4 + 2];
    interleaved[v + 14] = data.grounds[(i / 3) * 4 + 3];
  }
  const vbo = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, interleaved, gl.STATIC_DRAW);
  const stride = 15 * 4;
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 3 * 4);
  gl.enableVertexAttribArray(2);
  gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 6 * 4);
  gl.enableVertexAttribArray(3);
  gl.vertexAttribPointer(3, 2, gl.FLOAT, false, stride, 9 * 4);
  gl.enableVertexAttribArray(4);
  gl.vertexAttribPointer(4, 4, gl.FLOAT, false, stride, 11 * 4);
  const ibo = gl.createBuffer()!;
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
  gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
  gl.bindVertexArray(null);
  return { vao, count: data.indices.length };
}

export class Renderer {
  readonly gl: WebGL2RenderingContext;
  readonly camera = new Camera();
  readonly particles = new ParticleSystem();
  settings: RenderSettings = {
    effects: true,
    shake: true,
    showFog: true,
    grid: false,
    renderScale: 1,
    shadows: true,
    silhouettes: true,
    waterDetail: true,
    nightLights: true,
    lightBloom: 1,
  };

  private canvas: HTMLCanvasElement;
  private scenario: Scenario | null = null;
  private game: Game | null = null;
  private meshProgram!: MeshProgram;
  private terrainProgram!: MeshProgram;
  private waterProgram!: MeshProgram;
  private propProgram!: MeshProgram;
  private particleGpu!: ParticleGpu;
  private decalGpu!: DecalGpu;
  private shadowGpu!: ShadowGpu;
  /** Fading tracks, tyre marks, scorch and craters; presentation-only and bounded. */
  private readonly decals = new DecalStore();
  private decalScratch: GroundDecal[] = [];
  private propShadows: GpuShadow[] = [];
  private shadowScratch: GpuShadow[] = [];
  private terrainGpu: TerrainGpu | null = null;
  private waterVao: WebGLVertexArrayObject | null = null;
  /** Index count of the sea grid; the count lives with the buffer. */
  private waterCount = 0;
  private roadMesh: StaticMesh | null = null;
  private treesMesh!: InstancedMesh;
  private rocksMesh!: InstancedMesh;
  private oreMesh!: InstancedMesh;
  private bushesMesh!: InstancedMesh;
  private shrubsMesh!: InstancedMesh;
  private tuftsMesh!: InstancedMesh;
  private fencesMesh!: InstancedMesh;
  private lampsMesh!: InstancedMesh;
  private signsMesh!: InstancedMesh;
  private rubbleMesh!: InstancedMesh;
  private reedsMesh!: InstancedMesh;
  private polesMesh!: InstancedMesh;
  private treeInstances: PropInstance[] = [];
  private rockInstances: PropInstance[] = [];
  private oreInstances: PropInstance[] = [];
  private bushInstances: PropInstance[] = [];
  private shrubInstances: PropInstance[] = [];
  private tuftInstances: PropInstance[] = [];
  private fenceInstances: PropInstance[] = [];
  private lampInstances: PropInstance[] = [];
  private signInstances: PropInstance[] = [];
  private rubbleInstances: PropInstance[] = [];
  private reedInstances: PropInstance[] = [];
  private poleInstances: PropInstance[] = [];
  private fogTexture!: WebGLTexture;
  /** Previous fog mask, cross-faded with the current one over one interval. */
  private fogTextureOld!: WebGLTexture;
  private fogBytesPrev: Uint8Array | null = null;
  private fogBlend = 1;
  private shoreTexture!: WebGLTexture;
  private shoreData: Uint8Array | null = null;
  private fogData: Uint8Array | null = null;
  private lastFogTick = -999;
  private lastOreRefresh = 0;
  private buildingMeshes = new Map<
    string,
    {
      body: StaticMesh;
      garrisoned: StaticMesh | null;
      /** Spent span, drawn in place of the body for a bridge at zero hit points. */
      ruined: StaticMesh | null;
      turret: StaticMesh | null;
      turretOffset: Vec3;
      door: StaticMesh | null;
      doorOffset: Vec3;
      doorRetract: number;
      rotor: StaticMesh | null;
      rotorOffset: Vec3;
      rotorRate: number;
      /** Local roof corner where the pole and its two flags stand. */
      flagMount: Vec3;
    }
  >();
  private flagMeshes = new Map<string, FlagMesh>();
  private flagTextures = new Map<string, WebGLTexture>();
  private whiteTexture!: WebGLTexture;
  private materialTexture!: WebGLTexture;
  private unitMeshes = new Map<string, {
    body: StaticMesh;
    turret: StaticMesh | null;
    leg: StaticMesh | null;
    load: StaticMesh | null;
    periscope: StaticMesh | null;
    periscopeOffset?: Vec3;
    launcherPivot?: Vec3;
    launcherElevation?: number;
  }>();
  private visuals = new Map<number, VisualEntity>();
  /**
   * Hulls that just earned a rank, keyed by entity id and stamped with the
   * render clock. Presentation only: nothing here reaches the simulation, a
   * save or a snapshot, so two clients with different frame rates still fight
   * the same battle.
   */
  private promotionFlashes = new Map<number, number>();
  /** Presentation-only hulks; never entities, picks, saves or collision. */
  private readonly wrecks = new WreckStore();
  private trailTimers = new Map<number, number>();
  private projectileTrailTimers = new Map<number, number>();
  /** Per-cloud emission clocks, so a screen puffs at a fixed rate, not per frame. */
  private smokeEmitTimers = new Map<number, number>();
  private projectileViews = new Map<number, { previous: ProjectileSample; current: ProjectileSample }>();
  private simulationAlpha = 1;
  private lastEventSeq = 0;
  private time = 0;
  private shake = 0;
  private sun: Vec3 = [-0.55, 0.75, 0.35];
  private ambient = 0.4;
  /** Global time-of-day grade, uploaded as uTone to every lit program. */
  private tone: Vec3 = [1, 1, 1];
  /**
   * Colour and thickness of the air itself. Haze is the "how far away is it"
   * half of visibility, and it is what makes a fog map read as a volume rather
   * than a dimmer map.
   */
  private hazeColor: Vec3 = [0.5, 0.54, 0.56];
  private hazeDensity = 0;
  /** Grade-only values, before the lightning pass lifts them for the frame. */
  private baseHazeColor: Vec3 = [0.5, 0.54, 0.56];
  private baseHaze = 0;
  private lightGpu!: LightGpu;
  /**
   * Lights split by what they must not be painted over. Ground pools go down
   * before the models so a hull occludes the pool it stands in; wall lamps,
   * lit windows and lens glows go down after, or the building they are bolted to
   * simply covers them.
   */
  private lightPools: GpuLight[] = [];
  private lightGlows: GpuLight[] = [];
  /** Authoritative clock as of the last frame; the sim owns it, we only read. */
  private dayNight: DayNightState = dayNightAt(0, { startHour: 18, dayLengthMinutes: 60 });
  /** Cached preview clock, keyed on the authored hour so edits invalidate it. */
  private previewClock: { key: string; state: DayNightState } | null = null;
  /** Weather as of the last frame, resolved from the scenario. */
  private weather: WeatherProfile = weatherFor('clear');
  /** Fractional precipitation budget, so the drop count is frame-rate free. */
  private weatherBudget = 0;
  /** Fractional mist budget, so the bank count is frame-rate free too. */
  private mistBudget = 0;
  /**
   * The graded scene without lightning. `ambient`/`tone`/`clearColor` are these
   * plus the current flash, recomputed every frame so a strike can light the
   * battlefield for a few frames without rebuilding the whole grade.
   */
  private baseAmbient = 0.4;
  private baseTone: Vec3 = [1, 1, 1];
  private baseClear: [number, number, number] = [0.027, 0.043, 0.055];
  /** 0..1 lightning brightness for this frame. */
  private flash = 0;
  private flashAt = -999;
  private flashEnergy = 0;
  private nextStrikeAt = 0;
  /**
   * Sheet lightning: the cloud is lit from behind rather than struck. It is a
   * separate channel from `flash` because it must not read as a bolt over the
   * battlefield — it is slower, softer, lifts the sky far more than the ground,
   * and never shakes the camera.
   */
  private sheet = 0;
  private sheetAt = -999;
  private sheetEnergy = 0;
  private nextSheetAt = 0;
  private lightingKey = '';
  private clearColor: [number, number, number] = [0.027, 0.043, 0.055];
  dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) {
      throw new Error('WebGL2 is required to render Modern Combined Arms. Please enable hardware acceleration or use a current browser.');
    }
    this.gl = gl;
    this.initGpuResources();

    // Browsers drop a GPU context when a mobile PWA is backgrounded or a
    // driver resets. Preventing the default on loss is what allows the restore
    // event to fire; without it the canvas stays black for the rest of the
    // session. The rebuild is presentation-only and never touches the game.
    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      this.contextLost = true;
      this.onContextLost?.();
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this.contextLost = false;
      try {
        this.restoreContext();
        this.onContextRestored?.();
      } catch (error) {
        console.error('MCA renderer: WebGL context restore failed', error);
        this.contextLost = true;
        this.onContextLost?.();
      }
    });
    const nav = navigator as Navigator & { maxTouchPoints?: number };
    this.isTouch = (nav.maxTouchPoints ?? 0) > 0;
  }

  isTouch = false;
  /** True between webglcontextlost and a successful restore. */
  contextLost = false;
  /** App hook used to pause the battle and tell the player what happened. */
  onContextLost?: () => void;
  onContextRestored?: () => void;

  /**
   * Create or recreate every GPU-side resource. Kept apart from construction
   * so a restored context can rebuild programs, meshes and textures in place;
   * the CPU-side simulation, scenario and camera are owned by the caller.
   */
  private initGpuResources(): void {
    const gl = this.gl;
    this.unitMeshes.clear();
    this.buildingMeshes.clear();
    this.flagMeshes.clear();
    this.flagTextures.clear();
    this.meshProgram = { program: createProgram(gl, MESH_VS, MESH_FS), u: {} };
    this.terrainProgram = { program: createProgram(gl, TERRAIN_VS, TERRAIN_FS), u: {} };
    this.waterProgram = { program: createProgram(gl, WATER_VS, WATER_FS), u: {} };
    this.propProgram = { program: createProgram(gl, PROP_VS, PROP_FS), u: {} };
    this.meshProgram.u = uniformMap(gl, this.meshProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uModel', 'uTeamColor', 'uSun', 'uTint', 'uAmbient', 'uTone', 'uAlpha', 'uFlash', 'uNightGlow',
      'uFogTex', 'uFogTexOld', 'uFogBlend', 'uFlagTex', 'uMatLut', 'uUseFog',
      'uWorldSize', 'uTime', 'uSilhouette', 'uDepthPull', 'uHaze', 'uHazeColor', 'uHazeRef',
    ]);
    this.terrainProgram.u = uniformMap(gl, this.terrainProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uTone', 'uFogTex', 'uFogTexOld', 'uFogBlend', 'uShoreTex',
      'uUseFog', 'uTime', 'uGrid', 'uWet', 'uHaze', 'uHazeColor', 'uHazeRef',
    ]);
    this.waterProgram.u = uniformMap(gl, this.waterProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uTone', 'uFogTex', 'uFogTexOld', 'uFogBlend', 'uShoreTex',
      'uUseFog', 'uTime', 'uWorldSize', 'uSea', 'uHaze', 'uHazeColor', 'uHazeRef',
    ]);
    this.propProgram.u = uniformMap(gl, this.propProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uTone', 'uEmissive', 'uGlow', 'uFogTex', 'uFogTexOld', 'uFogBlend',
      'uMatLut', 'uUseFog', 'uWorldSize', 'uWind', 'uTime', 'uHaze', 'uHazeColor', 'uHazeRef',
    ]);
    this.particleGpu = new ParticleGpu(gl);
    this.lightGpu = new LightGpu(gl);
    this.decalGpu = new DecalGpu(gl);
    this.shadowGpu = new ShadowGpu(gl);

    this.treesMesh = new InstancedMesh(gl, buildTreeMesh());
    this.rocksMesh = new InstancedMesh(gl, buildRockMesh());
    this.oreMesh = new InstancedMesh(gl, buildOreMesh());
    this.bushesMesh = new InstancedMesh(gl, buildBushMesh());
    this.shrubsMesh = new InstancedMesh(gl, buildShrubMesh());
    this.tuftsMesh = new InstancedMesh(gl, buildGrassTuftMesh());
    this.fencesMesh = new InstancedMesh(gl, buildFenceMesh());
    this.lampsMesh = new InstancedMesh(gl, buildLampMesh());
    this.signsMesh = new InstancedMesh(gl, buildSignPostMesh());
    this.rubbleMesh = new InstancedMesh(gl, buildRubbleMesh());
    this.reedsMesh = new InstancedMesh(gl, buildReedMesh());
    this.polesMesh = new InstancedMesh(gl, buildUtilityPoleMesh());
    this.fogTexture = this.createTexture();
    this.fogTextureOld = this.createTexture();
    this.shoreTexture = this.createTexture();

    for (const id of Object.keys(UNITS)) {
      const style = unitStyle(id);
      if (style) {
        this.unitMeshes.set(id, {
          body: new StaticMesh(gl, style.body),
          turret: style.turret ? new StaticMesh(gl, style.turret) : null,
          leg: style.infantry ? new StaticMesh(gl, style.infantry.leg) : null,
          load: style.load ? new StaticMesh(gl, style.load) : null,
          periscope: style.periscope ? new StaticMesh(gl, style.periscope) : null,
          periscopeOffset: style.periscopeOffset,
          launcherPivot: style.launcherPivot,
          launcherElevation: style.launcherElevation,
        });
      }
    }
    for (const id of Object.keys(BUILDINGS)) {
      const style = buildingStyle(id);
      const body = style?.body ?? FALLBACK_BUILDING;
      this.buildingMeshes.set(id, {
        body: new StaticMesh(gl, body),
        garrisoned: style?.garrisoned ? new StaticMesh(gl, style.garrisoned) : null,
        ruined: style?.ruined ? new StaticMesh(gl, style.ruined) : null,
        turret: style?.turret ? new StaticMesh(gl, style.turret) : null,
        turretOffset: style?.turretOffset ?? [0, 0, 0],
        door: style?.door ? new StaticMesh(gl, style.door.mesh) : null,
        doorOffset: style?.door?.offset ?? [0, 0, 0],
        doorRetract: style?.door?.retract ?? 0,
        rotor: style?.rotor ? new StaticMesh(gl, style.rotor.mesh) : null,
        rotorOffset: style?.rotor?.offset ?? [0, 0, 0],
        rotorRate: style?.rotor?.rate ?? 0,
        flagMount: (() => {
          const mount = flagMountFor(BUILDINGS[id]?.footprint ?? { w: 2, h: 2 }, body, id);
          return [mount.x, mount.y, mount.z] as Vec3;
        })(),
      });
    }
    for (const nation of NATION_LIST) {
      const flagNation = flagNationForFaction(nation.id);
      if (!flagNation) continue;
      this.flagMeshes.set(flagNation, new FlagMesh(gl, buildFlagRig(flagNation)));
      this.loadFlagTexture(flagNation);
    }
    this.whiteTexture = this.createWhiteTexture();
    this.materialTexture = this.createMaterialTexture();

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(...this.clearColor, 1);
  }

  /**
   * Rebuild map-derived GPU resources after the presentation map changed.
   *
   * A networked client paints the room's authoritative terrain, which arrives
   * with the first sync — after the battle screen is already standing. Every
   * map-derived resource is rebuilt from the adopted scenario, while the camera
   * and the event cursor are preserved so the view and the effect stream do not
   * jump.
   */
  rebuildTerrain(): void {
    const scenario = this.scenario;
    if (!scenario) return;
    const cameraX = this.camera.cx;
    const cameraZ = this.camera.cz;
    const zoom = this.camera.zoom;
    const game = this.game;
    const eventSeq = this.lastEventSeq;
    this.setScenario(scenario);
    // setScenario clears the scene and the game link; the battle itself has not
    // changed, only the ground under it.
    this.game = game;
    this.camera.cx = cameraX;
    this.camera.cz = cameraZ;
    this.camera.setZoom(zoom);
    this.lastEventSeq = eventSeq;
  }

  /** Rebuild GPU resources and the current scene after a context restore. */
  private restoreContext(): void {
    const cameraX = this.camera.cx;
    const cameraZ = this.camera.cz;
    const zoom = this.camera.zoom;
    const scenario = this.scenario;
    const game = this.game;
    this.initGpuResources();
    if (scenario) {
      this.setScenario(scenario);
      if (game) this.setGame(game);
      // Restore the stored centre directly: centerOn() re-applies the HUD
      // screen lift and would nudge the view on every context rebuild.
      this.camera.cx = cameraX;
      this.camera.cz = cameraZ;
      this.camera.setZoom(zoom);
    }
    this.resize();
  }

  private createTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /** White fallback keeps the flag sampler valid for ordinary mesh draws. */
  private createWhiteTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      new Uint8Array([255, 255, 255, 255]),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /**
   * A 8x1 property LUT. Nearest filtering is intentional: material ids are
   * categorical, and interpolation would invent blends no builder authored.
   */
  private createMaterialTexture(): WebGLTexture {
    const gl = this.gl;
    const tex = this.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      8,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      materialLut(),
    );
    gl.bindTexture(gl.TEXTURE_2D, null);
    return tex;
  }

  /**
   * Real national flag imagery is rasterised from `public/flags` into a texture
   * once, at renderer construction. The flag rig draws the alliance cloth as a
   * solid colour and samples this texture only for the national cloth.
   */
  private loadFlagTexture(nation: FlagNation): void {
    const gl = this.gl;
    const texture = this.createTexture();
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = Math.max(1, Math.round((256 * image.height) / image.width));
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        gl.deleteTexture(texture);
        return;
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.bindTexture(gl.TEXTURE_2D, null);
      this.flagTextures.set(nation, texture);
    };
    image.onerror = () => gl.deleteTexture(texture);
    image.src = flagTextureUrl(nation);
  }

  resize(): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));
    // The graphics preset is applied as a fraction of the physical density and
    // still respects the historical 2x cap, so low-end devices draw fewer
    // fragments without changing the CSS layout or the camera projection.
    const dpr = effectivePixelRatio(window.devicePixelRatio || 1, this.settings.renderScale);
    this.dpr = dpr;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.camera.setViewport(w, h);
  }

  /**
   * A brief warm pulse on one hull after its crew earns a rank. The clock is
   * the renderer's own, so the flash fades in real time even while the battle
   * is paused or the tick rate changes.
   */
  flashPromotion(entityId: number): void {
    this.promotionFlashes.set(entityId, this.time);
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.game = null;
    this.visuals.clear();
    this.promotionFlashes.clear();
    this.wrecks.clear();
    this.decals.clear();
    this.projectileViews.clear();
    this.particles.clear();
    this.lastEventSeq = 0;
    this.camera.setMap(scenario.width, scenario.height);
    this.camera.centerOn((scenario.width * TILE_SIZE) / 2, (scenario.height * TILE_SIZE) / 2);
    this.camera.setZoom(Math.max(58, scenario.width * 0.62));
    this.applyLighting();
    const geometry = buildTerrainGeometry(scenario);
    this.terrainGpu = makeTerrainGpu(this.gl, geometry);
    this.buildWater(scenario);
    this.roadMesh = new StaticMesh(this.gl, buildRoadDetails(scenario));
    const props = buildPropInstances(scenario);
    this.treeInstances = props.trees;
    this.rockInstances = props.rocks;
    this.oreInstances = props.ore;
    this.bushInstances = props.bushes;
    this.shrubInstances = props.shrubs;
    this.tuftInstances = props.tufts;
    this.fenceInstances = props.fences;
    this.lampInstances = props.lamps;
    this.signInstances = props.signs;
    this.rubbleInstances = props.rubble;
    this.reedInstances = props.reeds;
    this.poleInstances = props.poles;
    this.treesMesh.setInstances(this.treeInstances);
    this.rocksMesh.setInstances(this.rockInstances);
    this.oreMesh.setInstances(this.oreInstances);
    this.bushesMesh.setInstances(this.bushInstances);
    this.shrubsMesh.setInstances(this.shrubInstances);
    this.tuftsMesh.setInstances(this.tuftInstances);
    this.fencesMesh.setInstances(this.fenceInstances);
    this.lampsMesh.setInstances(this.lampInstances);
    this.signsMesh.setInstances(this.signInstances);
    this.rubbleMesh.setInstances(this.rubbleInstances);
    this.reedsMesh.setInstances(this.reedInstances);
    this.polesMesh.setInstances(this.poleInstances);
    this.rebuildPropShadows();
    this.shoreData = buildShoreTexture(scenario);
    // The coast field packs land and water distance into separate channels; the
    // old single-channel upload would silently discard the transition band.
    this.uploadTexture(this.shoreTexture, scenario.width, scenario.height, this.shoreData, true);
    this.fogData = new Uint8Array(scenario.width * scenario.height).fill(255);
    this.fogBytesPrev = null;
    this.uploadFogField(this.fogData);
    this.lastFogTick = -999;
    this.lastOreRefresh = 0;
    this.gl.clearColor(...this.clearColor, 1);
  }

  setGame(game: Game | null): void {
    if (this.scenario !== game?.state.scenario) {
      if (game) this.setScenario(game.state.scenario);
    }
    this.game = game;
    this.visuals.clear();
    this.promotionFlashes.clear();
    this.wrecks.clear();
    this.decals.clear();
    this.trailTimers.clear();
    this.projectileTrailTimers.clear();
    this.smokeEmitTimers.clear();
    this.projectileViews.clear();
    this.particles.clear();
    if (game) {
      this.dayNight = game.dayNight;
      this.applyLighting();
      this.lastEventSeq = game.state.eventSeq;
      this.lastFogTick = -999;
      const local = game.player(game.localPlayerId);
      if (local) {
        const hq = game.state.entities.find(
          (e) => e.owner === local.id && e.defId === 'commandPost',
        );
        const start = game.state.scenario.players.find((p) => p.id === local.id);
        const x = hq?.x ?? (start ? (start.startX + 0.5) * TILE_SIZE : 0);
        const z = hq?.z ?? (start ? (start.startZ + 0.5) * TILE_SIZE : 0);
        this.camera.centerOn(x, z);
        this.camera.setBattleZoom();
      }
    }
    this.applyLighting();
  }

  /**
   * Continuous time-of-day lighting.
   *
   * The clock is the simulation's, not the renderer's: this only reads it and
   * turns the hour into a sun direction, an ambient floor, a colour grade and a
   * sky colour. Dawn and dusk are warm and low, midnight is dim and blue, and
   * the battlefield never reaches black.
   */
  private applyLighting(): void {
    const dn = this.dayNight;
    const light = dn.light;
    const hour = dn.hour;
    // Warmth peaks around sunrise and sunset, when the sun is low and red.
    const lowSun =
      Math.exp(-((hour - 18.2) ** 2) / 4) + Math.exp(-((hour - 5.8) ** 2) / 4);
    const warm = Math.min(1, lowSun);
    const azimuth = (hour / 24) * Math.PI * 2 - Math.PI / 2;
    const elevation = 0.3 + 0.62 * light;
    const len = Math.hypot(Math.cos(azimuth) * 0.85, elevation, Math.sin(azimuth) * 0.85);
    this.sun = [
      (Math.cos(azimuth) * 0.85) / len,
      elevation / len,
      (Math.sin(azimuth) * 0.85) / len,
    ];
    // A night floor that keeps terrain and units readable, warmed at the edges
    // of the day and cooled under moonlight. These are the *base* values: the
    // lightning pass layers its flash on top of them every frame.
    this.baseAmbient = 0.24 + 0.26 * light;
    this.baseTone = [
      (0.58 + 0.42 * light) * (1 + 0.13 * warm),
      (0.67 + 0.33 * light) * (1 + 0.02 * warm),
      (0.95 + 0.05 * light) * (1 - 0.1 * warm),
    ];
    this.baseClear = [
      0.006 + 0.03 * light,
      0.012 + 0.04 * light,
      0.03 + 0.03 * light,
    ];
    // Weather is the second half of the sky. Gloom lifts the ambient floor and
    // pulls the grade toward neutral, which is what actually makes an overcast
    // afternoon look flat: the shadows stop reading as hard-edged. Dim is the
    // other half — a storm is genuinely darker, not merely flatter, which is
    // also what makes the rain and the lightning read against it. Snow is cold
    // and reflective rather than dark, so it brightens the blue back in.
    const profile = weatherFor(this.scenario?.settings.weather);
    this.weather = profile;
    const gloom = profile.gloom;
    if (gloom > 0) {
      this.baseAmbient += (0.035 + 0.05 * light) * gloom;
      this.baseTone = [
        this.baseTone[0] * (1 - 0.16 * gloom),
        this.baseTone[1] * (1 - 0.12 * gloom),
        this.baseTone[2] * (1 - 0.04 * gloom),
      ];
      const skyMix = gloom * (0.35 + 0.65 * light);
      this.baseClear = [
        this.baseClear[0] * (1 - skyMix) + 0.075 * skyMix,
        this.baseClear[1] * (1 - skyMix) + 0.082 * skyMix,
        this.baseClear[2] * (1 - skyMix) + 0.09 * skyMix,
      ];
    }
    if (profile.dim > 0) {
      const dim = profile.dim;
      // Partial, never total: the darkest storm still has to be readable ground.
      this.baseAmbient *= 1 - 0.55 * dim;
      this.baseTone = [
        this.baseTone[0] * (1 - 0.3 * dim),
        this.baseTone[1] * (1 - 0.28 * dim),
        this.baseTone[2] * (1 - 0.2 * dim),
      ];
      this.baseClear = [
        this.baseClear[0] * (1 - 0.5 * dim),
        this.baseClear[1] * (1 - 0.48 * dim),
        this.baseClear[2] * (1 - 0.42 * dim),
      ];
    }
    if (profile.kind === 'snow' || profile.kind === 'blizzard') {
      // Snow is a reflector, not a darkness: the fallen cover bounces light back
      // up, so a whiteout stays bright even while the sun is gone.
      const lift = profile.kind === 'blizzard' ? 1.16 : 1.09;
      this.baseTone = [
        this.baseTone[0] * (1 + (lift - 1) * 0.4),
        this.baseTone[1] * (1 + (lift - 1) * 0.6),
        this.baseTone[2] * lift,
      ];
    }
    if (profile.kind === 'fog') {
      // Mist is milky, not grey: the air itself glows, so the far field washes
      // out toward a pale, slightly warm haze instead of just getting darker.
      const haze = 0.85;
      this.baseClear = [
        this.baseClear[0] * (1 - haze) + 0.30 * haze,
        this.baseClear[1] * (1 - haze) + 0.31 * haze,
        this.baseClear[2] * (1 - haze) + 0.32 * haze,
      ];
      this.baseAmbient += 0.05 * light;
    }
    // The air itself. Haze is the "how far away is it" half of visibility: a
    // fog map fades out with distance instead of merely being dim, which is
    // what makes it read as a volume the units are inside.
    // The air's own colour. Fog and a whiteout are pale by definition; every
    // other sky gets a cool grey wash rather than white, so rain reads as
    // distance instead of as a screen of milk.
    const airy: Vec3 =
      profile.kind === 'blizzard'
        ? [0.72, 0.76, 0.8]
        : profile.kind === 'fog'
          ? [0.62, 0.66, 0.68]
          : profile.kind === 'snow'
            ? [0.6, 0.65, 0.7]
            : profile.kind === 'storm'
              ? [0.44, 0.5, 0.55]
              : [0.5, 0.56, 0.61];
    // Night thickens it the way shadow does: the same mist at midnight is a
    // dark grey, not a bright one, or the battlefield would glow after dark.
    const daylight = 0.12 + 0.92 * light;
    this.baseHazeColor = [
      airy[0] * daylight * (1 + 0.2 * warm),
      airy[1] * daylight * (1 + 0.05 * warm),
      airy[2] * daylight,
    ];
    this.baseHaze = profile.haze;
    this.applyFlash();
    this.gl.clearColor(...this.clearColor, 1);
  }

  /**
   * Layer the storm's lightning over the graded scene.
   *
   * Flashes are presentation only: they never touch the simulation and never
   * reveal anything the fog hides, because they change colour and ambient light
   * rather than a fog field. A strike is a sharp attack with a two-step decay,
   * which is what makes it read as lightning rather than as a brightness bug.
   */
  private applyFlash(): void {
    const f = this.flash;
    const s = this.sheet;
    if (f <= 0.002 && s <= 0.002) {
      this.ambient = this.baseAmbient;
      this.tone = this.baseTone;
      this.clearColor = this.baseClear;
      this.hazeColor = this.baseHazeColor;
      this.hazeDensity = this.baseHaze;
      return;
    }
    // Lightning lights the air as well as the ground: a bolt in a wet or foggy
    // battlefield turns the whole volume pale for a frame, which is the single
    // clearest volumetric cue the renderer has.
    const airLift = 1 + f * 0.75 + s * 0.45;
    this.hazeColor = [
      Math.min(1, this.baseHazeColor[0] * airLift),
      Math.min(1, this.baseHazeColor[1] * airLift),
      Math.min(1, this.baseHazeColor[2] * airLift),
    ];
    this.hazeDensity = this.baseHaze * (1 + s * 0.55);
    this.ambient = Math.min(1.6, this.baseAmbient + f * 1.15 + s * 0.2);
    this.tone = [
      Math.min(2.6, this.baseTone[0] * (1 + f * 0.55 + s * 0.16)),
      Math.min(2.6, this.baseTone[1] * (1 + f * 0.5 + s * 0.16)),
      Math.min(2.6, this.baseTone[2] * (1 + f * 0.4 + s * 0.18)),
    ];
    // Sheet lightning is the sky, not the ground: the clear colour climbs far
    // more than the ambient does, which is what puts the glow behind the cloud
    // cover instead of on the battlefield.
    this.clearColor = [
      Math.min(1, this.baseClear[0] + f * 0.32 + s * 0.85),
      Math.min(1, this.baseClear[1] + f * 0.34 + s * 0.88),
      Math.min(1, this.baseClear[2] + f * 0.36 + s * 0.92),
    ];
  }

  /**
   * The clock a preview should show.
   *
   * The forge renders the real battlefield through the real pipeline but has no
   * `Game`, so without this the scene sat at whatever the renderer last held and
   * the time-of-day control appeared to do nothing. Cached on the authored hour
   * itself, because the editor mutates the settings object in place.
   */
  private previewDayNight(): DayNightState {
    const scenario = this.scenario;
    if (!scenario) return this.dayNight;
    const settings = scenario.settings;
    const key = `${settings.startHour}:${settings.dayLengthMinutes}`;
    if (this.previewClock?.key === key) return this.previewClock.state;
    const state = dayNightAt(0, {
      startHour: settings.startHour,
      dayLengthMinutes: 0,
    });
    this.previewClock = { key, state };
    return state;
  }

  /**
   * Lightning: schedule the next strike and fade the current one.
   *
   * Purely presentational, so it is allowed to be stochastic — a client seeing a
   * bolt a moment before the other changes nothing about the battle. The flash
   * doubles as a camera kick, because thunder you can feel is the difference
   * between weather and a brightness slider.
   */
  private updateStorm(): void {
    if (this.weather.kind !== 'storm') {
      this.flash = 0;
      this.sheet = 0;
      if (this.nextStrikeAt < this.time) this.nextStrikeAt = this.time + 2 + Math.random() * 4;
      if (this.nextSheetAt < this.time) this.nextSheetAt = this.time + 3 + Math.random() * 6;
      return;
    }
    if (this.time >= this.nextStrikeAt) {
      this.flashAt = this.time;
      this.flashEnergy = 0.55 + Math.random() * 0.45;
      // Storms strike in clusters: usually a wait, sometimes a second bolt on
      // the heels of the first.
      this.nextStrikeAt =
        this.time +
        (Math.random() < 0.3 ? 0.35 + Math.random() * 0.6 : 3.2 + Math.random() * 6.5);
      this.shake = Math.max(this.shake, 0.3 + Math.random() * 0.5);
    }
    // Distant sheet flashes run on their own clock, so a storm is never lit only
    // by the close strikes: most of the lightning is inside the cloud.
    if (this.time >= this.nextSheetAt) {
      this.sheetAt = this.time;
      this.sheetEnergy = 0.22 + Math.random() * 0.4;
      this.nextSheetAt = this.time + 1.6 + Math.random() * 5.5;
    }
    const since = this.time - this.flashAt;
    if (since < 0 || since > 0.9) {
      this.flash = 0;
    } else {
      // Sharp attack, then a second softer sheet-lightning tail.
      const bolt = Math.exp(-since * 26);
      const tail = since > 0.1 ? Math.exp(-(since - 0.1) * 9) * 0.45 : 0;
      this.flash = Math.min(1.2, (bolt + tail) * this.flashEnergy);
    }
    const sheetSince = this.time - this.sheetAt;
    if (sheetSince < 0 || sheetSince > 1.7) {
      this.sheet = 0;
      return;
    }
    // A cloud flash is soft on both edges and flickers rather than cracking: a
    // slow rise, a plateau with two dimming beats, then a long fade.
    const rise = Math.min(1, sheetSince / 0.16);
    const fade = Math.exp(-Math.max(0, sheetSince - 0.4) * 3.1);
    const flicker = 0.82 + 0.18 * Math.sin(sheetSince * 47 + this.sheetAt * 3.1);
    this.sheet = Math.min(1, rise * fade * flicker * this.sheetEnergy);
  }

  /**
   * Ground mist.
   *
   * Distance haze alone is a static wash: it says where the air gets thick, not
   * that anything is in it. Mist is a handful of large, soft, slow puffs that
   * drift with the wind and take ten seconds to cross the view, so the layers
   * pass in front of and behind a hull and the fog has depth you can see move.
   * It is presentation only; the fog of war mask and the weather's detection
   * numbers are untouched.
   */
  private emitMist(dt: number): void {
    const profile = this.weather;
    // Mist is a garnish on every wet sky and the substance of a fog map, but it
    // is never the whole effect: the distance haze does the thickening, and this
    // only supplies the layers. Kept deliberately sparse for that reason.
    const density =
      profile.kind === 'fog'
        ? 1
        : profile.kind === 'blizzard'
          ? 0.7
          : profile.kind === 'snow'
            ? 0.3
            : profile.kind === 'storm'
              ? 0.3
              : profile.kind === 'rain'
                ? 0.15
                : 0;
    if (density <= 0 || !this.settings.effects || !this.scenario) {
      this.mistBudget = 0;
      return;
    }
    const camera = this.camera;
    const spread = Math.max(camera.halfW, camera.halfH) * 1.6;
    // Slow: a bank every half second in thick fog, far fewer in rain.
    this.mistBudget += 2 * density * dt * Math.max(0.5, spread / 80);
    const room = Math.floor(this.particles.maxParticles * 0.55) - this.particles.particles.length;
    if (room <= 0) {
      this.mistBudget = 0;
      return;
    }
    const count = Math.min(6, room, Math.floor(this.mistBudget));
    if (count <= 0) return;
    this.mistBudget -= count;
    for (let i = 0; i < count; i++) {
      this.particles.mist(
        camera.cx + (Math.random() - 0.5) * spread * 2,
        camera.cz + (Math.random() - 0.5) * spread * 2,
        profile.wind,
        density,
      );
    }
  }

  /**
   * Precipitation for the current weather.
   *
   * Presentation-only: the simulation reads the weather profile's numbers and
   * never these particles. Emission is bounded to a box around the camera and
   * paced by a fractional budget, so the count is frame-rate independent and a
   * storm costs the same at 144 Hz as at 60 Hz.
   */
  private emitWeather(dt: number): void {
    const profile = this.weather;
    if (profile.precipitation <= 0 || !this.settings.effects || !this.scenario) {
      this.weatherBudget = 0;
      return;
    }
    const camera = this.camera;
    const heavy = profile.kind === 'storm' || profile.kind === 'blizzard';
    // A heavy front fills more of the screen than a shower does: a storm is
    // authored at a wider spread as well as a higher rate, so the frame edge
    // stops reading as the edge of the weather.
    const spread = Math.max(camera.halfW, camera.halfH) * (heavy ? 2.05 : 1.85);
    const drop = profile.kind !== 'snow' && profile.kind !== 'blizzard';
    // A downpour is a downpour: the old rate drew a handful of drops per frame,
    // which read as a drizzle whatever the weather was called. Snow needs its
    // own, lower base because each flake is much larger and lives far longer.
    const rate = profile.precipitation * (drop ? 980 : 560) * (spread / 60);
    this.weatherBudget += rate * dt;
    // Precipitation never takes the whole budget: an explosion has to be able
    // to push smoke into the field even in a storm, so rain stops short of the
    // cap and leaves the rest for combat effects.
    const room = Math.floor(this.particles.maxParticles * 0.78) - this.particles.particles.length;
    if (room <= 0) {
      this.weatherBudget = 0;
      return;
    }
    const count = Math.min(300, room, Math.floor(this.weatherBudget));
    if (count <= 0) return;
    this.weatherBudget -= count;
    for (let i = 0; i < count; i++) {
      this.particles.precipitation(
        camera.cx + (Math.random() - 0.5) * spread * 2,
        camera.cz + (Math.random() - 0.5) * spread * 2,
        profile.wind,
        drop,
        profile.precipitation,
      );
    }
  }

  /**
   * Turn the simulation's light list into one instanced batch. Ground pools sit
   * on the terrain surface, beams stretch along the vehicle's facing, and lit
   * windows and beacons are camera-facing glows nudged toward the viewer so a
   * facade does not hide its own light.
   */
  /** How brightly a structure's own windows glow, 0 by day. */
  private nightGlow(): number {
    return windowGlow(this.dayNight, this.settings.nightLights);
  }

  /**
   * Window glow for one structure. The glazing is part of the compound's own
   * load, so a brownout dims it along with production and a grid with no supply
   * at all leaves it dark, matching the wall lamps that already cut out. A site
   * still under construction has no supply to light glass it has not installed.
   *
   * A structure the team has only charted is drawn from memory, and memory does
   * not carry whether the lights are on: a compound in the fog must not advertise
   * itself with glowing glass, so it stays dark until it is seen again.
   */
  private buildingWindowGlow(owner: number, construction: boolean, remembered = false): number {
    const glow = this.nightGlow();
    if (glow <= 0) return 0;
    const game = this.game;
    return structureWindowGlow(glow, {
      construction,
      remembered,
      power: game && owner >= 0 ? game.powerStatus(owner) : null,
    });
  }

  private buildLightInstances(): void {
    const game = this.game;
    const scenario = this.scenario;
    this.lightPools.length = 0;
    this.lightGlows.length = 0;
    if (!game || !scenario || !this.settings.nightLights) return;
    if (this.dayNight.darkness <= 0) return;
    const width = scenario.width;
    const height = scenario.height;
    const tiles = scenario.tiles;
    const team = game.teamOf(game.localPlayerId);
    // Live entity state, not the vision-cadence snapshot: a moving vehicle's
    // beams must follow the hull, not trail it by half a second.
    const lights = buildLightView({
      entities: game.state.entities,
      dayNight: this.dayNight,
      bloom: this.settings.lightBloom,
      effects: this.settings.effects,
      powered: (owner) => !game.powerStatus(owner).brownout,
      eye: this.camera.eye,
      groundY: (x, z) => {
        const tx = Math.max(0, Math.min(width - 1, Math.floor(x / TILE_SIZE)));
        const tz = Math.max(0, Math.min(height - 1, Math.floor(z / TILE_SIZE)));
        return tiles[tz * width + tx].e * ELEVATION_HEIGHT;
      },
      // Only what this player can see is lit. A remembered structure stays on
      // the map as a dim silhouette, and an unseen one must not glow through
      // the fog of war.
      visible: (e) => game.visionStateOf(team, e.id) === 'visible',
      // The drawn pose, not the tick pose: the same eased position and heading
      // the hull mesh uses, including the travel heading while it is driving.
      pose: (e) => {
        const v = this.visuals.get(e.id);
        if (!v) return null;
        const def = e.kind === 'unit' ? UNITS[e.defId] : undefined;
        const driving = e.state === 'moving' && !!def && def.moveClass !== 'foot' && def.domain !== 'air';
        return { x: v.x, z: v.z, facing: driving ? v.motion : v.facing };
      },
    });
    for (const light of lights) {
      (light.glow > 0.5 ? this.lightGlows : this.lightPools).push(light);
    }
    // Crystal seams light their own ground once the sun is down, but only in
    // ground the player has actually explored.
    const seen = (x: number, z: number): boolean =>
      game.fogAt(
        team,
        Math.max(0, Math.min(width - 1, Math.floor(x / TILE_SIZE))),
        Math.max(0, Math.min(height - 1, Math.floor(z / TILE_SIZE))),
      ) === 2;
    for (const light of oreGlowLights(this.oreInstances, this.nightGlow(), this.camera.eye, seen)) {
      this.lightPools.push(light);
    }
  }

  /**
   * The sea surface, as a grid rather than a quad.
   *
   * A four-corner plane can only ever be tilted, so a swell drawn on it was
   * limited to shading. Displacing a grid in the vertex shader is what makes
   * heavy water actually move: crests rise and travel, the silhouette against a
   * hull changes, and the shore keeps a flat shelf because the displacement is
   * gated on the depth field. One quad per ~2 tiles is plenty at battle zoom and
   * costs a few thousand triangles.
   */
  private buildWater(scenario: Scenario): void {
    const gl = this.gl;
    const w = scenario.width * TILE_SIZE;
    const h = scenario.height * TILE_SIZE;
    const y = 0.12;
    const segmentsX = Math.max(24, Math.min(96, scenario.width));
    const segmentsZ = Math.max(24, Math.min(96, scenario.height));
    const cols = segmentsX + 1;
    const rows = segmentsZ + 1;
    const positions = new Float32Array(cols * rows * 3);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const o = (r * cols + c) * 3;
        positions[o] = (c / segmentsX) * w;
        positions[o + 1] = y;
        positions[o + 2] = (r / segmentsZ) * h;
      }
    }
    const indices = new Uint32Array(segmentsX * segmentsZ * 6);
    let i = 0;
    for (let r = 0; r < segmentsZ; r++) {
      for (let c = 0; c < segmentsX; c++) {
        const a = r * cols + c;
        const b = a + 1;
        const d = a + cols;
        const e = d + 1;
        indices[i++] = a;
        indices[i++] = b;
        indices[i++] = e;
        indices[i++] = a;
        indices[i++] = e;
        indices[i++] = d;
      }
    }
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.waterVao = vao;
    this.waterCount = indices.length;
  }

  private uploadTexture(
    texture: WebGLTexture,
    width: number,
    height: number,
    data: Uint8Array,
    rgba = false,
  ): void {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    if (rgba) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, width, height, 0, gl.RED, gl.UNSIGNED_BYTE, data);
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  /**
   * Publish a new fog mask. The field already on the GPU becomes the previous
   * texture instead of being overwritten, so the shaders can cross-fade the
   * two across one upload interval. `fogBlend` restarts at zero, which is what
   * turns the three-tick mask rebuild into a sliding vision boundary rather
   * than a step.
   */
  private uploadFogField(data: Uint8Array): void {
    if (!this.scenario) return;
    const { width, height } = this.scenario;
    const previous = this.fogBytesPrev ?? data;
    this.uploadTexture(this.fogTextureOld, width, height, previous);
    this.uploadTexture(this.fogTexture, width, height, data);
    if (!this.fogBytesPrev || this.fogBytesPrev.length !== data.length) {
      this.fogBytesPrev = new Uint8Array(data.length);
    }
    this.fogBytesPrev.set(data);
    this.fogBlend = 0;
  }

  private updateFog(): void {
    if (!this.scenario) return;
    const game = this.game;
    if (!game) {
      if (!this.fogData || this.fogData[0] !== 255) {
        this.fogData = new Uint8Array(this.scenario.width * this.scenario.height).fill(255);
        this.fogBytesPrev = null;
        this.uploadFogField(this.fogData);
      }
      return;
    }
    if (game.state.tick - this.lastFogTick < 3 && this.lastFogTick >= 0) return;
    this.lastFogTick = game.state.tick;
    const team = game.teamOf(game.localPlayerId);
    const src = game.state.fog[Math.max(0, team)];
    if (!this.fogData || this.fogData.length !== src.length) {
      this.fogData = new Uint8Array(src.length);
      this.fogBytesPrev = null;
    }
    // Three authored states, unchanged: 255 visible, 112 charted, 0 unseen.
    const data = this.fogData;
    if (!game.state.scenario.settings.fog || !this.settings.showFog) {
      data.fill(255);
    } else {
      for (let i = 0; i < src.length; i++) data[i] = src[i] === 2 ? 255 : src[i] === 1 ? 112 : 0;
    }
    this.uploadFogField(data);
  }

  private refreshOre(): void {
    if (!this.scenario) return;
    const game = this.game;
    let data: PropInstance[];
    if (game) {
      if (this.oreInstances.length > 0 && game.state.tick - this.lastOreRefresh < 20) return;
      this.lastOreRefresh = game.state.tick;
      const source = buildPropInstances(this.scenario, game.state.map.ore, game.state.map.maxOre);
      data = source.ore;
    } else {
      data = this.oreInstances;
    }
    if (data.length !== this.oreInstances.length || game) {
      const changed = data.length !== this.oreInstances.length;
      this.oreInstances = data;
      this.oreMesh.setInstances(this.oreInstances);
      if (changed) this.rebuildPropShadows();
    }
  }

  /** Fraction of the next simulation tick already elapsed, for smooth projectiles. */
  setSimulationAlpha(alpha: number): void {
    this.simulationAlpha = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha;
  }

  update(dt: number): void {
    this.time += dt;
    this.weather = weatherFor(this.scenario?.settings.weather);
    this.particles.wind = this.weather.wind;
    this.updateStorm();
    this.emitWeather(dt);
    this.emitMist(dt);
    // The fog cross-fade is driven by wall time, not ticks, so it finishes in
    // step with the next mask upload even while the battle is paused.
    this.fogBlend = Math.min(1, this.fogBlend + dt / FOG_UPDATE_SECONDS);
    this.particles.update(dt);
    this.decals.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.7);
    if (this.game) {
      this.consumeEvents(this.game);
      this.updateVisuals(dt, this.game);
      this.updateProjectileViews(this.game);
      this.emitAmbientEffects(dt, this.game);
      this.updateWreckEffects(dt, this.game);
      this.updateSmokeClouds(dt, this.game);
      this.updateProjectileTrails(dt, this.game);
      this.refreshOre();
      this.updateFog();
    } else {
      this.updateFog();
    }
  }

  private updateVisuals(dt: number, game: Game): void {
    const seen = new Set<number>();
    const k = 1 - Math.exp(-dt * 13);
    for (const e of game.state.entities) {
      seen.add(e.id);
      let v = this.visuals.get(e.id);
      if (!v) {
        v = {
          x: e.x,
          z: e.z,
          facing: e.facing,
          turret: e.turretFacing,
          motion: e.facing,
          lastX: e.x,
          lastZ: e.z,
          trailTimer: 0,
          damageTimer: 0,
          gait: 0,
          pace: 0,
          elevation: 0,
          door: 0,
          doorHold: 0,
          doorQueue: 0,
          emerge: 0,
          emergeAlt: 1,
          trackTimer: 0,
        };
        this.visuals.set(e.id, v);
        this.startEmergence(game, e, v);
      }
      // The shutter stays shut while a vehicle is being assembled and only
      // rolls up as that job is finishing, holds open while the unit drives
      // out, then drops again. A site still under construction never opens it.
      const rig = e.kind === 'building' ? this.buildingMeshes.get(e.defId) : null;
      if (rig?.door) {
        const head = e.queue[0];
        const opening = !e.construction && !!head && head.remaining <= 0.55;
        const queued = e.construction ? 0 : e.queue.length;
        if (queued < v.doorQueue) v.doorHold = 1.8;
        v.doorQueue = queued;
        v.doorHold = Math.max(0, v.doorHold - dt);
        const target = opening || v.doorHold > 0 ? 1 : 0;
        v.door += (target - v.door) * (1 - Math.exp(-dt * 9));
        if (v.door < 0.002) v.door = 0;
      }
      const udef = e.kind === 'unit' ? UNITS[e.defId] : undefined;
      const walking =
        !!udef &&
        udef.moveClass === 'foot' &&
        e.state === 'moving' &&
        e.path.length > 0;
      v.pace += ((walking ? 1 : 0) - v.pace) * (1 - Math.exp(-dt * 9));
      if (v.pace > 0.02) v.gait += dt * 8.5 * v.pace;
      const deployed =
        e.kind === 'unit' &&
        e.defId === 'mlrs' &&
        (e.aimTargetId !== 0 || e.state === 'attacking')
          ? 1
          : 0;
      v.elevation += (deployed - v.elevation) * (1 - Math.exp(-dt * 4.2));
      if (v.elevation < 0.002) v.elevation = 0;
      // Aircraft leave the hangar on the ground and climb away.
      if (v.emergeAlt < 1) v.emergeAlt = Math.min(1, v.emergeAlt + dt / 1.3);
      const teleport = Math.abs(e.x - v.x) + Math.abs(e.z - v.z) > 40;
      // A unit leaving its bay eases out slowly enough to be seen driving.
      const ease = v.emerge > 0 ? 1 - Math.exp(-dt * 4.5) : k;
      if (v.emerge > 0) v.emerge = Math.max(0, v.emerge - dt);
      // Measure the step the simulation actually took before easing toward
      // it. A hull pushed off its centreline is still seen driving that way,
      // not strafing with its nose fixed.
      const travelX = e.x - v.lastX;
      const travelZ = e.z - v.lastZ;
      v.lastX = e.x;
      v.lastZ = e.z;
      if (e.kind === 'unit' && Math.hypot(travelX, travelZ) > 0.004) {
        const travel = Math.atan2(travelZ, travelX);
        v.motion += normalizeDiff(travel - v.motion) * k;
      }
      if (teleport) {
        v.x = e.x;
        v.z = e.z;
        v.facing = e.facing;
        v.turret = e.turretFacing;
        v.motion = e.facing;
        v.emerge = 0;
        v.trackTimer = 0;
      } else {
        v.x += (e.x - v.x) * ease;
        v.z += (e.z - v.z) * ease;
        const facingDiff = normalizeDiff(e.facing - v.facing);
        v.facing += facingDiff * k;
        const turretDiff = normalizeDiff(e.turretFacing - v.turret);
        v.turret += turretDiff * k;
      }
    }
    for (const id of [...this.visuals.keys()]) {
      if (!seen.has(id)) this.visuals.delete(id);
    }
  }

  /**
   * A produced unit is created on the apron outside its facility. Start its
   * visual at the bay doorway instead and ease it out, so the first thing the
   * player sees is a vehicle driving out of an open shutter rather than one
   * appearing beside the wall.
   */
  private startEmergence(game: Game, e: Entity, v: VisualEntity): void {
    if (e.kind !== 'unit' || e.garrisonId) return;
    const def = UNITS[e.defId];
    if (!def) return;
    let source: Entity | null = null;
    let bestDist = Infinity;
    for (const b of game.state.entities) {
      if (b.kind !== 'building' || b.owner !== e.owner || b.hp <= 0 || b.construction) continue;
      const rig = this.buildingMeshes.get(b.defId);
      if (!rig?.door) continue;
      const d = Math.hypot(b.x - e.x, b.z - e.z);
      if (d > TILE_SIZE * 4.5 || d >= bestDist) continue;
      source = b;
      bestDist = d;
    }
    if (!source) return;
    const rig = this.buildingMeshes.get(source.defId);
    if (!rig?.door) return;
    // Only a shutter that is already rolling up means a unit just came out of
    // that bay; a unit merely placed beside a factory at battle start stays put.
    const shutter = this.visuals.get(source.id);
    if (!shutter || (shutter.door < 0.05 && shutter.doorHold <= 0)) return;
    if (def.domain === 'naval') {
      // A hull is launched from the basin, not a door in one fixed wall: start
      // it partway out of the dock on the line to its berth, so it sails clear
      // whichever side the water happens to be on.
      v.x = source.x + (e.x - source.x) * 0.45;
      v.z = source.z + (e.z - source.z) * 0.45;
    } else {
      // The doorway plane sits inside the footprint, on the far side of the
      // wall from the tile the simulation actually spawned on, rotated with the
      // building (a yard's gate faces its harbour, not always +Z).
      const mount = rotateLocalOffset(rig.doorOffset[0], rig.doorOffset[2], source.facing);
      v.x = source.x + mount.x;
      v.z = source.z + mount.z;
    }
    // Head out of the opening, then let the normal smoothing turn the unit
    // onto its real heading.
    const dx = e.x - v.x;
    const dz = e.z - v.z;
    const heading = Math.hypot(dx, dz) > 0.01 ? Math.atan2(dz, dx) : Math.PI / 2;
    v.facing = heading;
    v.turret = heading;
    // Hulls and aircraft need longer to clear the opening than a truck.
    v.emerge = def.domain === 'land' ? 0.9 : 1.4;
    if (def.domain === 'air') v.emergeAlt = 0.12;
    const door = this.visuals.get(source.id);
    if (door) door.doorHold = Math.max(door.doorHold, v.emerge + 0.6);
  }

  private emitAmbientEffects(dt: number, game: Game): void {
    if (!this.settings.effects) return;
    const team = game.teamOf(game.localPlayerId);
    for (const e of game.state.entities) {
      if (e.hp <= 0) continue;
      if (e.kind === 'unit' && e.garrisonId) continue;
      if (!game.isVisibleTo(team, e.id)) continue;
      const v = this.visuals.get(e.id);
      if (!v) continue;
      const distToCamera = Math.hypot(v.x - this.camera.cx, v.z - this.camera.cz);
      if (distToCamera > this.camera.zoom * 2.8) continue;
      const def = UNITS[e.defId];
      const moved = e.path.length > 0 && e.state === 'moving';
      if (def && e.kind === 'unit') {
        v.trailTimer -= dt;
        if (moved && v.trailTimer <= 0) {
          if (def.domain === 'air' && !e.aircraft?.landed) {
            const trailHeight = 0.3 + (AIR_UNIT_ALTITUDE - 0.4) * v.emergeAlt;
            this.particles.jetTrail(v.x, trailHeight, v.z);
            v.trailTimer = 0.05;
          } else if (def.domain === 'naval') {
            this.particles.wake(v.x, 0.2, v.z, v.facing);
            v.trailTimer = 0.13;
          } else if (def.moveClass === 'tracked' || def.moveClass === 'wheeled') {
            this.particles.trackDust(v.x, tileWorldHeight(this.scenario!, v.x, v.z), v.z, v.facing);
            v.trailTimer = 0.18;
          } else {
            v.trailTimer = 0.4;
          }
        }
        if (moved && (def.moveClass === 'tracked' || def.moveClass === 'wheeled')) {
          v.trackTimer -= dt;
          if (v.trackTimer <= 0) {
            if (def.moveClass === 'wheeled') {
              this.stampTyreDecal(e.defId, v);
              // Rubber marks sit closer together than steel track links.
              v.trackTimer = 0.38;
            } else {
              this.stampTrackDecal(e.defId, v);
              v.trackTimer = 0.44;
            }
          }
        } else {
          // A stopped vehicle starts a fresh mark when it moves again.
          v.trackTimer = 0;
        }
      }
      const hpRatio = e.hp / e.maxHp;
      if (hpRatio < 0.5) {
        v.damageTimer -= dt;
        if (v.damageTimer <= 0) {
          const y =
            (def?.domain === 'air' && !e.aircraft?.landed
              ? AIR_UNIT_ALTITUDE
              : tileWorldHeight(this.scenario!, v.x, v.z) + (e.kind === 'building' ? 3.5 : 1.3));
          this.particles.damageSmoke(v.x, y, v.z, hpRatio < 0.25);
          v.damageTimer = 0.65;
        }
      }
    }
  }

  private stampTrackDecal(defId: string, v: VisualEntity): void {
    if (!this.scenario) return;
    const [rx, rz] = unitShadowRadius(defId);
    const back = rx * 0.7;
    const x = v.x - Math.cos(v.motion) * back;
    const z = v.z - Math.sin(v.motion) * back;
    if (isWaterAt(this.scenario, x, z)) return;
    this.decals.addTrack(
      x,
      tileWorldHeight(this.scenario, x, z) + 0.06,
      z,
      v.motion,
      rx * 0.95,
      rz,
    );
  }

  private stampTyreDecal(defId: string, v: VisualEntity): void {
    if (!this.scenario) return;
    const [rx, rz] = unitShadowRadius(defId);
    const back = rx * 0.7;
    const x = v.x - Math.cos(v.motion) * back;
    const z = v.z - Math.sin(v.motion) * back;
    if (isWaterAt(this.scenario, x, z)) return;
    this.decals.addTyreTrack(
      x,
      tileWorldHeight(this.scenario, x, z) + 0.06,
      z,
      v.motion,
      rx * 0.9,
      rz * 0.86,
    );
  }

  private addScorchDecal(x: number, z: number, scale: number): void {
    if (!this.settings.effects || !this.scenario || isWaterAt(this.scenario, x, z)) return;
    this.decals.addScorch(
      x,
      tileWorldHeight(this.scenario, x, z) + 0.05,
      z,
      0.9 + 0.7 * scale,
    );
  }

  private addCraterDecal(x: number, z: number, scale: number): void {
    if (!this.settings.effects || !this.scenario || isWaterAt(this.scenario, x, z)) return;
    this.decals.addCrater(
      x,
      tileWorldHeight(this.scenario, x, z) + 0.055,
      z,
      0.36 + 0.26 * scale,
    );
  }

  /**
   * Keep the last two simulated positions of every projectile. The render
   * thread draws between them using the fraction of a tick that has elapsed,
   * so a fast bullet is a short streak instead of a dot that teleports three
   * tiles at once.
   */
  private updateProjectileViews(game: Game): void {
    const seen = new Set<number>();
    for (const p of game.state.projectiles) {
      seen.add(p.id);
      const current: ProjectileSample = { x: p.x, y: p.y, z: p.z };
      const view = this.projectileViews.get(p.id);
      if (!view) {
        this.projectileViews.set(p.id, {
          previous: { x: p.startX ?? p.x, y: p.startY ?? p.y, z: p.startZ ?? p.z },
          current,
        });
        continue;
      }
      if (p.x !== view.current.x || p.y !== view.current.y || p.z !== view.current.z) {
        view.previous = view.current;
        view.current = current;
      }
    }
    for (const id of [...this.projectileViews.keys()]) {
      if (!seen.has(id)) this.projectileViews.delete(id);
    }
  }

  private projectilePosition(id: number, fallback: ProjectileSample): ProjectileSample {
    const view = this.projectileViews.get(id);
    if (!view) return fallback;
    return sampleProjectile(view.previous, view.current, this.simulationAlpha);
  }

  private pointVisible(game: Game, x: number, z: number): boolean {
    return pointVisibleToLocal(game, x, z);
  }

  private updateProjectileTrails(dt: number, game: Game): void {
    if (!this.settings.effects) return;
    const seen = new Set<number>();
    for (const p of game.state.projectiles) {
      seen.add(p.id);
      const profile = weaponFxProfile(p.weaponId);
      if (!profile.trailSmoke && !profile.trailWake) continue;
      // A hostile trail beyond the vision boundary is still hidden: the trail
      // is presentation, not a sensor. Own-team trails stay drawn.
      if (!projectileVisibleToLocal(game, p.owner, p.x, p.z, p.shooterId)) continue;
      let t = this.projectileTrailTimers.get(p.id) ?? 0;
      t -= dt;
      if (t <= 0) {
        if (profile.trailWake) {
          const view = this.projectileViews.get(p.id);
          const angle = view
            ? Math.atan2(view.current.z - view.previous.z, view.current.x - view.previous.x)
            : 0;
          this.particles.wake(p.x, 0.12, p.z, angle, 1.2);
          t = 0.04;
        } else {
          this.particles.smoke(p.x, p.y, p.z, 1, 0.58);
          t = 0.035;
        }
      }
      this.projectileTrailTimers.set(p.id, t);
    }
    for (const id of [...this.projectileTrailTimers.keys()]) {
      if (!seen.has(id)) this.projectileTrailTimers.delete(id);
    }
  }

  private consumeEvents(game: Game): void {
    const events = game.eventsAfter(this.lastEventSeq);
    if (events.length === 0) return;
    this.lastEventSeq = events[events.length - 1].seq;
    for (const ev of events) {
      if (ev.x === 0 && ev.z === 0) continue;
      if (!eventVisibleToLocal(game, ev)) continue;
      const groundY = tileWorldHeight(this.scenario!, ev.x, ev.z);
      const profile = weaponFxProfile(ev.weaponId);
      switch (ev.type) {
        case 'shot': {
          const shooter = ev.entityId ? game.getEntity(ev.entityId) : undefined;
          // The simulation reports the real muzzle height; only fall back to
          // the old per-domain guess for legacy events.
          let mx = ev.x;
          let my = ev.y ?? (shooter?.kind === 'unit' && UNITS[shooter.defId]?.domain === 'air'
            ? AIR_UNIT_ALTITUDE
            : groundY + (shooter?.kind === 'building' ? 3.2 : 1.5));
          let mz = ev.z;
          // Static weapons fire from centre-of-building in the simulation. Draw
          // the flash at the authored barrel tip instead, without changing the
          // projectile origin or the gameplay hardpoint.
          if (shooter?.kind === 'building') {
            const baseY = tileWorldHeight(this.scenario!, shooter.x, shooter.z);
            const anchor = staticMuzzleAnchor(
              shooter.defId,
              shooter.x,
              baseY,
              shooter.z,
              shooter.facing,
              shooter.turretFacing,
            );
            if (anchor) {
              mx = anchor.x;
              my = anchor.y;
              mz = anchor.z;
            }
          }
          this.particles.muzzle(mx, my, mz, profile.muzzleScale, profile.muzzleSmoke);
          break;
        }
        case 'impact': {
          const y = ev.y ?? groundY + 0.5;
          const water = ev.surface === 'water' || isWaterAt(this.scenario!, ev.x, ev.z);
          if (ev.hit && !water) {
            if (ev.surface === 'ground') {
              this.particles.hit(ev.x, y, ev.z, profile.hitSparkScale);
            } else {
              this.particles.sparks(ev.x, y, ev.z, profile.hitSparkScale);
            }
          } else {
            this.particles.impact(ev.x, y, ev.z, water, profile.impactScale);
          }
          // Only rounds that actually disturb soil scar it: rifle bullets and
          // airburst fragments leave sparks, not craters.
          if (!water && ev.surface === 'ground' && profile.class !== 'smallArms') {
            this.addCraterDecal(ev.x, ev.z, profile.impactScale);
          }
          break;
        }
        case 'explosion': {
          const y = ev.y ?? groundY + 0.4;
          const water = ev.surface === 'water' || isWaterAt(this.scenario!, ev.x, ev.z);
          if (water) {
            this.particles.impact(ev.x, y, ev.z, true, profile.impactScale);
          } else {
            const explosionScale = profile.explosionScale || 0.8;
            this.particles.explosion(ev.x, y, ev.z, explosionScale);
            this.addShake(ev.x, ev.z, Math.max(0.04, profile.shake));
            if (ev.surface === 'ground') {
              this.addScorchDecal(ev.x, ev.z, explosionScale);
              this.addCraterDecal(ev.x, ev.z, explosionScale);
            }
          }
          break;
        }
        case 'unitLost': {
          const def = ev.defId ? UNITS[ev.defId] : undefined;
          const y = groundY + 0.4;
          if (def?.domain === 'air') {
            this.particles.explosion(ev.x, y + 0.3, ev.z, 1.05);
            this.addShake(ev.x, ev.z, 0.18);
          } else {
            // The killing impact already produced the fireball. A wreck is a
            // second, quieter event: smoke and a small fire, not another blast.
            const armoured = !!def && def.armour !== 'infantry';
            this.particles.wreck(ev.x, y, ev.z, armoured ? 1 : 0.4, armoured);
            this.addShake(ev.x, ev.z, armoured ? 0.1 : 0.025);
            if (def?.domain === 'land' && armoured) {
              this.wrecks.push({
                defId: ev.defId!,
                x: ev.x,
                y: groundY + 0.1,
                z: ev.z,
                facing: ev.facing ?? 0,
              });
            }
          }
          break;
        }
        case 'buildingLost':
          this.particles.collapse(ev.x, groundY + 0.4, ev.z, 1.4);
          this.addShake(ev.x, ev.z, 0.34);
          break;
        case 'buildingPlaced':
        case 'buildingComplete':
          this.particles.dust(ev.x, groundY + 0.5, ev.z, 12, 0.38);
          break;
        case 'capture': {
          const color = this.teamColorOf(game, ev.team);
          this.particles.capture(ev.x, groundY + 1, ev.z, color);
          break;
        }
        case 'aircraftReturn':
          this.particles.dust(ev.x, groundY + 0.5, ev.z, 8, 0.5);
          break;
        case 'unitBuilt':
          this.particles.dust(ev.x, groundY + 0.4, ev.z, 6, 0.35);
          break;
      }
    }
  }

  private addShake(x: number, z: number, amount: number): void {
    if (!this.settings.shake) return;
    const d = Math.hypot(x - this.camera.cx, z - this.camera.cz);
    const reach = this.camera.zoom * 2.2;
    if (d > reach) return;
    this.shake = Math.min(0.7, this.shake + amount * (1 - d / reach));
  }

  /** The team tint a skirmish chose for this player, if any. */
  private playerColor(owner: number): string | undefined {
    const players = this.game?.state.scenario.players ?? this.scenario?.players;
    return players?.find((player) => player.id === owner)?.color;
  }

  private teamColorOf(game: Game, owner: number): [number, number, number] {
    return [...teamColorForOwner(owner, game.player(owner)?.factionId, this.playerColor(owner))];
  }

  private teamColorScenario(owner: number): [number, number, number] {
    if (!this.scenario) return [...teamColorForOwner(owner, undefined)];
    const p = this.scenario.players.find((pl) => pl.id === owner);
    return [...teamColorForOwner(owner, p?.factionId, p?.color)];
  }

  /**
   * Building flags follow the chosen team tint, not just the alliance colour.
   * The caller passes the flag owner (the garrison when occupied), so a
   * garrisoned neutral site cannot fall back to the shell's faction colour.
   */
  private flagColorFor(owner: number, factionId: string | undefined): Vec3 {
    return flagColorForOwner(factionId, this.playerColor(owner));
  }

  render(): void {
    if (this.contextLost) return;
    const gl = this.gl;
    if (!this.scenario) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }
    this.resize();
    this.camera.shakeX = Math.sin(this.time * 91) * this.shake;
    this.camera.shakeY = Math.cos(this.time * 73) * this.shake * 0.6;
    this.camera.update();
    // The simulation owns the clock; the renderer reads it once per frame and
    // rebuilds the grade only when the visible hour changes.
    // In battle the simulation owns the clock; in the forge there is no
    // simulation yet, so the authored start hour is shown frozen at tick 0 —
    // exactly the light the match will open in.
    if (this.game) this.dayNight = this.game.dayNight;
    else this.dayNight = this.previewDayNight();
    const key = `${this.dayNight.phase}:${this.dayNight.light.toFixed(3)}:${this.settings.nightLights}:${this.settings.lightBloom}:${this.scenario.settings.weather}`;
    if (key !== this.lightingKey) {
      this.lightingKey = key;
      this.applyLighting();
    }
    // Lightning changes every frame, so it is layered on after the grade rather
    // than folded into it.
    this.applyFlash();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.clearColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawTerrain();
    this.drawWater();
    this.drawGroundDecals();
    this.drawShadows();
    this.drawProps();
    if (this.game && this.settings.nightLights && this.dayNight.darkness > 0) {
      this.buildLightInstances();
      this.lightGpu.draw(this.camera, this.lightPools);
    }
    if (this.game) {
      // Silhouettes go down before the units themselves. The depth buffer then
      // holds only terrain, structures and props, so a friendly hull in front of
      // another cannot trigger a silhouette wash, and a visible unit paints
      // over its own outline as it should.
      if (this.settings.silhouettes) this.drawOccludedUnits(this.game);
      this.drawBattleEntities(this.game);
      this.drawWrecks(this.game);
    } else {
      this.drawScenarioEntities();
    }
    // Wall lamps, lit windows and lens glows ride on top of the models, so a
    // building cannot cover the light it is carrying. Depth still hides the
    // ones on the far side of it.
    if (this.lightGlows.length > 0) {
      this.lightGpu.draw(this.camera, this.lightGlows);
    }
    this.drawParticles();
  }

  private setCameraUniforms(program: MeshProgram): void {
    const gl = this.gl;
    const u = program.u;
    gl.uniform3fv(u.uEye, this.camera.eye);
    gl.uniform3fv(u.uRight, this.camera.right);
    gl.uniform3fv(u.uUp, this.camera.up);
    gl.uniform3fv(u.uForward, this.camera.forward);
    gl.uniform2f(u.uHalf, this.camera.halfW, this.camera.halfH);
    gl.uniform1f(u.uNear, NEAR);
    gl.uniform1f(u.uFar, FAR);
    gl.uniform1f(u.uTime ?? null, this.time);
    gl.uniform3fv(u.uTone ?? null, this.tone);
    // Aerial perspective belongs to every lit program, so it is bound with the
    // camera rather than repeated in each draw call. A program that does not
    // declare it simply has no location and skips the upload.
    gl.uniform1f(u.uHaze ?? null, this.hazeDensity);
    gl.uniform3fv(u.uHazeColor ?? null, this.hazeColor);
    // Haze is measured from the camera's focus point, not from an eye parked
    // 1400 units back along an orthographic axis: see HAZE_GLSL.
    gl.uniform1f(
      u.uHazeRef ?? null,
      Math.hypot(
        this.camera.eye[0] - this.camera.cx,
        this.camera.eye[1],
        this.camera.eye[2] - this.camera.cz,
      ),
    );
  }

  /**
   * Bind the current and previous fog fields and the cross-fade weight. Every
   * world-projected program declares both samplers, so leaving one unbound
   * would let the fragment shader read whatever texture the last pass left.
   */
  private bindFogFields(
    u: Record<string, WebGLUniformLocation | null>,
    currentUnit: number,
    oldUnit: number,
  ): void {
    bindTextureUnit(this.gl, currentUnit, this.fogTexture, u.uFogTex ?? null);
    bindTextureUnit(this.gl, oldUnit, this.fogTextureOld, u.uFogTexOld ?? null);
    this.gl.uniform1f(u.uFogBlend ?? null, this.fogBlend);
  }

  /** Bind the national flag texture, or the white fallback for ordinary meshes. */
  private bindFlagTexture(nation?: string): boolean {
    const texture = nation ? this.flagTextures.get(nation) : undefined;
    bindTextureUnit(
      this.gl,
      MESH_FLAG_TEXTURE_UNIT,
      texture ?? this.whiteTexture,
      this.meshProgram.u.uFlagTex ?? null,
    );
    return !!texture;
  }

  private drawTerrain(): void {
    if (!this.terrainGpu || !this.scenario) return;
    const gl = this.gl;
    const p = this.terrainProgram;
    gl.useProgram(p.program);
    this.setCameraUniforms(p);
    gl.uniform3fv(p.u.uSun, this.sun);
    gl.uniform1f(p.u.uAmbient, this.ambient);
    gl.uniform1f(p.u.uUseFog, this.game && this.settings.showFog ? 1 : 0);
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uGrid, this.settings.grid ? 1 : 0);
    // Ground wetness is authored by the weather, not by the frame: a rainy map
    // is soaked when the first unit lands and stays soaked.
    gl.uniform1f(p.u.uWet ?? null, this.weather.wet);
    bindTextureUnit(gl, 1, this.shoreTexture, p.u.uShoreTex ?? null);
    // Fog at unit 0, the previous field at unit 2; the shore map keeps unit 1.
    this.bindFogFields(p.u, 0, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindVertexArray(this.terrainGpu.vao);
    gl.drawElements(gl.TRIANGLES, this.terrainGpu.count, gl.UNSIGNED_INT, 0);
    gl.bindVertexArray(null);

    if (this.roadMesh) {
      const mp = this.meshProgram;
      gl.useProgram(mp.program);
      this.setCameraUniforms(mp);
      gl.uniform3fv(mp.u.uSun, this.sun);
      gl.uniform1f(mp.u.uAmbient, this.ambient);
      gl.uniformMatrix4fv(mp.u.uModel, false, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
      gl.uniform3f(mp.u.uTeamColor, 0.5, 0.5, 0.5);
      gl.uniform3f(mp.u.uTint, 1, 1, 1);
      gl.uniform1f(mp.u.uAlpha, 1);
      gl.uniform1f(mp.u.uFlash, 0);
      // Roads carry the same fog as the ground they are painted on: full in
      // vision, dimmed where the team has charted the ground, dark elsewhere.
      gl.uniform1f(mp.u.uUseFog, this.game && this.settings.showFog ? 1 : 0);
      gl.uniform2f(mp.u.uWorldSize, this.scenario.width * TILE_SIZE, this.scenario.height * TILE_SIZE);
      // The mesh shader also samples the flag texture, so fog cannot share unit
      // 0 with it: binding both there made roads read the white fallback as fog
      // and render at full brightness across ground nobody had seen.
      this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT);
      bindTextureUnit(gl, MESH_MATERIAL_TEXTURE_UNIT, this.materialTexture, mp.u.uMatLut ?? null);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      this.bindFlagTexture();
      this.roadMesh.draw();
      gl.disable(gl.BLEND);
    }
  }

  private drawWater(): void {
    if (!this.waterVao || !this.scenario) return;
    const gl = this.gl;
    const p = this.waterProgram;
    gl.useProgram(p.program);
    this.setCameraUniforms(p);
    gl.uniform3fv(p.u.uSun, this.sun);
    gl.uniform1f(p.u.uAmbient, this.ambient);
    // Low quality keeps the sea surface but stops paying for animated normals.
    gl.uniform1f(p.u.uTime, this.settings.waterDetail ? this.time : 0);
    gl.uniform1f(p.u.uUseFog, this.game && this.settings.showFog ? 1 : 0);
    // Sea state comes from the weather, so a storm map is fought on heavy water
    // from the first frame and a calm one is glassy.
    gl.uniform1f(p.u.uSea ?? null, this.settings.waterDetail ? this.weather.sea : 0.12);
    gl.uniform2f(p.u.uWorldSize, this.scenario.width * TILE_SIZE, this.scenario.height * TILE_SIZE);
    bindTextureUnit(gl, 1, this.shoreTexture, p.u.uShoreTex ?? null);
    this.bindFogFields(p.u, 0, 2);
    // The sea is one plane across the whole map, so every coastal triangle meets
    // it at a grazing angle. Geometric clearance alone still left the shoreline
    // interleaving at long range, so the plane is biased away from the camera in
    // depth as well: land always wins the boundary, and the waterline reads as a
    // line instead of a flicker.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 2.0);
    gl.bindVertexArray(this.waterVao);
    gl.drawElements(gl.TRIANGLES, this.waterCount, gl.UNSIGNED_INT, 0);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.bindVertexArray(null);
    gl.activeTexture(gl.TEXTURE0);
  }

  private drawProps(): void {
    const gl = this.gl;
    const p = this.propProgram;
    gl.useProgram(p.program);
    this.setCameraUniforms(p);
    gl.uniform3fv(p.u.uSun, this.sun);
    gl.uniform1f(p.u.uAmbient, this.ambient);
    gl.uniform1f(p.u.uUseFog, this.game && this.settings.showFog ? 1 : 0);
    gl.uniform2f(p.u.uWorldSize, this.scenario!.width * TILE_SIZE, this.scenario!.height * TILE_SIZE);
    this.bindFogFields(p.u, 0, 2);
    bindTextureUnit(gl, PROP_MATERIAL_TEXTURE_UNIT, this.materialTexture, p.u.uMatLut ?? null);
    gl.uniform1f(p.u.uEmissive, 0);
    gl.uniform3f(p.u.uGlow, 0, 0, 0);
    // Wind reaches the canopy through the prop shader; fences, lamps and rock
    // are tagged with a rigid material and never move.
    gl.uniform2f(p.u.uWind, this.weather.wind[0], this.weather.wind[1]);
    gl.uniform1f(p.u.uTime ?? null, this.time);
    this.treesMesh.draw(this.treeInstances.length);
    this.rocksMesh.draw(this.rockInstances.length);
    // The authored detail set. Three instanced batches, not one draw per prop:
    // scrub, boundary fencing and kerbside lamps share the prop program.
    this.bushesMesh.draw(this.bushInstances.length);
    this.shrubsMesh.draw(this.shrubInstances.length);
    this.tuftsMesh.draw(this.tuftInstances.length);
    this.fencesMesh.draw(this.fenceInstances.length);
    this.lampsMesh.draw(this.lampInstances.length);
    this.signsMesh.draw(this.signInstances.length);
    this.rubbleMesh.draw(this.rubbleInstances.length);
    this.reedsMesh.draw(this.reedInstances.length);
    this.polesMesh.draw(this.poleInstances.length);
    // The deposit is the one prop lit from inside: after dark the crystal
    // faces burn cyan on their own, brighter than the ground they stand on.
    const crystal = this.nightGlow() * 0.85;
    gl.uniform1f(p.u.uEmissive, 0.16);
    gl.uniform3f(p.u.uGlow, 0.16 * crystal, 0.8 * crystal, 1.0 * crystal);
    this.oreMesh.draw(this.oreInstances.length);
  }

  /** Direction the shadow leans, opposite the horizontal sun vector. */
  private shadowLean(amount: number): { x: number; z: number } {
    const len = Math.hypot(this.sun[0], this.sun[2]) || 1;
    return { x: (-this.sun[0] / len) * amount, z: (-this.sun[2] / len) * amount };
  }

  /** Ground offset of a cast shadow for an object at the given altitude. */
  private airShadowOffset(altitude: number): { x: number; z: number } {
    const sunY = Math.max(0.25, this.sun[1]);
    return { x: (-this.sun[0] / sunY) * altitude, z: (-this.sun[2] / sunY) * altitude };
  }

  /**
   * Flat cast shadow for a tall structure: four overlapping slices of the same
   * soft quad, stepped along the sun's ground direction. There is no shadow map
   * and no extra program; the tip is the projection of the authored mesh top,
   * so the cast follows the real geometry instead of a per-building constant.
   * Strength is faded by time of day and weather, keeping dusk and night quiet.
   */
  private pushCastShadow(
    shadows: GpuShadow[],
    x: number,
    y: number,
    z: number,
    footprintW: number,
    footprintH: number,
    defId: string,
  ): void {
    const height = buildingTopHeight(defId);
    if (height <= 2.5) return;
    const strength = this.castShadowStrength();
    if (strength <= 0) return;
    const tip = this.airShadowOffset(height * 0.85);
    const halfW = (footprintW * TILE_SIZE) / 2;
    const halfH = (footprintH * TILE_SIZE) / 2;
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      shadows.push({
        x: x + tip.x * t,
        y,
        z: z + tip.z * t,
        rx: halfW * (1.14 - 0.4 * t) + 0.6,
        rz: halfH * (1.02 - 0.3 * t) + 0.6,
        rotation: 0,
        alpha: 0.4 * strength,
      });
    }
  }

  /** How strongly a structure's cast shadow reads, by time of day and weather. */
  private castShadowStrength(): number {
    const tod = this.scenario?.settings.timeOfDay ?? 'dusk';
    const time = tod === 'day' ? 1 : tod === 'dawn' ? 0.66 : tod === 'night' ? 0.3 : 0.58;
    // Overcast and precipitation diffuse the sun: under a storm the sky is the
    // light source, so a hard cast shadow would be a lie. The profile says how
    // much of the sun survives, and the time of day scales what is left.
    return time * this.weather.shadow;
  }

  /** Ground height for a shadow, lifting it clear of the water surface at sea. */
  private shadowGroundY(x: number, z: number): number {
    if (!this.scenario) return 0;
    return isWaterAt(this.scenario, x, z) ? 0.2 : tileWorldHeight(this.scenario, x, z) + 0.09;
  }

  private drawGroundDecals(): void {
    if (!this.settings.effects || !this.scenario) return;
    const decals = this.decalScratch;
    decals.length = 0;
    for (const decal of this.decals.decals) {
      if (!(decalAlpha(decal) > 0)) continue;
      // Persistent marks must not reveal ground the local team cannot see.
      if (this.game && !this.pointVisible(this.game, decal.x, decal.z)) continue;
      decals.push(decal);
    }
    this.decalGpu.draw(this.camera, decals);
  }

  private drawShadows(): void {
    if (!this.scenario || !this.settings.shadows) return;
    const shadows = this.shadowScratch;
    shadows.length = 0;
    if (this.game) {
      const game = this.game;
      const team = game.teamOf(game.localPlayerId);
      for (const e of game.state.entities) {
        if (e.hp <= 0) continue;
        if (e.kind === 'unit' && e.garrisonId) continue;
        if (!game.isVisibleTo(team, e.id)) continue;
        const building = BUILDINGS[e.defId];
        const def = building ? null : UNITS[e.defId];
        if (!building && !def) continue;
        if (def?.domain === 'naval') continue;
        const v = this.visuals.get(e.id);
        const x = v?.x ?? e.x;
        const z = v?.z ?? e.z;
        if (def?.domain === 'air' && !e.aircraft?.landed) {
          const [rx, rz] = unitShadowRadius(e.defId);
          const offset = this.airShadowOffset(AIR_UNIT_ALTITUDE);
          const sx = x + offset.x;
          const sz = z + offset.z;
          shadows.push({
            x: sx,
            y: this.shadowGroundY(sx, sz),
            z: sz,
            rx: rx * 1.25,
            rz: rz * 1.25,
            rotation: -(v?.facing ?? e.facing),
            alpha: 0.72,
          });
          continue;
        }
        const y = tileWorldHeight(this.scenario, x, z) + 0.09;
        if (building) {
          const f = building.footprint;
          const lean = this.shadowLean(1.4);
          shadows.push({
            x: x + lean.x,
            y,
            z: z + lean.z,
            rx: (f.w * TILE_SIZE) / 2 * 1.28 + 1.0,
            rz: (f.h * TILE_SIZE) / 2 * 1.28 + 1.0,
            rotation: 0,
            alpha: 1,
          });
          this.pushCastShadow(shadows, x, y, z, f.w, f.h, e.defId);
        } else {
          const [rx, rz] = unitShadowRadius(e.defId);
          const lean = this.shadowLean(0.55);
          const growth = e.construction ? 0.7 : 1.32;
          const marker = unitGroundMarker(e.defId);
          if (marker) {
            // Foot units are only a few pixels wide at battle zoom. A soft
            // alliance-coloured pool under the contact shadow marks presence
            // and ownership without scaling the body or adding a draw call.
            shadows.push({
              x,
              y,
              z,
              rx: marker.rx * growth,
              rz: marker.rz * growth,
              rotation: -(v?.facing ?? e.facing),
              alpha: marker.alpha,
              color: this.teamColorOf(game, e.owner),
            });
          }
          shadows.push({
            x: x + lean.x,
            y,
            z: z + lean.z,
            rx: rx * growth,
            rz: rz * growth,
            rotation: -(v?.facing ?? e.facing),
            alpha: e.defId === 'rifle' || e.defId === 'atgm' ? 0.82 : 0.95,
          });
        }
      }
    } else {
      for (const s of this.scenario.structures) {
        const def = BUILDINGS[s.defId];
        if (!def) continue;
        const center = footprintCenter(s.defId, s.x, s.z);
        const lean = this.shadowLean(1.4);
        const groundY = tileWorldHeight(this.scenario, center.x, center.z) + 0.09;
        shadows.push({
          x: center.x + lean.x,
          y: groundY,
          z: center.z + lean.z,
          rx: (def.footprint.w * TILE_SIZE) / 2 * 1.28 + 1.0,
          rz: (def.footprint.h * TILE_SIZE) / 2 * 1.28 + 1.0,
          rotation: 0,
          alpha: 1,
        });
        this.pushCastShadow(
          shadows,
          center.x,
          groundY,
          center.z,
          def.footprint.w,
          def.footprint.h,
          s.defId,
        );
      }
      for (const u of this.scenario.units) {
        const def = UNITS[u.defId];
        if (!def || def.domain === 'naval') continue;
        const x = (u.x + 0.5) * TILE_SIZE;
        const z = (u.z + 0.5) * TILE_SIZE;
        const [rx, rz] = unitShadowRadius(u.defId);
        if (def.domain === 'air') {
          const offset = this.airShadowOffset(AIR_UNIT_ALTITUDE);
          const sx = x + offset.x;
          const sz = z + offset.z;
          shadows.push({
            x: sx,
            y: this.shadowGroundY(sx, sz),
            z: sz,
            rx: rx * 1.25,
            rz: rz * 1.25,
            rotation: -0.6,
            alpha: 0.72,
          });
          continue;
        }
        const lean = this.shadowLean(0.55);
        const marker = unitGroundMarker(u.defId);
        if (marker) {
          shadows.push({
            x,
            y: tileWorldHeight(this.scenario, x, z) + 0.09,
            z,
            rx: marker.rx * 1.32,
            rz: marker.rz * 1.32,
            rotation: -0.6,
            alpha: marker.alpha,
            color: this.teamColorScenario(u.owner),
          });
        }
        shadows.push({
          x: x + lean.x,
          y: tileWorldHeight(this.scenario, x, z) + 0.09,
          z: z + lean.z,
          rx: rx * 1.32,
          rz: rz * 1.32,
          rotation: -0.6,
          alpha: u.defId === 'rifle' || u.defId === 'atgm' ? 0.82 : 0.95,
        });
      }
    }
    for (const s of this.propShadows) shadows.push(s);
    this.shadowGpu.draw(this.camera, shadows, 0.62);
  }

  /** Cache the static ground shadows for terrain props; ore is refreshed on depletion. */
  private rebuildPropShadows(): void {
    if (!this.scenario) return;
    const out: GpuShadow[] = [];
    for (const tree of this.treeInstances) {
      const s = tree.scale;
      const lean = this.shadowLean(1.5 * s);
      out.push({
        x: tree.x + lean.x,
        y: tree.y + 0.09,
        z: tree.z + lean.z,
        rx: 2.05 * s,
        rz: 1.9 * s,
        rotation: 0,
        alpha: 0.85,
      });
    }
    for (const rock of this.rockInstances) {
      const s = rock.scale;
      const lean = this.shadowLean(0.5 * s);
      out.push({
        x: rock.x + lean.x,
        y: rock.y + 0.09,
        z: rock.z + lean.z,
        rx: 1.55 * s,
        rz: 1.25 * s,
        rotation: 0,
        alpha: 0.9,
      });
    }
    for (const bush of this.bushInstances) {
      const s = bush.scale;
      const lean = this.shadowLean(0.4 * s);
      out.push({
        x: bush.x + lean.x,
        y: bush.y + 0.07,
        z: bush.z + lean.z,
        rx: 0.95 * s,
        rz: 0.8 * s,
        rotation: 0,
        alpha: 0.62,
      });
    }
    for (const shrub of this.shrubInstances) {
      const s = shrub.scale;
      const lean = this.shadowLean(0.5 * s);
      out.push({
        x: shrub.x + lean.x,
        y: shrub.y + 0.07,
        z: shrub.z + lean.z,
        rx: 0.62 * s,
        rz: 0.55 * s,
        rotation: 0,
        alpha: 0.55,
      });
    }
    for (const fence of this.fenceInstances) {
      const s = fence.scale;
      const lean = this.shadowLean(0.22 * s);
      out.push({
        x: fence.x + lean.x,
        y: fence.y + 0.07,
        z: fence.z + lean.z,
        rx: 1.25 * s,
        rz: 0.22 * s,
        rotation: fence.rotation,
        alpha: 0.55,
      });
    }
    for (const lamp of this.lampInstances) {
      const lean = this.shadowLean(0.5);
      out.push({
        x: lamp.x + lean.x,
        y: lamp.y + 0.07,
        z: lamp.z + lean.z,
        rx: 0.32,
        rz: 0.26,
        rotation: 0,
        alpha: 0.6,
      });
    }
    for (const sign of this.signInstances) {
      const lean = this.shadowLean(0.4 * sign.scale);
      out.push({
        x: sign.x + lean.x,
        y: sign.y + 0.07,
        z: sign.z + lean.z,
        rx: 0.55 * sign.scale,
        rz: 0.2 * sign.scale,
        rotation: sign.rotation,
        alpha: 0.5,
      });
    }
    for (const heap of this.rubbleInstances) {
      const s = heap.scale;
      const lean = this.shadowLean(0.2 * s);
      out.push({
        x: heap.x + lean.x,
        y: heap.y + 0.07,
        z: heap.z + lean.z,
        rx: 1.1 * s,
        rz: 0.95 * s,
        rotation: heap.rotation,
        alpha: 0.7,
      });
    }
    for (const pole of this.poleInstances) {
      // A tall pole throws a long thin shadow: the sun direction is what makes
      // a telegraph run read as standing up rather than painted on.
      const lean = this.shadowLean(1.6 * pole.scale);
      out.push({
        x: pole.x + lean.x,
        y: pole.y + 0.07,
        z: pole.z + lean.z,
        rx: 0.35,
        rz: 0.35,
        rotation: 0,
        alpha: 0.55,
      });
    }
    for (const ore of this.oreInstances) {
      const s = ore.scale;
      const lean = this.shadowLean(0.12 * s);
      out.push({
        x: ore.x + lean.x,
        y: ore.y + 0.07,
        z: ore.z + lean.z,
        rx: 1.12 * s,
        rz: 0.92 * s,
        rotation: 0,
        alpha: 0.7,
      });
    }
    this.propShadows = out;
  }

  private drawScenarioEntities(): void {
    if (!this.scenario) return;
    const gl = this.gl;
    const mp = this.meshProgram;
    gl.useProgram(mp.program);
    this.setCameraUniforms(mp);
    gl.uniform3fv(mp.u.uSun, this.sun);
    gl.uniform1f(mp.u.uAmbient, this.ambient);
    gl.uniform3f(mp.u.uTint, 1, 1, 1);
    // Entities carry their own charting alpha; the shader fog is for roads.
    gl.uniform1f(mp.u.uUseFog, 0);
    gl.uniform1f(mp.u.uSilhouette, 0);
    gl.uniform1f(mp.u.uDepthPull, 0);
    // A scenario preview is not a lit battlefield: no windows glow off the clock.
    gl.uniform1f(mp.u.uNightGlow, 0);
    this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    bindTextureUnit(gl, MESH_MATERIAL_TEXTURE_UNIT, this.materialTexture, mp.u.uMatLut ?? null);
    for (const s of this.scenario.structures) {
      const def = BUILDINGS[s.defId];
      if (!def) continue;
      const center = footprintCenter(s.defId, s.x, s.z);
      const y = tileWorldHeight(this.scenario, center.x, center.z);
      this.drawStaticMesh(def.id, true, s.owner, center.x, y, center.z, s.facing ?? 0, 0, 1, 0, false);
    }
    for (const u of this.scenario.units) {
      const def = UNITS[u.defId];
      if (!def) continue;
      const x = (u.x + 0.5) * TILE_SIZE;
      const z = (u.z + 0.5) * TILE_SIZE;
      const y = def.domain === 'air' ? AIR_UNIT_ALTITUDE : tileWorldHeight(this.scenario, x, z);
      this.drawStaticMesh(def.id, false, u.owner, x, y, z, -0.6, -0.6, 1, 0, false);
    }
    gl.disable(gl.BLEND);
  }

  private drawStaticMesh(
    defId: string,
    building: boolean,
    owner: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    turret: number,
    alpha: number,
    flash: number,
    construction: boolean,
  ): void {
    const gl = this.gl;
    const mp = this.meshProgram;
    const style = building ? null : unitStyle(defId) ?? FALLBACK_STYLE;
    const buildingRig = building ? this.buildingMeshes.get(defId) ?? this.buildingMeshes.get('commandPost') : null;
    const body = building ? buildingRig?.body : this.unitMeshes.get(defId)?.body;
    if (!body) return;
    const team = this.game ? this.teamColorOf(this.game, owner) : this.teamColorScenario(owner);
    const vs = building ? 1 : unitVisualScale(defId);
    const vertical = construction ? 0.4 : 1;
    const model = modelFor(x, y, z, -facing, vs * vertical, vs * vertical);
    gl.uniformMatrix4fv(mp.u.uModel, false, model);
    gl.uniform3fv(mp.u.uTeamColor, team);
    gl.uniform1f(mp.u.uAlpha, alpha);
    gl.uniform1f(mp.u.uFlash, flash);
    this.bindFlagTexture();
    if (construction) {
      gl.enable(gl.BLEND);
      gl.depthMask(true);
    }
    body.draw();
    if (building && buildingRig?.turret) {
      const tm = turretModelMatrix(x, y, z, facing, turret, buildingRig.turretOffset, 1, vertical);
      gl.uniformMatrix4fv(mp.u.uModel, false, tm);
      buildingRig.turret.draw();
      gl.uniformMatrix4fv(mp.u.uModel, false, model);
    }
    // Previews and prop passes show every part at rest: no clock, no queue.
    if (building && buildingRig) {
      this.drawBuildingParts(buildingRig, x, y, z, 0, 0, vertical, facing);
      if (!construction && owner >= 0) {
        const factionId = this.scenario?.players.find((p) => p.id === owner)?.factionId;
        const flagNation = factionId ? flagNationForFaction(factionId) : undefined;
        if (flagNation) {
          this.drawBuildingFlags(
            buildingRig,
            flagNation,
            this.flagColorFor(owner, factionId),
            x,
            y,
            z,
            facing,
            alpha,
            vertical,
            false,
          );
        }
      }
    }
    if (!building && style?.infantry) {
      const legMesh = this.unitMeshes.get(defId)?.leg;
      if (legMesh) {
        for (const side of [1, -1]) {
          const hip: Vec3 = [style.infantry.hip[0], style.infantry.hip[1], style.infantry.hip[2] * side];
          const lm = limbModelMatrix(x, y, z, facing, hip, 0.15 * side, vs);
          gl.uniformMatrix4fv(mp.u.uModel, false, lm);
          legMesh.draw();
        }
        gl.uniformMatrix4fv(mp.u.uModel, false, model);
      }
    }
    if (!building && style && style.turret) {
      const turretMesh = this.unitMeshes.get(defId)?.turret;
      if (turretMesh) {
        const tm = turretModelMatrix(x, y, z, facing, turret, style.turretOffset, vs, vs);
        gl.uniformMatrix4fv(mp.u.uModel, false, tm);
        turretMesh.draw();
      }
    }
  }

  /**
   * Persistent, bounded burn-off from the wreck list. Smoke is emitted for as
   * long as the hull survives the cap; the visible flame is limited to the
   * first half-minute so a field of old wrecks does not turn into a bonfire.
   * The gameplay-vision gate is the same one used to draw the hull, so a wreck
   * in fog cannot reveal itself through smoke.
   */
  private updateWreckEffects(dt: number, game: Game): void {
    if (!this.settings.effects) return;
    for (const wreck of this.wrecks.wrecks) {
      const age = (wreck.age ?? 0) + dt;
      wreck.age = age;
      if (!this.pointVisible(game, wreck.x, wreck.z)) continue;
      wreck.smokeTimer = (wreck.smokeTimer ?? 0) - dt;
      if (wreck.smokeTimer <= 0) {
        wreck.smokeTimer = 0.9;
        this.particles.smoke(wreck.x, wreck.y + 0.7, wreck.z, 1, 0.12);
      }
      if (age >= 25) continue;
      wreck.fireTimer = (wreck.fireTimer ?? 0) - dt;
      if (wreck.fireTimer <= 0) {
        wreck.fireTimer = 0.38;
        this.particles.wreckFlame(wreck.x, wreck.y + 0.45, wreck.z, 1);
      }
    }
  }

  /**
   * Screen smoke, drawn from the authoritative cloud list.
   *
   * The renderer owns no smoke state: position, radius and expiry all come from
   * the simulation, so the cloud a player sees is the cloud the vision pass
   * tested. Emission is throttled per cloud instead of per frame, and the last
   * third of the cloud's life thins the emission so the fade follows the clock
   * rather than a client-side timer. Clouds in fog emit nothing, exactly like a
   * wreck: a screen cannot reveal the hull that laid it.
   */
  private updateSmokeClouds(dt: number, game: Game): void {
    if (this.settings.effects) {
      const seen = new Set<number>();
      for (const cloud of game.smokeClouds) {
        seen.add(cloud.id);
        const remaining = cloud.expiresTick - game.state.tick;
        if (remaining <= 0) continue;
        if (!this.pointVisible(game, cloud.x, cloud.z)) continue;
        const total = Math.max(1, cloud.expiresTick - cloud.startTick);
        const density = Math.min(1, remaining / (total * 0.4));
        const timer = (this.smokeEmitTimers.get(cloud.id) ?? 0) - dt;
        if (timer > 0) {
          this.smokeEmitTimers.set(cloud.id, timer);
          continue;
        }
        this.smokeEmitTimers.set(cloud.id, 0.15);
        const groundY = tileWorldHeight(this.scenario!, cloud.x, cloud.z);
        this.particles.smokeScreen(cloud.x, groundY + 0.5, cloud.z, cloud.radius, density);
      }
      for (const id of [...this.smokeEmitTimers.keys()]) {
        if (!seen.has(id)) this.smokeEmitTimers.delete(id);
      }
    }
  }

  /**
   * Hulks of destroyed land vehicles. They are drawn from the existing unit
   * body mesh with a charred tint: no new geometry, no entity, no collision,
   * no picking and no save entry. The cap keeps a long match bounded.
   */
  private drawWrecks(game: Game): void {
    if (this.wrecks.length === 0) return;
    const gl = this.gl;
    const mp = this.meshProgram;
    gl.useProgram(mp.program);
    this.setCameraUniforms(mp);
    gl.uniform3fv(mp.u.uSun, this.sun);
    gl.uniform1f(mp.u.uAmbient, this.ambient);
    gl.uniform1f(mp.u.uUseFog, 0);
    gl.uniform1f(mp.u.uSilhouette, 0);
    gl.uniform1f(mp.u.uDepthPull, 0);
    this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT);
    gl.uniform3f(mp.u.uTeamColor, 0.17, 0.17, 0.15);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bindFlagTexture();
    for (const wreck of this.wrecks.wrecks) {
      if (!this.pointVisible(game, wreck.x, wreck.z)) continue;
      const body = this.unitMeshes.get(wreck.defId)?.body;
      if (!body) continue;
      const vs = unitVisualScale(wreck.defId);
      const model = modelFor(wreck.x, wreck.y, wreck.z, -wreck.facing, vs, vs);
      gl.uniformMatrix4fv(mp.u.uModel, false, model);
      gl.uniform3f(mp.u.uTint, 0.4, 0.36, 0.3);
      gl.uniform1f(mp.u.uAlpha, 0.9);
      gl.uniform1f(mp.u.uFlash, 0);
      body.draw();
    }
    gl.uniform3f(mp.u.uTint, 1, 1, 1);
  }

  /**
   * Additive glow left on a hull by a rank-up. It dies away faster than the hit
   * flash so the two never read as the same event, and a spent id is dropped so
   * a long battle cannot accumulate them.
   */
  private promotionFlash(id: number): number {
    const at = this.promotionFlashes.get(id);
    if (at === undefined) return 0;
    const since = this.time - at;
    const duration = 1.15;
    if (since < 0 || since >= duration) {
      this.promotionFlashes.delete(id);
      return 0;
    }
    const remaining = 1 - since / duration;
    return 1.05 * remaining * remaining;
  }

  private drawBattleEntities(game: Game): void {
    const gl = this.gl;
    const mp = this.meshProgram;
    gl.useProgram(mp.program);
    this.setCameraUniforms(mp);
    gl.uniform3fv(mp.u.uSun, this.sun);
    gl.uniform1f(mp.u.uAmbient, this.ambient);
    gl.uniform3f(mp.u.uTint, 1, 1, 1);
    // Entities carry their own charting alpha; the shader fog is for roads.
    gl.uniform1f(mp.u.uUseFog, 0);
    gl.uniform1f(mp.u.uSilhouette, 0);
    gl.uniform1f(mp.u.uDepthPull, 0);
    this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bindFlagTexture();
    bindTextureUnit(gl, MESH_MATERIAL_TEXTURE_UNIT, this.materialTexture, mp.u.uMatLut ?? null);
    const team = game.teamOf(game.localPlayerId);
    for (const e of game.state.entities) {
      // A shot-out bridge stays on the map as wreckage, so it is still drawn:
      // the closed crossing has to be visible to both sides.
      const collapsedSpan = e.kind === 'building' && e.hp <= 0 && !!BUILDINGS[e.defId]?.walkable;
      if (e.hp <= 0 && !collapsedSpan) continue;
      if (e.kind === 'unit' && e.garrisonId) continue;
      // Units are only ever drawn in vision. A structure the team has charted
      // stays on the map as a dimmed silhouette once it leaves vision, and a
      // structure never seen is not drawn at all.
      const vision = game.visionStateOf(team, e.id);
      if (vision === 'hidden') continue;
      const remembered = vision === 'remembered';
      const v = this.visuals.get(e.id);
      const x = v?.x ?? e.x;
      const z = v?.z ?? e.z;
      const facing = v?.facing ?? e.facing;
      const turret = remembered ? e.facing : v?.turret ?? e.turretFacing;
      const def = BUILDINGS[e.defId] ? null : UNITS[e.defId];
      const isAir = def?.domain === 'air';
      // A unit crossing a bridge stands on the deck, not on the sea bed the
      // terrain surface reports under it.
      const groundY = game.deckHeightAt(x, z) ?? tileWorldHeight(this.scenario!, x, z);
      const alt = v?.emergeAlt ?? 1;
      const y = isAir
        ? e.aircraft?.landed
          ? groundY + 0.25
          : groundY +
            0.25 +
            (AIR_UNIT_ALTITUDE - groundY - 0.25) * alt +
            Math.sin(this.time * 1.7 + e.id) * 0.16 * alt
        : groundY + (def?.domain === 'naval' ? 0.12 : 0);
      const bob = def?.domain === 'naval' ? Math.sin(this.time * 1.2 + e.id * 0.7) * 0.06 : 0;
      const hitFlash = !remembered && game.state.tick - e.lastHitTick < 3 ? 0.75 : 0;
      const flash = Math.max(hitFlash, remembered ? 0 : this.promotionFlash(e.id));
      // An occupied shelter switches to its garrisoned model and takes the trim
      // colour of the infantry inside, whoever owns the building itself. A
      // remembered structure shows the shape that was charted, not live state.
      const occupants =
        !remembered && e.kind === 'building' && BUILDINGS[e.defId]?.garrison
          ? game.garrisonOccupants(e.id)
          : [];
      const garrisonOwner = occupants.length > 0 ? occupants[0].owner : null;
      const construction = e.construction;
      // A fresh site is groundworks, not a quarter-built shell: the mesh starts
      // at roughly a tenth of its height and grows into the frame from there.
      const progress = construction ? 0.04 + e.buildProgress * 0.96 : 1;
      const liveAlpha = construction ? 0.72 : e.hp / e.maxHp < 0.25 ? 0.94 : 1;
      const alpha = remembered ? 0.46 : liveAlpha;
      // A charted structure is memory, not sight, and it has to read that way at
      // a glance: half alpha alone left a garrisonable tenement looking exactly
      // as solid and as brightly trimmed as a building the team can see right
      // now. The cold, desaturated tint is the fog of war's own colour, and it
      // applies to every structure on the map — torch-lit objectives included.
      gl.uniform3f(
        mp.u.uTint,
        remembered ? 0.52 : 1,
        remembered ? 0.6 : 1,
        remembered ? 0.66 : 1,
      );
      // Moving parts are frozen on a remembered silhouette: the shape that was
      // charted is all the team can know, not what it is doing now.
      const rig = e.kind === 'building' ? this.buildingMeshes.get(e.defId) : null;
      const doorOpen = rig?.door && !remembered ? v?.door ?? 0 : 0;
      const rotorAngle = rig?.rotor && !remembered ? this.time * rig.rotorRate + e.id * 0.9 : 0;
      this.drawEntityMesh(
        e.kind,
        e.defId,
        e.owner,
        x,
        y + bob,
        z,
        facing,
        turret,
        construction ? 0.06 + progress * 0.94 : 1,
        alpha,
        flash,
        construction,
        e.harvester ? Math.min(1, e.harvester.ore / HARVESTER_CAPACITY) : 0,
        {
          gait: v?.gait ?? 0,
          pace: v?.pace ?? 0,
          elevation: v?.elevation ?? 0,
          motion: v?.motion ?? e.facing,
          moving: e.state === 'moving' || e.path.length > 0,
        },
        garrisonOwner,
        doorOpen,
        rotorAngle,
        remembered,
        !remembered && !!e.submarine?.dived,
        // A shot-out bridge is drawn as wreckage rather than removed: the
        // crossing is closed, and the span is what shows it.
        e.kind === 'building' && e.hp <= 0 && !!BUILDINGS[e.defId]?.walkable,
      );
    }
    gl.uniform3f(mp.u.uTint, 1, 1, 1);
    gl.disable(gl.BLEND);
  }

  /**
   * Flat team-coloured silhouettes for units hidden behind a structure.
   *
   * The pass re-draws the unit bodies with a GREATER depth test and a small pull
   * toward the camera in view depth, so a pixel is written only where something
   * sits just in front of the unit: the wall of a building between the camera
   * and the infantryman, not a ridge several tiles further down the view.
   * Visibility is the same test the main pass uses, so a silhouette can never
   * reveal fog or ground the team has not seen. Bodies only: no flags, no
   * wrecks, no props and no extra draw call per unit.
   */
  private drawOccludedUnits(game: Game): void {
    const gl = this.gl;
    const mp = this.meshProgram;
    gl.useProgram(mp.program);
    this.setCameraUniforms(mp);
    gl.uniform3fv(mp.u.uSun, this.sun);
    gl.uniform1f(mp.u.uAmbient, this.ambient);
    gl.uniform3f(mp.u.uTint, 1, 1, 1);
    gl.uniform1f(mp.u.uUseFog, 0);
    this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT);
    gl.uniform1f(mp.u.uSilhouette, 1);
    gl.uniform1f(mp.u.uDepthPull, SILHOUETTE_DEPTH_PULL);
    gl.uniform1f(mp.u.uFlash, 0);
    gl.depthFunc(gl.GREATER);
    gl.depthMask(false);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    const team = game.teamOf(game.localPlayerId);
    for (const e of game.state.entities) {
      if (e.kind !== 'unit' || e.hp <= 0 || e.garrisonId) continue;
      if (e.submarine?.dived) continue;
      if (game.visionStateOf(team, e.id) !== 'visible') continue;
      const v = this.visuals.get(e.id);
      const x = v?.x ?? e.x;
      const z = v?.z ?? e.z;
      // Timber hides a unit with foliage rather than with a structure; an
      // outline there would wash across the canopy instead of reading as a
      // body behind a wall.
      const map = game.state.scenario;
      const tx = Math.floor(x / TILE_SIZE);
      const tz = Math.floor(z / TILE_SIZE);
      if (tx < 0 || tz < 0 || tx >= map.width || tz >= map.height) continue;
      if (map.tiles[tileIndex(map.width, tx, tz)].t === Terrain.Forest) continue;
      const def = UNITS[e.defId];
      const groundY = tileWorldHeight(this.scenario!, x, z);
      const y =
        def?.domain === 'air' && !e.aircraft?.landed
          ? groundY + 0.25 + (AIR_UNIT_ALTITUDE - groundY - 0.25) * (v?.emergeAlt ?? 1)
          : groundY + (def?.domain === 'naval' ? 0.12 : 0);
      this.drawEntityMesh(
        'unit',
        e.defId,
        e.owner,
        x,
        y,
        z,
        v?.facing ?? e.facing,
        v?.turret ?? e.turretFacing,
        1,
        SILHOUETTE_ALPHA,
        0,
        false,
        0,
        {
          gait: v?.gait ?? 0,
          pace: v?.pace ?? 0,
          elevation: v?.elevation ?? 0,
          motion: v?.motion ?? e.facing,
          moving: false,
        },
      );
    }
    gl.depthMask(true);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.uniform1f(mp.u.uSilhouette, 0);
    gl.uniform1f(mp.u.uDepthPull, 0);
  }

  private drawEntityMesh(
    kind: 'unit' | 'building',
    defId: string,
    owner: number,
    x: number,
    y: number,
    z: number,
    facing: number,
    turretFacing: number,
    verticalScale: number,
    alpha: number,
    flash: number,
    construction: boolean,
    loadFill: number,
    anim: { gait: number; pace: number; elevation?: number; motion?: number; moving?: boolean } | null = null,
    garrisonOwner: number | null = null,
    doorOpen = 0,
    rotorAngle = 0,
    remembered = false,
    submerged = false,
    collapsed = false,
  ): void {
    const mp = this.meshProgram;
    const gl = this.gl;
    const team = this.teamColorOf(this.game!, owner);
    // Only a structure's glazing is lit from inside. A vehicle's windscreen
    // shares the glass material but is not a window in a wall.
    gl.uniform1f(
      mp.u.uNightGlow,
      kind === 'building' ? this.buildingWindowGlow(owner, construction, remembered) : 0,
    );
    if (kind === 'building') {
      const rig = this.buildingMeshes.get(defId);
      if (!rig) return;
      const occupied = collapsed && rig.ruined
        ? rig.ruined
        : garrisonOwner !== null && rig.garrisoned
          ? rig.garrisoned
          : rig.body;
      const model = modelFor(x, y, z, -facing, 1, verticalScale);
      gl.uniformMatrix4fv(mp.u.uModel, false, model);
      gl.uniform3fv(
        mp.u.uTeamColor,
        garrisonOwner !== null ? this.teamColorOf(this.game!, garrisonOwner) : team,
      );
      gl.uniform1f(mp.u.uAlpha, alpha);
      gl.uniform1f(mp.u.uFlash, flash);
      occupied.draw();
      if (rig.turret) {
        // Mount height and mesh both follow the construction squash, so a gun
        // sits on the revetment that exists instead of hovering over it.
        gl.uniformMatrix4fv(
          mp.u.uModel,
          false,
          turretModelMatrix(x, y, z, facing, turretFacing, rig.turretOffset, 1, verticalScale),
        );
        rig.turret.draw();
      }
      this.drawBuildingParts(rig, x, y, z, doorOpen, rotorAngle, verticalScale, facing);
      const flagOwner = flagOwnerForBuilding(owner, garrisonOwner);
      if (!construction && flagOwner >= 0) {
        const factionId = this.game?.player(flagOwner)?.factionId;
        const flagNation = factionId ? flagNationForFaction(factionId) : undefined;
        if (flagNation) {
          this.drawBuildingFlags(
            rig,
            flagNation,
            this.flagColorFor(flagOwner, factionId),
            x,
            y,
            z,
            facing,
            alpha,
            verticalScale,
            remembered,
          );
        }
      }
      // No translucent full-height ghost here: the construction outline is the
      // building's own wireframe, drawn by the overlay, while this mesh grows.
      return;
    }
    const style = this.unitMeshes.get(defId);
    if (!style) return;
    const vs = unitVisualScale(defId) * verticalScale;
    // A unit with no turret mesh aims with its whole body; a turreted hull
    // keeps its own heading; an airframe follows its flight heading.
    const airframe = UNITS[defId]?.domain === 'air';
    let bodyFacing = unitBodyHeading(!!style.turret, airframe, facing, turretFacing);
    if (
      !airframe &&
      anim?.moving &&
      anim.motion !== undefined &&
      UNITS[defId]?.moveClass !== 'foot'
    ) {
      bodyFacing = anim.motion;
    }
    if (submerged) {
      const periscope = style.periscope;
      if (!periscope) return;
      const offset = style.periscopeOffset ?? [0, 0, 0];
      gl.uniformMatrix4fv(
        mp.u.uModel,
        false,
        modelFor(x, y + offset[1] * vs, z, -bodyFacing, vs, vs),
      );
      gl.uniform3fv(mp.u.uTeamColor, team);
      gl.uniform1f(mp.u.uAlpha, alpha);
      gl.uniform1f(mp.u.uFlash, flash);
      periscope.draw();
      return;
    }
    const model = modelFor(x, y, z, -bodyFacing, vs, vs);
    gl.uniformMatrix4fv(mp.u.uModel, false, model);
    gl.uniform3fv(mp.u.uTeamColor, team);
    gl.uniform1f(mp.u.uAlpha, alpha);
    gl.uniform1f(mp.u.uFlash, flash);
    style.body.draw();
    if (style.load && loadFill > 0.01) {
      const load = this.unitMeshes.get(defId)?.load;
      if (load) {
        const lm = modelFor(x, y + 1.6 * vs, z, -bodyFacing, vs, vs * 0.5 * loadFill);
        gl.uniformMatrix4fv(mp.u.uModel, false, lm);
        load.draw();
        gl.uniformMatrix4fv(mp.u.uModel, false, model);
      }
    }
    if (style.leg) {
      // Legs swing out of phase about the hips, so a walking rifleman reads as
      // walking rather than sliding. Standing pose is a small stride.
      const rig = unitStyle(defId)?.infantry;
      if (rig) {
        const pace = anim?.pace ?? 0;
        const phase = anim?.gait ?? 0;
        const swing = 0.15 + 0.5 * pace * Math.sin(phase);
        for (const side of [1, -1]) {
          const hip: Vec3 = [rig.hip[0], rig.hip[1], rig.hip[2] * side];
          const lm = limbModelMatrix(x, y, z, bodyFacing, hip, swing * side, vs);
          gl.uniformMatrix4fv(mp.u.uModel, false, lm);
          style.leg.draw();
        }
        gl.uniformMatrix4fv(mp.u.uModel, false, model);
      }
    }
    if (style.turret) {
      const offset = this.turretOffset(defId);
      const pitch = (style.launcherElevation ?? 0) * (anim?.elevation ?? 0);
      const tm = turretModelMatrix(
        x,
        y,
        z,
        facing,
        turretFacing,
        offset,
        vs,
        vs,
        pitch,
        style.launcherPivot,
      );
      gl.uniformMatrix4fv(mp.u.uModel, false, tm);
      style.turret.draw();
    }
  }

  /**
   * Animated building parts. The mast parts sweep about their own mount and the
   * shutter rides straight up out of its bay; both are drawn after the body so
   * they never need a second pass.
   *
   * `verticalScale` has to be applied here as well as to the body: a structure
   * under construction is drawn short, and parts pinned at their finished
   * height would hang in the air above the half-built shell.
   */
  private drawBuildingParts(
    rig: {
      door: StaticMesh | null;
      doorOffset: Vec3;
      doorRetract: number;
      rotor: StaticMesh | null;
      rotorOffset: Vec3;
    },
    x: number,
    y: number,
    z: number,
    doorOpen: number,
    rotorAngle: number,
    verticalScale: number,
    facing: number,
  ): void {
    const gl = this.gl;
    const mp = this.meshProgram;
    if (rig.rotor) {
      const mount = rotateLocalOffset(rig.rotorOffset[0], rig.rotorOffset[2], facing);
      gl.uniformMatrix4fv(
        mp.u.uModel,
        false,
        modelFor(
          x + mount.x,
          y + rig.rotorOffset[1] * verticalScale,
          z + mount.z,
          rotorAngle - facing,
          1,
          verticalScale,
        ),
      );
      rig.rotor.draw();
    }
    if (rig.door) {
      // Scaled about its top edge, so the shutter rolls up into the bay head.
      const height = Math.max(0.05, 1 - doorOpen * rig.doorRetract) * verticalScale;
      const mount = rotateLocalOffset(rig.doorOffset[0], rig.doorOffset[2], facing);
      gl.uniformMatrix4fv(
        mp.u.uModel,
        false,
        modelFor(
          x + mount.x,
          y + rig.doorOffset[1] * verticalScale,
          z + mount.z,
          -facing,
          1,
          height,
        ),
      );
      rig.door.draw();
    }
  }

  /**
   * Draw the pole, alliance colour and real national flag. The rig is separate
   * from the building so the cloth can wave every frame without rebuilding the
   * structure. Remembered silhouettes show the colours but hold the cloth
   * still, matching the frozen rotors and shutters elsewhere.
   */
  private drawBuildingFlags(
    rig: { flagMount: Vec3 },
    flagNation: string,
    factionColor: Vec3,
    x: number,
    y: number,
    z: number,
    facing: number,
    alpha: number,
    verticalScale: number,
    remembered: boolean,
  ): void {
    const mesh = this.flagMeshes.get(flagNation);
    if (!mesh || !this.bindFlagTexture(flagNation)) return;
    const gl = this.gl;
    const mp = this.meshProgram;
    const mount = rotateLocalOffset(rig.flagMount[0], rig.flagMount[2], facing);
    gl.uniformMatrix4fv(
      mp.u.uModel,
      false,
      modelFor(
        x + mount.x,
        y + rig.flagMount[1] * verticalScale,
        z + mount.z,
        flagWindYaw(),
        1,
        1,
      ),
    );
    gl.uniform3fv(mp.u.uTeamColor, factionColor);
    gl.uniform1f(mp.u.uAlpha, alpha);
    gl.uniform1f(mp.u.uFlash, 0);
    gl.uniform1f(mp.u.uTime, remembered ? 0 : this.time);
    mesh.draw();
    gl.uniform1f(mp.u.uTime, this.time);
  }

  private turretOffset(defId: string): Vec3 {
    const style: EntityStyle | undefined = unitStyle(defId);
    return style?.turretOffset ?? [0, 0, 0];
  }

  private drawParticles(): void {
    const gl = this.gl;
    const additive: GpuParticle[] = [];
    const normal: GpuParticle[] = [];
    for (const p of this.particles.particles) {
      const k = 1 - p.life / p.maxLife;
      const size = p.size0 + (p.size1 - p.size0) * k;
      const fade = p.additive ? Math.max(0, 1 - k * k) : Math.max(0, 1 - k * k * 0.9);
      if (p.additive) {
        additive.push({
          x: p.x, y: p.y, z: p.z, size, r: p.r, g: p.g, b: p.b, a: p.alpha * fade,
          stretch: p.stretch, soft: p.soft,
          dirX: p.dir?.[0], dirY: p.dir?.[1], dirZ: p.dir?.[2],
        });
      } else {
        normal.push({
          x: p.x, y: p.y, z: p.z, size, r: p.r, g: p.g, b: p.b, a: p.alpha * fade,
          stretch: p.stretch, soft: p.soft,
          dirX: p.dir?.[0], dirY: p.dir?.[1], dirZ: p.dir?.[2],
        });
      }
    }
    if (this.game) {
      for (const pr of this.game.state.projectiles) {
        // Fog hiding is a gameplay rule, not a visual toggle: turning the fog
        // texture off must never reveal a hostile projectile the team cannot
        // see. Own-team shells are not hidden information.
        if (!projectileVisibleToLocal(this.game, pr.owner, pr.x, pr.z, pr.shooterId)) continue;
        const profile = weaponFxProfile(pr.weaponId);
        const pos = this.projectilePosition(pr.id, { x: pr.x, y: pr.y, z: pr.z });
        const view = this.projectileViews.get(pr.id);
        let dx = 0;
        let dy = 0;
        let dz = 0;
        if (view) {
          dx = view.current.x - view.previous.x;
          dy = view.current.y - view.previous.y;
          dz = view.current.z - view.previous.z;
        }
        if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) < 0.0001) {
          dx = pr.tx - pos.x;
          dy = pr.ty - pos.y;
          dz = pr.tz - pos.z;
        }
        const len = Math.hypot(dx, dy, dz) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const uz = dz / len;
        const [r, g, b] = profile.tracerColor;
        additive.push({ x: pos.x, y: pos.y, z: pos.z, size: profile.projectileSize, r, g, b, a: 0.92 });
        for (let i = 1; i <= profile.tracerSegments; i++) {
          const t = i / profile.tracerSegments;
          additive.push({
            x: pos.x - ux * profile.tracerLength * t,
            y: pos.y - uy * profile.tracerLength * t,
            z: pos.z - uz * profile.tracerLength * t,
            size: profile.tracerWidth * (1 - 0.35 * t),
            r,
            g,
            b,
            a: 0.55 * (1 - 0.45 * t),
          });
        }
      }
    }
    gl.enable(gl.BLEND);
    this.particleGpu.draw(this.camera, additive, normal);
    gl.disable(gl.BLEND);
  }

  dispose(): void {
    this.particleGpu.dispose();
    this.decalGpu.dispose();
    this.shadowGpu.dispose();
  }
}

function normalizeDiff(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function modelFor(x: number, y: number, z: number, yaw: number, uniform = 1, sy = 1): Float32Array {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const m = new Float32Array(16);
  m[0] = c * uniform;
  m[2] = -s * uniform;
  m[5] = sy;
  m[8] = s * uniform;
  m[10] = c * uniform;
  m[12] = x;
  m[13] = y;
  m[14] = z;
  m[15] = 1;
  return m;
}

export type { MeshBuffers };
