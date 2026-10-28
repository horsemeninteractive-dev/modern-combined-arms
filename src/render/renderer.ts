import { HARVESTER_CAPACITY, TILE_SIZE } from '../sim/constants';
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
import { buildingStyle, FALLBACK_BUILDING } from './buildingMeshes';
import {
  allianceFlagColor,
  buildFlagRig,
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
  FALLBACK_STYLE,
  type EntityStyle,
} from './unitMeshes';
import { buildOreMesh, buildRockMesh, buildTreeMesh } from './geometry';
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
import { ShadowGpu, type GpuShadow } from './shadowGpu';
import type { Vec3 } from './math';
import { teamColorForOwner } from './teamColor';
import { limbModelMatrix, turretModelMatrix, unitBodyHeading } from './unitTransform';
import { rotateLocalOffset } from '../core/math';
import {
  sampleProjectile,
  staticMuzzleAnchor,
  weaponFxProfile,
  type ProjectileSample,
} from './combatFx';

const NEAR = 1;
const FAR = 3000;
const MAX_WRECKS = 24;

interface VisualWreck {
  defId: string;
  x: number;
  y: number;
  z: number;
  facing: number;
}

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
  settings: RenderSettings = { effects: true, shake: true, showFog: true, grid: false };

  private canvas: HTMLCanvasElement;
  private scenario: Scenario | null = null;
  private game: Game | null = null;
  private meshProgram!: MeshProgram;
  private terrainProgram!: MeshProgram;
  private waterProgram!: MeshProgram;
  private propProgram!: MeshProgram;
  private particleGpu: ParticleGpu;
  private shadowGpu: ShadowGpu;
  private propShadows: GpuShadow[] = [];
  private shadowScratch: GpuShadow[] = [];
  private terrainGpu: TerrainGpu | null = null;
  private waterVao: WebGLVertexArrayObject | null = null;
  private roadMesh: StaticMesh | null = null;
  private treesMesh!: InstancedMesh;
  private rocksMesh!: InstancedMesh;
  private oreMesh!: InstancedMesh;
  private treeInstances: PropInstance[] = [];
  private rockInstances: PropInstance[] = [];
  private oreInstances: PropInstance[] = [];
  private fogTexture: WebGLTexture;
  private shoreTexture: WebGLTexture;
  private shoreData: Uint8Array | null = null;
  private fogData: Uint8Array | null = null;
  private lastFogTick = -999;
  private lastOreRefresh = 0;
  private buildingMeshes = new Map<
    string,
    {
      body: StaticMesh;
      garrisoned: StaticMesh | null;
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
    launcherPivot?: Vec3;
    launcherElevation?: number;
  }>();
  private visuals = new Map<number, VisualEntity>();
  /** Presentation-only hulks; never entities, picks, saves or collision. */
  private wrecks: VisualWreck[] = [];
  private trailTimers = new Map<number, number>();
  private projectileTrailTimers = new Map<number, number>();
  private projectileViews = new Map<number, { previous: ProjectileSample; current: ProjectileSample }>();
  private simulationAlpha = 1;
  private lastEventSeq = 0;
  private time = 0;
  private shake = 0;
  private sun: Vec3 = [-0.55, 0.75, 0.35];
  private ambient = 0.4;
  private clearColor: [number, number, number] = [0.027, 0.043, 0.055];
  dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: true, alpha: false, powerPreference: 'high-performance' });
    if (!gl) {
      throw new Error('WebGL2 is required to render Modern Combined Arms. Please enable hardware acceleration or use a current browser.');
    }
    this.gl = gl;
    this.meshProgram = { program: createProgram(gl, MESH_VS, MESH_FS), u: {} };
    this.terrainProgram = { program: createProgram(gl, TERRAIN_VS, TERRAIN_FS), u: {} };
    this.waterProgram = { program: createProgram(gl, WATER_VS, WATER_FS), u: {} };
    this.propProgram = { program: createProgram(gl, PROP_VS, PROP_FS), u: {} };
    this.meshProgram.u = uniformMap(gl, this.meshProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uModel', 'uTeamColor', 'uSun', 'uTint', 'uAmbient', 'uAlpha', 'uFlash',
      'uFogTex', 'uFlagTex', 'uMatLut', 'uUseFog', 'uWorldSize', 'uTime',
    ]);
    this.terrainProgram.u = uniformMap(gl, this.terrainProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uFogTex', 'uShoreTex', 'uUseFog', 'uTime', 'uGrid',
    ]);
    this.waterProgram.u = uniformMap(gl, this.waterProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uFogTex', 'uShoreTex', 'uUseFog', 'uTime', 'uWorldSize',
    ]);
    this.propProgram.u = uniformMap(gl, this.propProgram.program, [
      'uEye', 'uRight', 'uUp', 'uForward', 'uHalf', 'uNear', 'uFar',
      'uSun', 'uAmbient', 'uEmissive', 'uFogTex', 'uMatLut', 'uUseFog', 'uWorldSize',
    ]);
    this.particleGpu = new ParticleGpu(gl);
    this.shadowGpu = new ShadowGpu(gl);

    this.treesMesh = new InstancedMesh(gl, buildTreeMesh());
    this.rocksMesh = new InstancedMesh(gl, buildRockMesh());
    this.oreMesh = new InstancedMesh(gl, buildOreMesh());
    this.fogTexture = this.createTexture();
    this.shoreTexture = this.createTexture();

    for (const id of Object.keys(UNITS)) {
      const style = unitStyle(id);
      if (style) {
        this.unitMeshes.set(id, {
          body: new StaticMesh(gl, style.body),
          turret: style.turret ? new StaticMesh(gl, style.turret) : null,
          leg: style.infantry ? new StaticMesh(gl, style.infantry.leg) : null,
          load: style.load ? new StaticMesh(gl, style.load) : null,
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
    const nav = navigator as Navigator & { maxTouchPoints?: number };
    this.isTouch = (nav.maxTouchPoints ?? 0) > 0;
  }

  isTouch = false;

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
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    const pw = Math.floor(w * dpr);
    const ph = Math.floor(h * dpr);
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.camera.setViewport(w, h);
  }

  setScenario(scenario: Scenario): void {
    this.scenario = scenario;
    this.game = null;
    this.visuals.clear();
    this.wrecks.length = 0;
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
    this.treesMesh.setInstances(this.treeInstances);
    this.rocksMesh.setInstances(this.rockInstances);
    this.oreMesh.setInstances(this.oreInstances);
    this.rebuildPropShadows();
    this.shoreData = buildShoreTexture(scenario);
    // The coast field packs land and water distance into separate channels; the
    // old single-channel upload would silently discard the transition band.
    this.uploadTexture(this.shoreTexture, scenario.width, scenario.height, this.shoreData, true);
    this.fogData = new Uint8Array(scenario.width * scenario.height).fill(255);
    this.uploadTexture(this.fogTexture, scenario.width, scenario.height, this.fogData);
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
    this.wrecks.length = 0;
    this.trailTimers.clear();
    this.projectileTrailTimers.clear();
    this.projectileViews.clear();
    this.particles.clear();
    if (game) {
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

  private applyLighting(): void {
    const tod = this.scenario?.settings.timeOfDay ?? 'dusk';
    if (tod === 'day') {
      this.sun = [-0.42, 0.86, 0.3];
      this.ambient = 0.5;
      this.clearColor = [0.035, 0.055, 0.07];
    } else if (tod === 'dawn') {
      this.sun = [-0.72, 0.55, 0.32];
      this.ambient = 0.36;
      this.clearColor = [0.045, 0.05, 0.065];
    } else if (tod === 'night') {
      this.sun = [-0.35, 0.7, 0.25];
      this.ambient = 0.24;
      this.clearColor = [0.012, 0.02, 0.033];
    } else {
      this.sun = [-0.62, 0.6, 0.38];
      this.ambient = 0.35;
      this.clearColor = [0.03, 0.043, 0.058];
    }
    if (this.scenario?.settings.weather === 'overcast' || this.scenario?.settings.weather === 'rain') {
      this.ambient += 0.06;
      this.sun = [0.2, 0.9, 0.3];
    }
    this.gl.clearColor(...this.clearColor, 1);
  }

  private buildWater(scenario: Scenario): void {
    const gl = this.gl;
    const w = scenario.width * TILE_SIZE;
    const h = scenario.height * TILE_SIZE;
    const y = 0.12;
    const positions = new Float32Array([0, y, 0, w, y, 0, w, y, h, 0, y, h]);
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    const vbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    const ibo = gl.createBuffer()!;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.waterVao = vao;
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

  private updateFog(): void {
    if (!this.scenario) return;
    const game = this.game;
    if (!game) {
      if (!this.fogData || this.fogData[0] !== 255) {
        this.fogData = new Uint8Array(this.scenario.width * this.scenario.height).fill(255);
        this.uploadTexture(this.fogTexture, this.scenario.width, this.scenario.height, this.fogData);
      }
      return;
    }
    if (game.state.tick - this.lastFogTick < 3 && this.lastFogTick >= 0) return;
    this.lastFogTick = game.state.tick;
    const team = game.teamOf(game.localPlayerId);
    const src = game.state.fog[Math.max(0, team)];
    if (!this.fogData || this.fogData.length !== src.length) {
      this.fogData = new Uint8Array(src.length);
    }
    const data = this.fogData;
    if (!game.state.scenario.settings.fog || !this.settings.showFog) {
      data.fill(255);
    } else {
      for (let i = 0; i < src.length; i++) data[i] = src[i] === 2 ? 255 : src[i] === 1 ? 112 : 0;
    }
    this.uploadTexture(this.fogTexture, this.scenario.width, this.scenario.height, data);
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
    this.particles.update(dt);
    this.shake = Math.max(0, this.shake - dt * 1.7);
    if (this.game) {
      this.consumeEvents(this.game);
      this.updateVisuals(dt, this.game);
      this.updateProjectileViews(this.game);
      this.emitAmbientEffects(dt, this.game);
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
    if (!this.scenario?.settings.fog) return true;
    const team = game.teamOf(game.localPlayerId);
    if (team < 0) return true;
    return game.fogAt(team, Math.floor(x / TILE_SIZE), Math.floor(z / TILE_SIZE)) === 2;
  }

  private updateProjectileTrails(dt: number, game: Game): void {
    if (!this.settings.effects) return;
    const seen = new Set<number>();
    for (const p of game.state.projectiles) {
      seen.add(p.id);
      if (!weaponFxProfile(p.weaponId).trailSmoke) continue;
      // A smoking missile beyond the vision boundary is still hidden: the
      // trail is presentation, not a sensor.
      if (!this.pointVisible(game, p.x, p.z)) continue;
      let t = this.projectileTrailTimers.get(p.id) ?? 0;
      t -= dt;
      if (t <= 0) {
        this.particles.smoke(p.x, p.y, p.z, 1, 0.58);
        t = 0.035;
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
    const team = game.teamOf(game.localPlayerId);
    for (const ev of events) {
      if (ev.x === 0 && ev.z === 0) continue;
      const tx = Math.floor(ev.x / TILE_SIZE);
      const tz = Math.floor(ev.z / TILE_SIZE);
      const visible =
        ev.team === game.localPlayerId ||
        !game.state.scenario.settings.fog ||
        game.fogAt(team, tx, tz) === 2;
      if (!visible) continue;
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
          break;
        }
        case 'explosion': {
          const y = ev.y ?? groundY + 0.4;
          const water = ev.surface === 'water' || isWaterAt(this.scenario!, ev.x, ev.z);
          if (water) {
            this.particles.impact(ev.x, y, ev.z, true, profile.impactScale);
          } else {
            this.particles.explosion(ev.x, y, ev.z, profile.explosionScale || 0.8);
            this.addShake(ev.x, ev.z, Math.max(0.04, profile.shake));
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
              if (this.wrecks.length > MAX_WRECKS) this.wrecks.shift();
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

  private teamColorOf(game: Game, owner: number): [number, number, number] {
    return [...teamColorForOwner(owner, game.player(owner)?.factionId)];
  }

  private teamColorScenario(owner: number): [number, number, number] {
    if (!this.scenario) return [...teamColorForOwner(owner, undefined)];
    const p = this.scenario.players.find((pl) => pl.id === owner);
    return [...teamColorForOwner(owner, p?.factionId)];
  }

  render(): void {
    const gl = this.gl;
    if (!this.scenario) {
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      return;
    }
    this.resize();
    this.camera.shakeX = Math.sin(this.time * 91) * this.shake;
    this.camera.shakeY = Math.cos(this.time * 73) * this.shake * 0.6;
    this.camera.update();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(...this.clearColor, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    this.drawTerrain();
    this.drawWater();
    this.drawShadows();
    this.drawProps();
    if (this.game) {
      this.drawBattleEntities(this.game);
      this.drawWrecks(this.game);
    } else {
      this.drawScenarioEntities();
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fogTexture);
    gl.uniform1i(p.u.uFogTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shoreTexture);
    gl.uniform1i(p.u.uShoreTex, 1);
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
      bindTextureUnit(gl, MESH_FOG_TEXTURE_UNIT, this.fogTexture, mp.u.uFogTex);
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
    gl.uniform1f(p.u.uTime, this.time);
    gl.uniform1f(p.u.uUseFog, this.game && this.settings.showFog ? 1 : 0);
    gl.uniform2f(p.u.uWorldSize, this.scenario.width * TILE_SIZE, this.scenario.height * TILE_SIZE);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fogTexture);
    gl.uniform1i(p.u.uFogTex, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shoreTexture);
    gl.uniform1i(p.u.uShoreTex, 1);
    gl.bindVertexArray(this.waterVao);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
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
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fogTexture);
    gl.uniform1i(p.u.uFogTex, 0);
    bindTextureUnit(gl, PROP_MATERIAL_TEXTURE_UNIT, this.materialTexture, p.u.uMatLut ?? null);
    gl.uniform1f(p.u.uEmissive, 0);
    this.treesMesh.draw(this.treeInstances.length);
    this.rocksMesh.draw(this.rockInstances.length);
    gl.uniform1f(p.u.uEmissive, 0.22);
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

  /** Ground height for a shadow, lifting it clear of the water surface at sea. */
  private shadowGroundY(x: number, z: number): number {
    if (!this.scenario) return 0;
    return isWaterAt(this.scenario, x, z) ? 0.2 : tileWorldHeight(this.scenario, x, z) + 0.09;
  }

  private drawShadows(): void {
    if (!this.scenario) return;
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
        } else {
          const [rx, rz] = unitShadowRadius(e.defId);
          const lean = this.shadowLean(0.55);
          const growth = e.construction ? 0.7 : 1.32;
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
        shadows.push({
          x: center.x + lean.x,
          y: tileWorldHeight(this.scenario, center.x, center.z) + 0.09,
          z: center.z + lean.z,
          rx: (def.footprint.w * TILE_SIZE) / 2 * 1.28 + 1.0,
          rz: (def.footprint.h * TILE_SIZE) / 2 * 1.28 + 1.0,
          rotation: 0,
          alpha: 1,
        });
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
            allianceFlagColor(factionId),
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
    gl.uniform3f(mp.u.uTeamColor, 0.17, 0.17, 0.15);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bindFlagTexture();
    for (const wreck of this.wrecks) {
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
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.bindFlagTexture();
    bindTextureUnit(gl, MESH_MATERIAL_TEXTURE_UNIT, this.materialTexture, mp.u.uMatLut ?? null);
    const team = game.teamOf(game.localPlayerId);
    for (const e of game.state.entities) {
      if (e.hp <= 0) continue;
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
      const groundY = tileWorldHeight(this.scenario!, x, z);
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
      const flash = !remembered && game.state.tick - e.lastHitTick < 3 ? 0.75 : 0;
      // An occupied shelter switches to its garrisoned model and takes the trim
      // colour of the infantry inside, whoever owns the building itself. A
      // remembered structure shows the shape that was charted, not live state.
      const occupants =
        !remembered && e.kind === 'building' && BUILDINGS[e.defId]?.garrison
          ? game.garrisonOccupants(e.id)
          : [];
      const garrisonOwner = occupants.length > 0 ? occupants[0].owner : null;
      const construction = e.construction;
      const progress = construction ? 0.25 + e.buildProgress * 0.75 : 1;
      const liveAlpha = construction ? 0.72 : e.hp / e.maxHp < 0.25 ? 0.94 : 1;
      const alpha = remembered ? 0.5 : liveAlpha;
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
        construction ? 0.18 + progress * 0.82 : 1,
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
      );
    }
    gl.disable(gl.BLEND);
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
  ): void {
    const mp = this.meshProgram;
    const gl = this.gl;
    const team = this.teamColorOf(this.game!, owner);
    if (kind === 'building') {
      const rig = this.buildingMeshes.get(defId);
      if (!rig) return;
      const occupied = garrisonOwner !== null && rig.garrisoned ? rig.garrisoned : rig.body;
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
            allianceFlagColor(factionId),
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
      if (construction) {
        // A simple scaffold cage outline effect: draw the mesh again with a
        // team-tinted translucent pass at full height.
        gl.uniformMatrix4fv(mp.u.uModel, false, modelFor(x, y, z, -facing, 1, 1));
        gl.uniform1f(mp.u.uAlpha, 0.1);
        gl.uniform1f(mp.u.uFlash, 0.15);
        occupied.draw();
      }
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
        additive.push({ x: p.x, y: p.y, z: p.z, size, r: p.r, g: p.g, b: p.b, a: p.alpha * fade });
      } else {
        normal.push({ x: p.x, y: p.y, z: p.z, size, r: p.r, g: p.g, b: p.b, a: p.alpha * fade });
      }
    }
    if (this.game) {
      for (const pr of this.game.state.projectiles) {
        // Fog hiding is a gameplay rule, not a visual toggle: turning the fog
        // texture off must never reveal a projectile the team cannot see.
        if (!this.pointVisible(this.game, pr.x, pr.z)) continue;
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
