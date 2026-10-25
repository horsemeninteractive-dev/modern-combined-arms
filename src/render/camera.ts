import { TILE_SIZE } from '../sim/constants';
import { clamp, cross, normalize, type Vec3 } from './math';

/**
 * Classic 2:1 dimetric isometric view, as used by the reference RTS games:
 * the map is rotated 45° and viewed from 30° above the horizon. With an
 * orthographic projection that turns every square tile into a 2:1 diamond.
 */
const YAW = Math.PI / 4;
const PITCH = (30 * Math.PI) / 180;
const DISTANCE = 1400;

/**
 * Battlefield zoom: one tile projects to roughly a 60×30 px diamond at
 * desktop widths, matching the reference RTS. The base then reads as part of
 * the battlefield instead of filling it.
 */
export const BATTLE_ZOOM = 36;

export class Camera {
  cx = 0;
  cz = 0;
  /** Half-height of the orthographic view in world units. */
  zoom = 40;
  aspect = 16 / 9;
  width = 1;
  height = 1;
  pitch = PITCH;
  /** Screen-shake offset, applied by the renderer only. */
  shakeX = 0;
  shakeY = 0;
  /** Pixels to raise a framed focus above the viewport centre for HUD room. */
  screenLift = 0;
  /**
   * Pixels to shift a framed focus horizontally for persistent HUD columns:
   * positive when the right sidebar outweighs the left rail, negative when the
   * left rail does.
   */
  screenLiftX = 0;

  eye: Vec3 = [0, 0, 0];
  forward: Vec3 = [0, -1, 0];
  right: Vec3 = [1, 0, 0];
  up: Vec3 = [0, 0, -1];
  halfW = 62;
  halfH = 62;
  private mapW = 1;
  private mapH = 1;

  setViewport(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.aspect = this.width / this.height;
    this.update();
  }

  setMap(widthTiles: number, heightTiles: number): void {
    this.mapW = widthTiles * TILE_SIZE;
    this.mapH = heightTiles * TILE_SIZE;
    this.cx = clamp(this.cx, 0, this.mapW);
    this.cz = clamp(this.cz, 0, this.mapH);
    this.update();
  }

  centerOn(x: number, z: number): void {
    this.cx = x;
    this.cz = z;
    // Keep the framed ground point centred in the battlefield area above the
    // command deck rather than behind it.
    if (this.screenLift !== 0) {
      const groundPerPixelY = this.halfH * 2 / this.height / Math.max(0.2, Math.sin(this.pitch));
      const lift = this.screenLift * groundPerPixelY;
      this.cx += lift * Math.sin(YAW);
      this.cz += lift * Math.cos(YAW);
    }
    // Persistent HUD columns move the usable battlefield centre away from the
    // viewport centre. Move the camera along its screen-right axis so the framed
    // point lands in the clear region, not under a panel or a rail.
    if (this.screenLiftX !== 0) {
      const groundPerPixelX = (this.halfW * 2) / this.width;
      const liftX = this.screenLiftX * groundPerPixelX;
      this.cx += liftX * this.right[0];
      this.cz += liftX * this.right[2];
    }
    this.clampToMap();
    this.update();
  }

  setScreenLift(pixels: number, horizontalPixels = 0): void {
    this.screenLift = Math.max(0, pixels);
    // Horizontal is signed: a left rail can shift the clear centre right.
    this.screenLiftX = horizontalPixels;
  }

  setZoom(halfHeight: number): void {
    this.zoom = clamp(halfHeight, 22, 110);
    this.update();
  }

  /**
   * Battlefield framing at start: keep the reference cell size on wide
   * screens, but widen the view on narrow ones so the opening base stays in
   * frame instead of being cropped by the HUD edges.
   */
  setBattleZoom(minHalfWidth = 52): void {
    this.setZoom(Math.max(BATTLE_ZOOM, minHalfWidth / Math.max(0.1, this.aspect)));
  }

  zoomBy(factor: number): void {
    this.setZoom(this.zoom * factor);
  }

  update(): void {
    this.halfH = this.zoom;
    this.halfW = this.zoom * this.aspect;
    const s = Math.sin(this.pitch);
    const c = Math.cos(this.pitch);
    this.forward = normalize([-Math.sin(YAW) * c, -s, -Math.cos(YAW) * c]);
    this.right = normalize(cross(this.forward, [0, 1, 0]));
    this.up = normalize(cross(this.right, this.forward));
    this.eye = [
      this.cx - this.forward[0] * DISTANCE + this.shakeX,
      -this.forward[1] * DISTANCE + this.shakeY,
      this.cz - this.forward[2] * DISTANCE,
    ];
  }

