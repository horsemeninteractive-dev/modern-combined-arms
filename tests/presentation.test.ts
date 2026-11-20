import { describe, expect, it } from 'vitest';
import { createScenario, type Scenario } from '../src/sim/scenario';
import { Terrain, tileIndex } from '../src/sim/terrain';
import { TILE_SIZE } from '../src/sim/constants';
import { buildRoadDetails, buildTerrainGeometry, roadSegments } from '../src/render/terrainMesh';
import { buildingMesh, buildingStyle } from '../src/render/buildingMeshes';
import { BUILDINGS } from '../src/data/buildings';
import { Game } from '../src/sim/game';
import { createIslandAssault } from '../src/data/scenarios';
import type { Entity } from '../src/sim/types';
import { MESH_FS, MESH_VS, PROP_FS, TERRAIN_FS, TERRAIN_VS, WATER_FS } from '../src/render/shaders';
import {
  bindTextureUnit,
  MESH_FLAG_TEXTURE_UNIT,
  MESH_FOG_OLD_TEXTURE_UNIT,
  MESH_FOG_TEXTURE_UNIT,
  MESH_MATERIAL_TEXTURE_UNIT,
} from '../src/render/gl';
import { readFileSync } from 'node:fs';
import { buildLightView } from '../src/render/lightView';
import { MeshBuilder } from '../src/render/geometry';
import { dayNightAt } from '../src/sim/dayNight';

const styleCss = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

function emptyScenario(size = 16): Scenario {
  return createScenario(size, size, 'Presentation fixture');
}

function setRoad(s: Scenario, x: number, z: number): void {
  s.tiles[tileIndex(s.width, x, z)].t = Terrain.Road;
}

describe('sphere normals', () => {
  it('keeps a unit normal at both poles', () => {
    const b = new MeshBuilder();
    b.sphere(0, 0, 0, 1, 3, 7, [1, 1, 1]);
    const mesh = b.build();
    // A pole ring's first two vertices coincide, so the geometric face
    // normal is zero. Lighting normalizes it and a zero vector renders black.
    for (let i = 0; i < mesh.normals.length; i += 3) {
      const length = Math.hypot(mesh.normals[i], mesh.normals[i + 1], mesh.normals[i + 2]);
      expect(length).toBeCloseTo(1, 5);
    }
  });
});

describe('road network', () => {
  it('joins two diagonal road tiles with one centre-line segment', () => {
    const s = emptyScenario();
    setRoad(s, 5, 5);
    setRoad(s, 6, 6);
    const segments = roadSegments(s);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toEqual({
      x0: 5.5 * TILE_SIZE,
      z0: 5.5 * TILE_SIZE,
      x1: 6.5 * TILE_SIZE,
      z1: 6.5 * TILE_SIZE,
    });
  });

  it('emits one segment per adjacency, not one per tile pair direction', () => {
    const s = emptyScenario();
    setRoad(s, 5, 5);
    setRoad(s, 6, 5);
    setRoad(s, 7, 5);
    expect(roadSegments(s)).toHaveLength(2);
  });

  it('leaves an isolated road tile with no segments but still a junction patch', () => {
    const s = emptyScenario();
    setRoad(s, 8, 8);
    expect(roadSegments(s)).toHaveLength(0);
    const mesh = buildRoadDetails(s);
    expect(mesh.indices.length).toBeGreaterThan(0);
    // The surface has to face the sun; a downward normal would be unlit.
    for (let i = 1; i < mesh.normals.length; i += 3) {
      expect(mesh.normals[i]).toBeGreaterThan(0.9);
    }
  });
});

describe('terrain colour seams', () => {
  it('shares one colour across the corner where two terrains meet', () => {
    const s = emptyScenario(8);
    setRoad(s, 4, 4);
    const geometry = buildTerrainGeometry(s);
    const cornerX = 4 * TILE_SIZE;
    const cornerZ = 4 * TILE_SIZE;
    const colours: number[][] = [];
    for (let i = 0; i < geometry.positions.length; i += 3) {
      if (
        Math.abs(geometry.positions[i] - cornerX) < 1e-3 &&
        Math.abs(geometry.positions[i + 2] - cornerZ) < 1e-3
      ) {
        colours.push([geometry.colors[i], geometry.colors[i + 1], geometry.colors[i + 2]]);
      }
    }
    // Four tiles meet here, so four vertices share the position.
    expect(colours.length).toBe(4);
    for (const c of colours) {
      expect(c[0]).toBeCloseTo(colours[0][0], 6);
      expect(c[1]).toBeCloseTo(colours[0][1], 6);
      expect(c[2]).toBeCloseTo(colours[0][2], 6);
    }
  });
});

