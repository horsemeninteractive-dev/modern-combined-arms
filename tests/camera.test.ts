import { describe, expect, it } from 'vitest';
import { BATTLE_ZOOM, CLOSE_ZOOM, Camera } from '../src/render/camera';

function camera(): Camera {
  const cam = new Camera();
  cam.setViewport(1280, 720);
  cam.setMap(96, 72);
  cam.centerOn(200, 200);
  return cam;
}

describe('isometric camera', () => {
  it('projects the ground as a 2:1 diamond', () => {
    const cam = camera();
    const origin = cam.worldToScreen(200, 0, 200);
    const plusX = cam.worldToScreen(220, 0, 200);
    const plusZ = cam.worldToScreen(200, 0, 220);
    const dx = plusX.x - origin.x;
    const dz = plusZ.x - origin.x;
    const dyX = plusX.y - origin.y;
    const dyZ = plusZ.y - origin.y;

    // The two ground axes are mirror images on screen...
    expect(dx).toBeGreaterThan(0);
    expect(dz).toBeLessThan(0);
    expect(Math.abs(dx)).toBeCloseTo(Math.abs(dz), 4);
    expect(dyX).toBeCloseTo(dyZ, 4);
    expect(dyX).toBeGreaterThan(0);
    // ...and each is foreshortened to half its width: classic 2:1 isometric.
    expect(dyX / Math.abs(dx)).toBeCloseTo(0.5, 3);
  });

  it('orbits the projection around the focus when yaw is authored', () => {
    const cam = camera();
    cam.setFraming(cam.cx, cam.cz, cam.zoom, 0);
    const centre = cam.worldToScreen(cam.cx, 0, cam.cz);
    const north = cam.worldToScreen(cam.cx, 0, cam.cz - 20);
    // At yaw 0 the view looks north, so north is straight up the screen.
    expect(north.y).toBeLessThan(centre.y);
    expect(north.x).toBeCloseTo(centre.x, 4);

    cam.setFraming(cam.cx, cam.cz, cam.zoom, Math.PI / 2);
    const orbited = cam.worldToScreen(cam.cx, 0, cam.cz - 20);
    expect(orbited.x).toBeGreaterThan(centre.x);
    expect(orbited.y).toBeCloseTo(centre.y, 4);
    const ground = cam.screenToGround(cam.width / 2, cam.height / 2, 0);
    expect(ground.x).toBeCloseTo(cam.cx, 3);
    expect(ground.z).toBeCloseTo(cam.cz, 3);
  });

  it('keeps the camera focus at screen centre when grounded', () => {
    const cam = camera();
    const ground = cam.screenToGround(cam.width / 2, cam.height / 2, 0);
    expect(ground.x).toBeCloseTo(cam.cx, 3);
    expect(ground.z).toBeCloseTo(cam.cz, 3);
  });

  it('pans along the rotated screen axes, not world axes', () => {
    const cam = camera();
    const before = { x: cam.cx, z: cam.cz };
    cam.panScreen(120, 0);
    // Screen-right runs diagonally across the rotated map.
    expect(cam.cx).toBeLessThan(before.x);
    expect(cam.cz).toBeGreaterThan(before.z);
    expect(Math.abs(cam.cx - before.x)).toBeCloseTo(Math.abs(cam.cz - before.z), 4);
  });

  it('pans screen-relative view axes diagonally on the rotated map', () => {
    const cam = camera();
    const before = { x: cam.cx, z: cam.cz };
    cam.panView(60, 0);
    // Panning the view right moves the focus along the rotated right axis.
    expect(cam.cx).toBeGreaterThan(before.x);
    expect(cam.cz).toBeLessThan(before.z);
    const mid = { x: cam.cx, z: cam.cz };
    cam.panView(0, 60);
    expect(cam.cx).toBeGreaterThan(mid.x);
    expect(cam.cz).toBeGreaterThan(mid.z);
  });

  it('widens the opening view on narrow screens to keep the base in frame', () => {
    const wide = new Camera();
    wide.setViewport(1600, 900);
    wide.setBattleZoom();
    expect(wide.zoom).toBe(BATTLE_ZOOM);

    const narrow = new Camera();
    narrow.setViewport(1024, 768);
    narrow.setBattleZoom();
    expect(narrow.halfW).toBeCloseTo(52, 4);
  });

  it('clamps zoom-in at the close inspection limit', () => {
    const cam = camera();
    cam.setZoom(4);
    expect(cam.zoom).toBe(CLOSE_ZOOM);
    expect(cam.zoom).toBeLessThan(22);
    cam.zoomBy(0.9);
    expect(cam.zoom).toBe(CLOSE_ZOOM);
    cam.setZoom(80);
    expect(cam.zoom).toBe(80);
  });

  it('frames a focused point above the command deck', () => {
    const cam = camera();
    const before = cam.worldToScreen(200, 0, 200);
    cam.setScreenLift(90);
    cam.centerOn(200, 200);
    const after = cam.worldToScreen(200, 0, 200);
    expect(before.y - after.y).toBeCloseTo(90, 0);
    expect(after.x).toBeCloseTo(before.x, 0);
  });

  it('frames a focused point left of a persistent sidebar', () => {
    const cam = camera();
    const before = cam.worldToScreen(200, 0, 200);
    cam.setScreenLift(25, 174);
    cam.centerOn(200, 200);
    const after = cam.worldToScreen(200, 0, 200);
    expect(before.x - after.x).toBeCloseTo(174, 0);
    expect(before.y - after.y).toBeCloseTo(25, 0);
  });

  it('frames a focused point right of a persistent left rail', () => {
    const cam = camera();
    const before = cam.worldToScreen(200, 0, 200);
    cam.setScreenLift(0, -86);
    cam.centerOn(200, 200);
    const after = cam.worldToScreen(200, 0, 200);
    expect(after.x - before.x).toBeCloseTo(86, 0);
    expect(after.y).toBeCloseTo(before.y, 0);
  });

  it('clamps its focus to the map and a fraction of a view beyond it', () => {
    const cam = camera();
    cam.centerOn(-500, -500);
    // The overscan is half a view at most — measured on screen, so depth is
    // stretched by the isometric pitch — never an unbounded pan.
    const overX = Math.min(96 * 4 * 0.5, cam.halfW * 0.5);
    const overZ = Math.min(72 * 4 * 0.5, (cam.halfH * 0.5) / Math.max(0.2, Math.sin(cam.pitch)));
    expect(cam.cx).toBeGreaterThanOrEqual(-overX - 1e-6);
    expect(cam.cz).toBeGreaterThanOrEqual(-overZ - 1e-6);
    cam.centerOn(99999, 99999);
    expect(cam.cx).toBeLessThanOrEqual(96 * 4 + overX + 1e-6);
    expect(cam.cz).toBeLessThanOrEqual(72 * 4 + overZ + 1e-6);
  });

  it('reaches the map edge when zoomed in, so edge structures can be framed', () => {
    const cam = camera();
    cam.setZoom(CLOSE_ZOOM);
    // A structure one tile inside the boundary must be centreable; the old
    // eight-tile margin stopped the camera short of it at this zoom.
    cam.centerOn(4, 4);
    expect(cam.cx).toBeLessThanOrEqual(4);
    expect(cam.cz).toBeLessThanOrEqual(4);
    // And the map's far corner is reachable from the other side.
    cam.centerOn(96 * 4 - 4, 72 * 4 - 4);
    expect(cam.cx).toBeGreaterThanOrEqual(96 * 4 - 4);
    expect(cam.cz).toBeGreaterThanOrEqual(72 * 4 - 4);
  });
});