  private clampToMap(): void {
    const marginX = Math.min(this.mapW * 0.5, 8 * TILE_SIZE);
    const marginZ = Math.min(this.mapH * 0.5, 8 * TILE_SIZE);
    this.cx = clamp(this.cx, marginX, this.mapW - marginX);
    this.cz = clamp(this.cz, marginZ, this.mapH - marginZ);
  }

  panScreen(dx: number, dy: number): void {
    const worldPerPixelX = (this.halfW * 2) / this.width;
    const worldPerPixelY = (this.halfH * 2) / this.height;
    // Screen-right follows the camera's right vector on the ground plane.
    this.cx -= dx * worldPerPixelX * this.right[0];
    this.cz -= dx * worldPerPixelX * this.right[2];
    // Screen-down follows the ground projection of the view direction; a
    // pitched view compresses ground depth by sin(pitch).
    const groundPerPixelY = worldPerPixelY / Math.max(0.2, Math.sin(this.pitch));
    this.cx += dy * groundPerPixelY * Math.sin(YAW);
    this.cz += dy * groundPerPixelY * Math.cos(YAW);
    this.clampToMap();
    this.update();
  }

  panWorld(dx: number, dz: number): void {
    this.cx += dx;
    this.cz += dz;
    this.clampToMap();
    this.update();
  }

  /**
   * Pan by world-unit distances measured on screen: positive `right` moves the
   * view right, positive `down` moves it down. Keeps keyboard, edge and gamepad
   * panning aligned with the rotated isometric screen.
   */
  panView(right: number, down: number): void {
    const px = (right * this.width) / (2 * this.halfW);
    const py = (down * this.height) / (2 * this.halfH);
    this.panScreen(-px, py);
  }

  /** Orthographic view ray through a client-space point, in world space. */
  screenRay(px: number, py: number): { origin: Vec3; direction: Vec3 } {
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    return {
      origin: [
        this.eye[0] + this.right[0] * ndcX * this.halfW + this.up[0] * ndcY * this.halfH,
        this.eye[1] + this.right[1] * ndcX * this.halfW + this.up[1] * ndcY * this.halfH,
        this.eye[2] + this.right[2] * ndcX * this.halfW + this.up[2] * ndcY * this.halfH,
      ],
      direction: this.forward,
    };
  }

  /** Convert a client-space point to an approximate point on the ground plane. */
  screenToGround(px: number, py: number, planeY = 0.6): { x: number; z: number } {
    const ndcX = (px / this.width) * 2 - 1;
    const ndcY = 1 - (py / this.height) * 2;
    const ox = this.eye[0] + this.right[0] * ndcX * this.halfW + this.up[0] * ndcY * this.halfH;
    const oy = this.eye[1] + this.right[1] * ndcX * this.halfW + this.up[1] * ndcY * this.halfH;
    const oz = this.eye[2] + this.right[2] * ndcX * this.halfW + this.up[2] * ndcY * this.halfH;
    const t = (planeY - oy) / this.forward[1];
    return { x: ox + this.forward[0] * t, z: oz + this.forward[2] * t };
  }

  /** Convert world to CSS-pixel coordinates. */
  worldToScreen(x: number, y: number, z: number): { x: number; y: number; depth: number; visible: boolean } {
    const rx = x - this.eye[0];
    const ry = y - this.eye[1];
    const rz = z - this.eye[2];
    const camX =
      rx * this.right[0] + ry * this.right[1] + rz * this.right[2];
    const camY = rx * this.up[0] + ry * this.up[1] + rz * this.up[2];
    const depth =
      rx * this.forward[0] + ry * this.forward[1] + rz * this.forward[2];
    const ndcX = camX / this.halfW;
    const ndcY = camY / this.halfH;
    return {
      x: (ndcX * 0.5 + 0.5) * this.width,
      y: (1 - (ndcY * 0.5 + 0.5)) * this.height,
      depth,
      visible: Math.abs(ndcX) < 1.15 && Math.abs(ndcY) < 1.15,
    };
  }

  /** Visible world rectangle used for culling and the minimap. */
  viewRect(): { x0: number; z0: number; x1: number; z1: number } {
    const corners = [
      this.screenToGround(0, 0, 1),
      this.screenToGround(this.width, 0, 1),
      this.screenToGround(0, this.height, 1),
      this.screenToGround(this.width, this.height, 1),
    ];
    let x0 = Infinity;
    let z0 = Infinity;
    let x1 = -Infinity;
    let z1 = -Infinity;
    for (const c of corners) {
      x0 = Math.min(x0, c.x);
      z0 = Math.min(z0, c.z);
      x1 = Math.max(x1, c.x);
      z1 = Math.max(z1, c.z);
    }
    return { x0, z0, x1, z1 };
  }
}