describe('ground materials', () => {
  const cornerGround = (geometry: ReturnType<typeof buildTerrainGeometry>, x: number, z: number) => {
    const out: number[][] = [];
    for (let i = 0; i < geometry.positions.length; i += 3) {
      if (
        Math.abs(geometry.positions[i] - x) < 1e-3 &&
        Math.abs(geometry.positions[i + 2] - z) < 1e-3
      ) {
        const v = i / 3;
        out.push([
          geometry.grounds[v * 4],
          geometry.grounds[v * 4 + 1],
          geometry.grounds[v * 4 + 2],
          geometry.grounds[v * 4 + 3],
        ]);
      }
    }
    return out;
  };

  it('emits one finite, normalised material weight per terrain vertex', () => {
    const geometry = buildTerrainGeometry(emptyScenario(10));
    expect(geometry.grounds).toHaveLength((geometry.positions.length / 3) * 4);
    for (let i = 0; i < geometry.grounds.length; i += 4) {
      const sum =
        geometry.grounds[i] +
        geometry.grounds[i + 1] +
        geometry.grounds[i + 2] +
        geometry.grounds[i + 3];
      expect(Number.isFinite(sum)).toBe(true);
      expect(sum).toBeCloseTo(1, 5);
    }
  });

  it('gives grass and sand different dominant ground cover', () => {
    const s = emptyScenario(12);
    for (let z = 0; z < 12; z++) {
      for (let x = 0; x < 12; x++) s.tiles[tileIndex(s.width, x, z)].t = Terrain.Sand;
    }
    for (let z = 5; z < 8; z++) {
      for (let x = 5; x < 8; x++) s.tiles[tileIndex(s.width, x, z)].t = Terrain.Grass;
    }
    const geometry = buildTerrainGeometry(s);
    const grass = cornerGround(geometry, 6 * TILE_SIZE, 6 * TILE_SIZE)[0];
    const sand = cornerGround(geometry, 2 * TILE_SIZE, 2 * TILE_SIZE)[0];
    // The grass block is fully surrounded, so its interior corner is grass;
    // open sand is dominated by the dry-earth weight.
    expect(grass[0]).toBeGreaterThan(0.9);
    expect(sand[1]).toBeGreaterThan(0.9);
  });

  it('keeps material weights identical at the shared corners of four tiles', () => {
    const s = emptyScenario(8);
    setRoad(s, 4, 4);
    s.tiles[tileIndex(s.width, 5, 4)].t = Terrain.Forest;
    s.tiles[tileIndex(s.width, 4, 5)].t = Terrain.Rock;
    const geometry = buildTerrainGeometry(s);
    const atCorner = cornerGround(geometry, 4 * TILE_SIZE, 4 * TILE_SIZE);
    expect(atCorner).toHaveLength(4);
    for (const weights of atCorner) {
      expect(weights).toEqual(atCorner[0]);
    }
  });

  it('is deterministic for identical map input', () => {
    const s = emptyScenario(10);
    s.tiles[tileIndex(s.width, 3, 3)].t = Terrain.Rock;
    s.tiles[tileIndex(s.width, 4, 4)].t = Terrain.Forest;
    const a = buildTerrainGeometry(s);
    const b = buildTerrainGeometry(s);
    expect(a.grounds).toEqual(b.grounds);
    expect(a.colors).toEqual(b.colors);
    expect(a.indices).toEqual(b.indices);
  });

  it('applies ground materials before the fog treatment', () => {
    expect(TERRAIN_VS).toContain('layout(location=4) in vec4 aGround');
    expect(TERRAIN_FS).toContain('in vec4 vGround');
    // Material shading — including the field-scale macro variation — must
    // finish before the fog is applied, so hidden ground cannot reveal cover
    // or shore detail.
    expect(TERRAIN_FS.indexOf('base *= broad * aggregate')).toBeLessThan(
      TERRAIN_FS.indexOf('float fog = uUseFog'),
    );
    expect(TERRAIN_FS.indexOf('float fieldDrift')).toBeLessThan(
      TERRAIN_FS.indexOf('float fog = uUseFog'),
    );
    // The three fog states, in one place rather than per shader.
    expect(TERRAIN_FS).toContain('lit = applyFog(lit, fog)');
    expect(TERRAIN_FS).toContain('vec3 unseen = vec3(0.012, 0.027, 0.038);');
  });

  it('breaks up flat grass without touching readable ground', () => {
    // The field-scale drift multiplies the authored tile colour and is gated to
    // grass cover away from stone, so roads, ore and buildable ground keep
    // their terrain colour.
    const drift = TERRAIN_FS.slice(
      TERRAIN_FS.indexOf('float fieldDrift'),
      TERRAIN_FS.indexOf('float broad ='),
    );
    expect(drift).toContain('noise2(p * 0.014');
    expect(drift).toContain('g.x * (1.0 - g.w)');
    expect(drift).toContain('base *= mix(');
    expect(drift).not.toContain('vec3');
  });
});

describe('animated building parts', () => {
  it('gives every enclosed producing bay a shutter that rolls up into its opening', () => {
    // The shipyard is deliberately absent: its corvettes leave through an open
    // slipway, so it has no wall to hang a shutter in.
    for (const id of ['factory', 'barracks', 'airfield']) {
      const style = buildingStyle(id);
      expect(style?.door, id).toBeDefined();
      // The shutter retracts into the head of the opening rather than hanging
      // above the roof.
      expect(style!.door!.retract, id).toBeGreaterThan(0.8);
      const positions = style!.door!.mesh.positions;
      expect(positions.length, id).toBeGreaterThan(0);
      const ys: number[] = [];
      for (let i = 1; i < positions.length; i += 3) ys.push(positions[i]);
      // Authored downward from the lintel: nothing sits above the head.
      expect(Math.max(...ys), id).toBeLessThanOrEqual(0.081);
    }
  });

  it('mounts each shutter on its own shell, hanging from the lintel to the ground', () => {
    for (const id of ['factory', 'barracks', 'airfield']) {
      const style = buildingStyle(id)!;
      const bounds = (positions: Float32Array) => {
        const out = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity, minZ: Infinity, maxZ: -Infinity };
        for (let i = 0; i < positions.length; i += 3) {
          out.minX = Math.min(out.minX, positions[i]);
          out.maxX = Math.max(out.maxX, positions[i]);
          out.minY = Math.min(out.minY, positions[i + 1]);
          out.maxY = Math.max(out.maxY, positions[i + 1]);
          out.minZ = Math.min(out.minZ, positions[i + 2]);
          out.maxZ = Math.max(out.maxZ, positions[i + 2]);
        }
        return out;
      };
      const shell = bounds(style.body.positions);
      const panel = bounds(style.door!.mesh.positions);
      const [ox, oy, oz] = style.door!.offset;
      // The head of the opening sits on the shell, not off in the air.
      expect(ox, id).toBeGreaterThanOrEqual(shell.minX);
      expect(ox, id).toBeLessThanOrEqual(shell.maxX);
      expect(oz, id).toBeGreaterThanOrEqual(shell.minZ);
      expect(oz, id).toBeLessThanOrEqual(shell.maxZ);
      expect(oy, id).toBeGreaterThan(shell.minY + 1);
      expect(oy, id).toBeLessThan(shell.maxY);
      // Closed, the panel reaches (near) the ground so the bay is sealed.
      expect(oy + panel.minY, id).toBeLessThan(shell.minY + 1.6);
    }
  });

  it('bakes each entrance into the static mesh used by thumbnails', () => {
    for (const id of ['factory', 'barracks', 'airfield']) {
      const style = buildingStyle(id)!;
      const merged = buildingMesh(id)!;
      expect(merged.positions.length, id).toBeGreaterThan(style.body.positions.length);
    }
    // With no moving parts the shipyard's thumbnail mesh is its body, which is
    // still a complete, uploadable model.
    expect(buildingMesh('shipyard')!.positions.length).toBe(
      buildingStyle('shipyard')!.body.positions.length,
    );
  });

  it('keeps the shipyard slipway open to the seaward footprint edge', () => {
    const style = buildingStyle('shipyard')!;
    expect(style.door).toBeUndefined();
    let maxZ = -Infinity;
    for (let i = 2; i < style.body.positions.length; i += 3) {
      maxZ = Math.max(maxZ, style.body.positions[i]);
    }
    // Local +Z faces the harbour. The wet basin must run through the 20-unit
    // footprint edge (z = +10) so the authored dock water joins the sea rather
    // than ending behind a sill, and there must be no shutter in the open yard.
    expect(maxZ).toBeGreaterThan(9.9);
  });

  it('gives every garrisonable shelter a body and an occupied variant', () => {
    const shelters = Object.values(BUILDINGS).filter((def) => (def.garrison?.capacity ?? 0) > 0);
    expect(shelters.length).toBeGreaterThanOrEqual(4);
    for (const def of shelters) {
      const style = buildingStyle(def.id);
      expect(style, def.id).toBeDefined();
      expect(style!.garrisoned, def.id).toBeDefined();
      // Held and empty must not look the same.
      expect(style!.garrisoned!.positions.length, def.id).toBeGreaterThan(style!.body.positions.length);
    }
  });

  it('sweeps the radar masts and bakes them into the static thumbnail mesh', () => {
    for (const id of ['radarStation', 'radar', 'relay', 'commandPost']) {
      const style = buildingStyle(id)!;
      expect(style.rotor, id).toBeDefined();
      expect(style.rotor!.rate, id).toBeGreaterThan(0);
      expect(style.rotor!.mesh.positions.length, id).toBeGreaterThan(0);
      const merged = buildingMesh(id)!;
      expect(merged.positions.length, id).toBeGreaterThan(style.body.positions.length);
    }
  });
});

describe('start gate and fullscreen', () => {
  it('waits for a click before the sting and takes the app fullscreen', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const gate = html.indexOf('id="btn-start"');
    const skip = html.indexOf('id="btn-skip-intro"');
    expect(gate).toBeGreaterThan(0);
    expect(gate).toBeLessThan(skip);

    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const intro = app.slice(app.indexOf('private installIntro'), app.indexOf('private beginIntroPlayback'));
    // The gesture initialises audio and requests fullscreen before the sting runs.
    expect(intro).toContain("document.getElementById('btn-start')");
    expect(intro.indexOf('this.audio.init()')).toBeLessThan(intro.indexOf('this.enterIntroFullscreen()'));
    expect(intro).toContain('started');
    // Touch windows and apps already in fullscreen display mode skip the API
    // request: Android's "swipe down to exit" notice would otherwise park over
    // the battlefield for the whole match.
    const gated = app.slice(app.indexOf('private enterIntroFullscreen'), app.indexOf('private syncFullscreenControls'));
    expect(gated).toContain('wantsAutomaticFullscreen');
    expect(gated).toContain("(pointer: coarse)");
    expect(gated).toContain('enterFullscreen()');
    // Autoplay only happens after the gate: the playback body is separate.
    expect(intro).not.toContain('video.play()');
    // The gate covers the skip button until it has been answered.
    expect(styleCss).toMatch(/\.intro-screen:not\(\.started\) \.intro-skip \{ visibility: hidden; \}/);
  });

  it('stamps the fighting alliance crest on the loading brief', () => {
    const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    expect(page).toContain('class="loading-insignia"');
    expect(css).toMatch(/\.loading-insignia \{[^}]*mask: url\('\/insignia-aa\.png'\)/);
    expect(css).toMatch(
      /\.loading-screen\[data-front='eastern'\] \.loading-insignia \{[^}]*mask-image: url\('\/insignia-ep\.png'\)/,
    );
    // The brief names the side the viewer fights as, so the crest has to follow
    // that alliance rather than the menu's last selection.
    expect(app).toContain('loadingScreen.dataset.front');
  });

  it('offers the same fullscreen switch in the menu and in battle', () => {
    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    // One markup source feeds both the Settings view and the in-battle modal.
    const rows = app.slice(app.indexOf('private settingsRowsMarkup'), app.indexOf('private renderMenuSettings'));
    expect(rows).toContain('data-toggle="fullscreen"');
    const controls = app.slice(app.indexOf('private bindSettingsControls'), app.indexOf('private syncFullscreenControls'));
    expect(controls).toContain('toggleFullscreen()');
    expect(app).toContain("addEventListener('fullscreenchange'");
  });
});

describe('menu music', () => {
  it('plays the authored theme on the deck, stops it elsewhere and ships it offline', () => {
    const audioTs = readFileSync(new URL('../src/ui/audio.ts', import.meta.url), 'utf8');
    // One looping deck element; its source is the route's theme, defaulting to
    // the authored menu theme.
    expect(audioTs).toContain('new Audio(this.menuThemeSrc)');
    expect(audioTs).toContain('private menuThemeSrc = MAIN_THEME_SRC');
    expect(audioTs).toContain('setMenuTheme(src: string)');
    expect(audioTs).toContain('el.loop = true');

    const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    // Two ways into the menu (intro handoff, direct reveal) and every screen
    // that leaves it stops the theme.
    expect(app.match(/this\.audio\.playMenuMusic\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(app.match(/this\.audio\.stopMenuMusic\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(app).toContain('data-set="music"');
    expect(app).toContain('this.audio.setMusicVolume(this.settings.music)');

    const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    const buildSw = readFileSync(new URL('../tools/build-sw.mjs', import.meta.url), 'utf8');
    expect(sw).toContain('/audio/music/menu-theme.mp3');
    expect(buildSw).toContain('/audio/music/menu-theme.mp3');
  });
});

describe('road fog', () => {
  it('charts roads like the ground and structures, not as paint over the dark', () => {
    expect(MESH_FS).toContain('uFogTex');
    expect(MESH_FS).toContain('uUseFog');
    expect(MESH_FS).toMatch(/fogField\(vWorld\.xz \/ uWorldSize\)/);
    expect(MESH_FS).toContain('applyFog(lit, fog)');
    // All three authored states survive: unseen ground keeps the terrain's
    // near-black, charted ground is desaturated and cooled rather than just
    // dimmed, and only vision clears the mask.
    expect(MESH_FS).toContain('float fogSeen(float fog)');
    expect(MESH_FS).toContain('float fogCharted(float fog)');
    expect(MESH_FS).toContain('chartedTone');
    expect(MESH_FS).toContain('vec3 unseen = vec3(0.012, 0.027, 0.038);');
  });

  it('cross-fades two fog fields so the vision boundary does not step', () => {
    // The mask is rebuilt every third tick. Both uploads are sampled and mixed
    // by a weight the renderer ramps across exactly one interval.
    for (const shader of [MESH_FS, TERRAIN_FS, WATER_FS, PROP_FS]) {
      expect(shader).toContain('uniform sampler2D uFogTexOld');
      expect(shader).toContain('uniform float uFogBlend');
      expect(shader).toMatch(/mix\(texture\(uFogTexOld, uv\)\.r, texture\(uFogTex, uv\)\.r, uFogBlend\)/);
    }
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    expect(renderer).toContain('this.fogTextureOld = this.createTexture()');
    // A new mask rotates the pair and restarts the blend instead of replacing
    // the only field, which is what made the edge jump.
    const upload = renderer.slice(renderer.indexOf('private uploadFogField'), renderer.indexOf('private updateFog'));
    expect(upload).toContain('this.uploadTexture(this.fogTextureOld');
    expect(upload).toContain('this.fogBlend = 0');
    expect(renderer).toContain('this.fogBlend + dt / FOG_UPDATE_SECONDS');
  });

  it('feeds the road pass the fog texture and leaves entity passes unfogged', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    // The window covers the whole road setup block: fog, material, blend state
    // and the lamp cones the deck now receives.
    const road = renderer.slice(renderer.indexOf('this.roadMesh.draw()') - 1200, renderer.indexOf('this.roadMesh.draw()'));
    expect(road).toContain('uUseFog');
    expect(road).toContain('MESH_FOG_TEXTURE_UNIT');
    expect(road).toContain('this.bindFogFields(');
    // Buildings and units carry their own charting alpha instead.
    const entityPasses = renderer.match(/gl\.uniform1f\(mp\.u\.uUseFog, 0\)/g) ?? [];
    expect(entityPasses.length).toBeGreaterThanOrEqual(2);
  });

  it('binds each mesh sampler to the unit its texture is bound on', () => {
    // The regression this guards: fog and flags were both bound to unit 0, so
    // the road pass sampled the white flag texture as fog and drew at full
    // brightness across never-seen ground. A sampler must name its own unit.
    expect(MESH_FOG_TEXTURE_UNIT).not.toBe(MESH_FLAG_TEXTURE_UNIT);
    const calls: string[] = [];
    const fog = {} as WebGLTexture;
    const sampler = { name: 'uFogTex' } as unknown as WebGLUniformLocation;
    const gl = {
      TEXTURE0: 0x84c0,
      TEXTURE_2D: 0x0de1,
      activeTexture(unit: number) {
        calls.push(`unit:${unit - 0x84c0}`);
      },
      bindTexture(_target: number, texture: WebGLTexture) {
        calls.push(texture === fog ? 'fog' : 'other');
      },
      uniform1i(location: WebGLUniformLocation | null, unit: number) {
        calls.push(`sampler:${(location as unknown as { name: string }).name}=${unit}`);
      },
    } as unknown as WebGL2RenderingContext;
    bindTextureUnit(gl, MESH_FOG_TEXTURE_UNIT, fog, sampler);
    expect(calls).toEqual(['unit:1', 'fog', 'sampler:uFogTex=1']);
  });

  it('keeps the road fog sampler off the flag unit', () => {
    const renderer = readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');
    const start = renderer.indexOf('// Roads carry the same fog');
    const end = renderer.indexOf('this.roadMesh.draw()', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = renderer.slice(start, end);
    expect(block).toContain('this.bindFogFields(mp.u, MESH_FOG_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT)');
    // Flags stay on their own unit and are bound after, as entity passes expect.
    expect(block).toContain('this.bindFlagTexture()');
    expect(block).not.toContain('uFogTex, 0');
    // Fog, its previous field, the material LUT and the flag texture must all
    // sit on distinct units; the helper names each sampler's own unit.
    expect(new Set([MESH_FLAG_TEXTURE_UNIT, MESH_FOG_TEXTURE_UNIT, MESH_MATERIAL_TEXTURE_UNIT, MESH_FOG_OLD_TEXTURE_UNIT]).size).toBe(4);
  });
});

describe('menu view switches', () => {
  it('animates the deck contents without re-running the header or footer', () => {
    const glitchRules = styleCss
      .split('\n')
      .filter((line) => line.startsWith('#app.glitching'))
      .join('\n');
    expect(glitchRules).not.toMatch(/menu-topbar|menu-footer/);
    // The newly shown deck still comes up line by line.
    expect(glitchRules).toMatch(/\.menu-view-head > \*/);
    const panelRule = styleCss.slice(styleCss.indexOf(".menu-screen[data-view='settings'] .menu-view"));
    expect(panelRule.slice(0, panelRule.indexOf('}'))).toContain('animation: menu-view-in');
  });

  it('only replays the shell entrance when the menu itself is revealed', () => {
    const appTs = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const view = appTs.slice(appTs.indexOf('showMenuView(view: MenuView | null)'));
    const body = view.slice(0, view.indexOf('\n  }'));
    expect(body).not.toContain('revealMenu');
    expect(body).not.toMatch(/'replay'/);
  });
});

describe('intro beats', () => {
  it('fades the engine plate out rather than leaving it lit under the game lockup', () => {
    const engineIn = styleCss.indexOf('.intro-screen.engine .intro-engine {');
    const engineOut = styleCss.indexOf('.intro-screen.logo .intro-engine {');
    expect(engineIn).toBeGreaterThanOrEqual(0);
    expect(engineOut).toBeGreaterThan(engineIn);
    // The entrance fills forwards, so a plain opacity declaration on the later
    // rule would lose to it; the fade has to swap the animation.
    const entrance = styleCss.slice(engineIn, styleCss.indexOf('}', engineIn));
    expect(entrance).toContain('forwards');
    const fade = styleCss.slice(engineOut, styleCss.indexOf('}', engineOut));
    expect(fade).toContain('animation: intro-engine-out');
    const keyframes = styleCss.slice(styleCss.indexOf('@keyframes intro-engine-out'));
    expect(keyframes).toMatch(/to \{[^}]*opacity: 0/);
  });
});

describe('HUD legibility floor', () => {
  const hudStart = styleCss.indexOf('/* Battle HUD');
  const hudEnd = styleCss.indexOf('/* Mobile landscape composition');
  const hudCss = styleCss.slice(hudStart, hudEnd);

  it('defines the shared type scale and drives it from the UI scale', () => {
    // The scale is still anchored to the Phase 1 floor; the multiplier is what
    // lets the Settings slider resize the HUD without a second stylesheet.
    expect(styleCss).toContain('--ui-scale: 1');
    expect(styleCss).toContain('--fs-xs: calc(11px * var(--ui-scale))');
    expect(styleCss).toContain('--fs-sm: calc(12px * var(--ui-scale))');
    expect(styleCss).toContain('--fs-md: calc(13px * var(--ui-scale))');
    expect(styleCss).toContain('--fs-lg: calc(15px * var(--ui-scale))');
    expect(styleCss).toContain('--fs-xl: calc(18px * var(--ui-scale))');
  });

  it('declares no raw HUD font size below 11px', () => {
    const belowFloor = [...hudCss.matchAll(/font-size:\s*([0-9.]+)px/g)]
      .map((match) => Number(match[1]))
      .filter((size) => size < 11);
    expect(belowFloor).toEqual([]);
  });

  it('keeps the type floor override block from reintroducing small text', () => {
    const floorStart = styleCss.indexOf('/* Legibility floor');
    expect(floorStart).toBeGreaterThan(hudStart);
    const floorCss = styleCss.slice(floorStart);
    const belowFloor = [...floorCss.matchAll(/font-size:\s*([0-9.]+)px/g)]
      .map((match) => Number(match[1]))
      .filter((size) => size < 11);
    expect(belowFloor).toEqual([]);
  });

  it('shows desktop command hotkeys and hides them on touch layouts', () => {
    expect(styleCss).toMatch(/\.cmd-key\s*\{[^}]*font-size:\s*var\(--fs-xs\)/);
    expect(styleCss).toMatch(/\.layout-mobile \.cmd-key\s*\{\s*display:\s*none/);
  });
});

describe('HUD layout resilience', () => {
  it('builds every card grid from shrinkable tracks', () => {
    // A bare `fr` track floors at the card's min-content width, so one long
    // structure name widened the track past the panel and pushed the cards out
    // of view behind a horizontal scrollbar.
    expect(styleCss).not.toMatch(/\.(unit-grid|build-grid)[^{]*\{[^}]*repeat\(2,\s*1fr\)/);
    expect(styleCss).toContain('.build-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr))');
    expect(styleCss).toMatch(/\.layout-desktop \.build-grid \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('never lets the production list scroll sideways', () => {
    // Only the vertical axis scrolls; the rail of categories sits outside it.
    expect(styleCss).toMatch(/\.prod-body \{[^}]*overflow-x: hidden/);
  });

  it('keeps the rail mission actions at a usable height', () => {
    // The block used to be pinned to the console height, which crushed the
    // save/pause/settings/menu grid to a few pixels once the clock and control
    // groups were laid out above it. The briefing joined the pad as a third
    // row, so the floor is three rows tall rather than two.
    const bottom = styleCss.slice(styleCss.indexOf('.rail-bottom {'));
    expect(bottom.slice(0, bottom.indexOf('}'))).toContain('height: auto');
    expect(styleCss).toMatch(/\.rail-actions \{[^}]*grid-template-rows: repeat\(3, minmax\(0, 1fr\)\)/);
    expect(styleCss).toMatch(/\.rail-actions \{[^}]*min-height: calc\(72px \* var\(--ui-scale\)\)/);
  });

  it('holds a usable card column at a reduced interface scale', () => {
    // The sidebar floor keeps a one-column card readable even at 80%, where the
    // scaled minimum width alone left about ninety pixels of card.
    expect(styleCss).toContain('--sidebar-w: max(clamp(');
    expect(styleCss).toContain('--tab-w: clamp(60px, calc(60px * var(--ui-scale)), 96px)');
  });
});

describe('production apron', () => {
  it('places a finished vehicle on the apron in front of the factory', () => {
    const scenario = createIslandAssault();
    scenario.structures.push({ defId: 'factory', owner: 0, x: 30, z: 34 });
    const game = new Game(scenario, { enableAI: false });
    const factory = game.entitiesOf(0, 'building').find((e) => e.defId === 'factory')!;
    const bdef = BUILDINGS.factory;
    const originX = Math.round(factory.x / TILE_SIZE - bdef.footprint.w / 2);
    const originZ = Math.round(factory.z / TILE_SIZE - bdef.footprint.h / 2);
    const apronX = (originX + Math.floor(bdef.footprint.w / 2) + 0.5) * TILE_SIZE;
    const apronZ = (originZ + bdef.footprint.h + 0.5) * TILE_SIZE;

    const before = new Set(game.entitiesOf(0, 'unit').map((e) => e.id));
    game.enqueueCommand({ type: 'produce', team: 0, buildingId: factory.id, defId: 'engineer' });
    let produced: Entity | undefined;
    for (let i = 0; i < 20 * 40 && !produced; i++) {
      game.tick();
      produced = game.entitiesOf(0, 'unit').find((e) => e.defId === 'engineer' && !before.has(e.id));
    }
    expect(produced).toBeDefined();
    expect(Math.hypot(produced!.x - apronX, produced!.z - apronZ)).toBeLessThan(TILE_SIZE);
  });
});

describe('occlusion and cast shadows', () => {
  const renderer = () => readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('draws hidden units as a flat team silhouette only where a structure covers them', () => {
    const source = renderer();
    const start = source.indexOf('private drawOccludedUnits');
    const end = source.indexOf('private drawEntityMesh', start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const pass = source.slice(start, end);
    // A GREATER test writes only pixels something else already covers, the
    // depth pull limits that to surfaces just in front of the unit, and the
    // state is restored before the next pass.
    expect(pass).toContain('gl.depthFunc(gl.GREATER)');
    expect(pass).toContain('gl.depthFunc(gl.LEQUAL)');
    expect(pass).toContain('gl.depthMask(false)');
    expect(pass).toContain('gl.depthMask(true)');
    expect(pass).toContain('uDepthPull');
    // Vision is the same gate the main pass uses, so no silhouette can reveal
    // fog or an unseen tile. Only units take part; flags and wrecks do not.
    expect(pass).toContain("game.visionStateOf(team, e.id) !== 'visible'");
    expect(pass).toContain("e.kind !== 'unit'");
    expect(pass).not.toContain('bindFlagTexture');
    // The whole pass is behind its own setting.
    expect(source).toContain('if (this.settings.silhouettes) this.drawOccludedUnits(this.game)');
  });

  it('keeps the silhouette unlit and untextured in the mesh shader', () => {
    expect(MESH_FS).toContain('uniform float uSilhouette');
    const early = MESH_FS.slice(MESH_FS.indexOf('if (uSilhouette > 0.5)'), MESH_FS.indexOf('vec3 n = normalize(vNormal)'));
    expect(early).toContain('outColor = vec4(uTeamColor');
    expect(early).toContain('return');
    // The pull is view depth only: the on-screen position is untouched.
    expect(MESH_VS).toContain('clip.z -= (2.0 * uDepthPull) / (uFar - uNear)');
  });

  it('casts a flat shadow from tall structures along the sun', () => {
    const source = renderer();
    // Both the live battle and the menu backdrop get the cast.
    const calls = source.match(/this\.pushCastShadow\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const push = source.slice(source.indexOf('private pushCastShadow'), source.indexOf('private castShadowStrength'));
    // Height comes from the authored mesh, not a per-building constant.
    expect(push).toContain('buildingTopHeight(defId)');
    expect(push).toContain('this.airShadowOffset(height * 0.85)');
    expect(push).toContain('const strength = this.castShadowStrength()');
    // Subtle at dusk and night, strongest at midday, and scaled by how much
    // sun the weather lets through: under a storm the sky is the light source.
    const strength = source.slice(source.indexOf('private castShadowStrength'), source.indexOf('private shadowGroundY'));
    expect(strength).toContain("tod === 'night' ? 0.3");
    expect(strength).toContain("tod === 'day' ? 1");
    expect(strength).toContain('this.weather.shadow');
  });
});

describe('night light pass', () => {
  const renderer = () => readFileSync(new URL('../src/render/renderer.ts', import.meta.url), 'utf8');

  it('lights nothing while the battlefield is still fought in daylight', () => {
    const game = new Game(createIslandAssault(), { enableAI: false });
    const state = dayNightAt(0, { startHour: 13, dayLengthMinutes: 0 });
    expect(state.darkness).toBe(0);
    const lights = buildLightView({
      entities: game.state.entities,
      dayNight: state,
      bloom: 1,
      effects: true,
      powered: () => true,
      eye: [0, 0, 0],
      groundY: () => 0,
      visible: () => true,
    });
    // Dusk keeps the lamps off: a dim grade is not a lit battlefield.
    expect(lights).toHaveLength(0);
  });

  it('owns no lights in a frame that skips the night build', () => {
    const source = renderer();
    // Both halves of the pass share one gate: the pools before the models and
    // the wall-lamp glows after them.
    expect(source).toContain(
      'const lightsOn = !!this.game && this.settings.nightLights && this.dayNight.darkness > 0;',
    );
    const frame = source.slice(source.indexOf('const lightsOn'), source.indexOf('this.drawParticles();'));
    expect(frame).toContain('this.buildLightInstances();');
    // A daylight frame must empty the list. Leaving the last night frame's
    // entries in place painted its corner lamps over the day, at the positions
    // of whichever scene was lit last.
    expect(frame).toContain('this.lightPools.length = 0;');
    expect(frame).toContain('this.lightGlows.length = 0;');
    expect(frame).toContain('if (this.lightGlows.length > 0)');
  });
});
