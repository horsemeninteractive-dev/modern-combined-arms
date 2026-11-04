export interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size0: number;
  size1: number;
  r: number;
  g: number;
  b: number;
  alpha: number;
  gravity: number;
  drag: number;
  additive: boolean;
  /**
   * Vertical elongation in screen space, 1 = round. Rain and sparks are not
   * blobs: a falling drop and a burning ember both read as a short streak, and
   * stretching the quad along the camera's up axis is what sells that at this
   * camera pitch. Omitted means round.
   */
  stretch?: number;
  /** Edge softness, 0 = tight hot core, 1 = fully feathered puff. Default 0.5. */
  soft?: number;
  /** Sideways curl in tiles/s for smoke and dust. Default none. */
  turbulence?: number;
  /**
   * World-space axis the streak is drawn along. Rain is stretched down its fall
   * direction and sparks along their flight, so the quad has to be laid in
   * world space rather than billboarded on the camera's right axis — otherwise
   * every streak renders as a horizontal line.
   */
  dir?: readonly [number, number, number];
}

const MAX_PARTICLES = 2800;

export class ParticleSystem {
  particles: Particle[] = [];
  /** Graphics presets lower this; the authored ceiling is the default. */
  maxParticles = MAX_PARTICLES;
  /**
   * Prevailing wind, tiles per second, published by the renderer from the
   * battle's weather. Light particles drift toward it instead of obeying their
   * own initial puff, so a storm visibly leans the smoke column over.
   */
  wind: readonly [number, number] = [0, 0];
  private elapsed = 0;

  clear(): void {
    this.particles.length = 0;
  }

  /** Clamp the live ceiling and shed anything already above it. */
  setCap(cap: number): void {
    if (!Number.isFinite(cap)) return;
    this.maxParticles = Math.max(0, Math.floor(cap));
    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }
  }

  private push(p: Particle): void {
    if (this.particles.length >= this.maxParticles) {
      this.particles.shift();
    }
    this.particles.push(p);
  }

  update(dt: number): void {
    this.elapsed += dt;
    const windX = this.wind[0];
    const windZ = this.wind[1];
    // How strongly a particle is dragged toward the wind. Weightless puffs are
    // carried almost instantly; heavy sparks ignore it entirely.
    const carry = Math.min(1, dt * 1.1);
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const damping = Math.max(0, 1 - p.drag * dt);
      p.vx *= damping;
      p.vz *= damping;
      p.vy = p.vy * damping - p.gravity * dt;
      if (p.turbulence) {
        // A cheap curl field keyed on position, so neighbouring puffs do not
        // move in lockstep and a smoke column develops a ragged edge instead of
        // expanding as a perfect circle.
        const phase = this.elapsed * 1.7 + p.x * 0.35 + p.z * 0.27;
        p.vx += Math.sin(phase) * p.turbulence * dt;
        p.vz += Math.cos(phase * 1.13) * p.turbulence * dt;
        p.vy += Math.sin(phase * 0.7) * p.turbulence * 0.25 * dt;
      }
      if (!p.additive) {
        p.vx += (windX - p.vx) * carry * 0.7;
        p.vz += (windZ - p.vz) * carry * 0.7;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particles[write++] = p;
    }
    this.particles.length = write;
  }

  /**
   * One falling drop or flake, spawned in world space by the renderer.
   *
   * Rain is a long thin streak that fades as it falls; snow is a soft flake that
   * drifts on the wind and curls as it descends. Both are ordinary particles, so
   * they share the same cap, the same single draw call and the same graphics
   * preset as combat effects.
   */
  precipitation(
    x: number,
    z: number,
    wind: readonly [number, number],
    drop: boolean,
    strength = 1,
  ): void {
    const y = 13 + Math.random() * 9;
    // Intensity is a multiplier where 1 is a steady fall and a storm sits above
    // it. Heavier weather means more drops per second (the emitter's job), but
    // also faster, longer, less transparent ones: eighteen-millimetre drops are
    // not just more numerous than drizzle, they read differently.
    const heft = Math.min(2.2, Math.max(0.4, strength));
    if (drop) {
      const fall = (19 + Math.random() * 9) * (0.86 + 0.14 * heft);
      const life = (y / fall) * (0.85 + Math.random() * 0.3);
      // Driven rain leans hard into the wind: in a storm the drops run at about
      // twenty degrees off vertical, which is what makes the weather look like
      // it is doing something to the battlefield.
      const driftX = wind[0] * 1.8;
      const driftZ = wind[1] * 1.8;
      const tilt = Math.hypot(driftX, fall, driftZ) || 1;
      this.push({
        x,
        y,
        z,
        vx: driftX,
        vy: -fall,
        vz: driftZ,
        life,
        maxLife: life,
        size0: (0.052 + Math.random() * 0.03) * (0.9 + 0.16 * heft),
        size1: 0.045 * (0.9 + 0.16 * heft),
        r: 0.66,
        g: 0.76,
        b: 0.92,
        alpha: 0.32 + 0.17 * heft,
        gravity: 0,
        drag: 0,
        additive: false,
        stretch: 9 + 3 * heft,
        soft: 0.1,
        dir: [driftX / tilt, -fall / tilt, driftZ / tilt],
      });
      return;
    }
    // A flake crosses the same column of air as a drop but takes its time: the
    // larger the fall rate the less time it has to drift.
    const life = (2.6 + Math.random() * 2.2) / (0.85 + 0.15 * heft);
    const drift = 0.5 + Math.random() * 0.6;
    this.push({
      x,
      y,
      z,
      vx: wind[0] * drift + (Math.random() - 0.5) * 0.5,
      vy: -(1.5 + Math.random() * 1.4),
      vz: wind[1] * drift + (Math.random() - 0.5) * 0.5,
      life,
      maxLife: life,
      size0: (0.1 + Math.random() * 0.06) * (0.85 + 0.3 * heft),
      size1: 0.07 * (0.85 + 0.3 * heft),
      r: 0.9,
      g: 0.93,
      b: 0.99,
      alpha: 0.34 + 0.2 * heft,
      gravity: 0,
      drag: 0.35,
      additive: false,
      soft: 0.95,
      turbulence: 0.8,
      dir: [wind[0] * 0.4, -1, wind[1] * 0.4],
    });
  }

  /**
   * One low, slow bank of ground mist.
   *
   * Ten seconds of life at a few metres a second is what makes fog read as a
   * volume: the banks move perceptibly, pass in front of a hull and behind the
   * next one, and grow as they thin. Almost transparent per sprite, so several
   * overlapping banks build thickness instead of one grey blob.
   */
  mist(x: number, z: number, wind: readonly [number, number], strength = 1): void {
    const y = 0.4 + Math.random() * 1.7;
    // Short-lived on purpose. Fog banks are read from their motion, not from
    // their total opacity: a dozen faint sheets crossing the field look like
    // weather, while sixty of them stack into a white wash that hides the
    // battlefield the player is trying to command.
    const life = 5 + Math.random() * 4;
    const bright = 0.54 + Math.random() * 0.1;
    this.push({
      x,
      y,
      z,
      vx: wind[0] * (0.55 + Math.random() * 0.4),
      vy: 0.02 + Math.random() * 0.04,
      vz: wind[1] * (0.55 + Math.random() * 0.4),
      life,
      maxLife: life,
      size0: 2.2 + Math.random() * 1.6,
      size1: 5 + Math.random() * 3,
      r: bright * 0.97,
      g: bright,
      b: bright * 1.02,
      alpha: (0.028 + Math.random() * 0.026) * Math.min(1, strength),
      gravity: 0,
      drag: 0.12,
      additive: false,
      soft: 1,
      turbulence: 0.3,
    });
  }

  /** Bright flash + fireball + sparks + smoke. */
  explosion(x: number, y: number, z: number, scale = 1, teamColor?: [number, number, number]): void {
    // The flash is a tight hot core rather than a soft disc: a detonation has a
    // hard edge for the two frames it lasts.
    this.push({
      x, y: y + 0.5, z, vx: 0, vy: 0.2, vz: 0,
      life: 0.28, maxLife: 0.28, size0: 2.2 * scale, size1: 6.2 * scale,
      r: 1, g: 0.82, b: 0.5, alpha: 0.95, gravity: 0, drag: 0, additive: true,
      soft: 0.25,
    });
    // A ground-hugging shockwave ring: wide, flat, faint and very short-lived.
    // It is what makes a large blast read as pressure rather than a bright puff.
    this.push({
      x, y: y + 0.15, z, vx: 0, vy: 0, vz: 0,
      life: 0.34, maxLife: 0.34,
      size0: 1.6 * scale, size1: 7.5 * scale,
      r: 1, g: 0.86, b: 0.62, alpha: 0.16, gravity: 0, drag: 0, additive: true,
      soft: 0.85,
    });
    const fireCount = Math.round(10 + 8 * scale);
    for (let i = 0; i < fireCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (2 + Math.random() * 9) * Math.sqrt(scale);
      this.push({
        x, y: y + 0.4 + Math.random() * 1.8, z,
        vx: Math.cos(a) * sp,
        vy: 2 + Math.random() * 7 * scale,
        vz: Math.sin(a) * sp,
        life: 0.35 + Math.random() * 0.55,
        maxLife: 0.9,
        size0: 0.7 + Math.random() * 1.3,
        size1: 0.2,
        r: 1, g: 0.45 + Math.random() * 0.35, b: 0.08,
        alpha: 0.95, gravity: 9, drag: 2.4, additive: true,
        // Fireballs are torn along their trajectory, not spherical.
        stretch: 1 + Math.random() * 0.5, soft: 0.4,
      });
    }
    const smokeCount = Math.round(5 + 6 * scale);
    for (let i = 0; i < smokeCount; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (0.4 + Math.random() * 2.0) * scale;
      const grey = 0.16 + Math.random() * 0.12;
      this.push({
        x: x + (Math.random() - 0.5) * 2, y: y + 0.7 + Math.random() * 1.6, z: z + (Math.random() - 0.5) * 2,
        vx: Math.cos(a) * sp, vy: 0.4 + Math.random() * 1.4, vz: Math.sin(a) * sp,
        life: 1.6 + Math.random() * 2.4, maxLife: 4,
        size0: 1.4 + Math.random() * 1.2, size1: 5.0 + Math.random() * 3.5,
        r: grey, g: grey, b: grey * 0.96,
        alpha: 0.34, gravity: -0.35, drag: 0.7, additive: false,
        soft: 1, turbulence: 0.5 + Math.random() * 0.5,
      });
    }
    if (teamColor) {
      for (let i = 0; i < 6; i++) {
        const a = Math.random() * Math.PI * 2;
        this.push({
          x, y: y + 0.8, z, vx: Math.cos(a) * 6, vy: 2 + Math.random() * 4, vz: Math.sin(a) * 6,
          life: 0.35, maxLife: 0.35, size0: 0.5, size1: 0.1,
          r: teamColor[0], g: teamColor[1], b: teamColor[2],
          alpha: 0.8, gravity: 12, drag: 1, additive: true,
        });
      }
    }
  }

  impact(x: number, y: number, z: number, onWater: boolean, scale = 1): void {
    const count = Math.max(2, Math.round((onWater ? 8 : 5) * scale));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = (1 + Math.random() * 4) * Math.sqrt(scale);
      this.push({
        x, y: y + 0.2, z,
        vx: Math.cos(a) * sp, vy: (1 + Math.random() * 3.5) * scale, vz: Math.sin(a) * sp,
        life: 0.25 + Math.random() * 0.35, maxLife: 0.6,
        size0: 0.35 * scale, size1: 0.08,
        r: onWater ? 0.65 : 1, g: onWater ? 0.8 : 0.66, b: onWater ? 0.85 : 0.26,
        alpha: 0.9, gravity: 12, drag: 1.2, additive: !onWater,
      });
    }
    this.dust(x, y, z, onWater ? 1 : Math.max(1, Math.round(2 * scale)), onWater ? 0.55 : 0.36);
  }

  muzzle(x: number, y: number, z: number, scale = 1, smoke = 1): void {
    this.push({
      x, y, z, vx: 0, vy: 0.4, vz: 0,
      life: 0.1, maxLife: 0.1, size0: 0.8 * scale, size1: 1.2 * scale,
      r: 1, g: 0.74, b: 0.32, alpha: 0.9, gravity: 0, drag: 0, additive: true,
    });
    if (smoke > 0) this.smoke(x, y + 0.1, z, smoke, 0.55);
  }

  /** A destroyed vehicle or squad: smoke and a small fire, not a second blast. */
  wreck(x: number, y: number, z: number, scale = 1, armoured = true): void {
    this.push({
      x, y: y + 0.35, z, vx: 0, vy: 0.55, vz: 0,
      life: 0.22 + 0.12 * scale, maxLife: 0.34,
      size0: 0.65 * scale, size1: 0.15,
      r: 1, g: 0.52, b: 0.14, alpha: 0.75, gravity: 3, drag: 1.2, additive: true,
    });
    if (armoured) {
      this.smoke(x, y + 0.5, z, 4, 0.16);
      this.dust(x, y + 0.2, z, 3, 0.24);
    } else {
      this.smoke(x, y + 0.3, z, 2, 0.28);
      this.dust(x, y + 0.1, z, 2, 0.32);
    }
  }

  /** A small, repeated flame licking out of a burning hull. */
  wreckFlame(x: number, y: number, z: number, scale = 1): void {
    this.push({
      x: x + (Math.random() - 0.5) * 0.7,
      y: y + Math.random() * 0.35,
      z: z + (Math.random() - 0.5) * 0.7,
      vx: (Math.random() - 0.5) * 0.35,
      vy: 0.35 + Math.random() * 0.45,
      vz: (Math.random() - 0.5) * 0.35,
      life: 0.24 + Math.random() * 0.18,
      maxLife: 0.42,
      size0: 0.32 * scale,
      size1: 0.06,
      r: 1, g: 0.5 + Math.random() * 0.18, b: 0.08,
      alpha: 0.72, gravity: -0.15, drag: 0.6, additive: true,
    });
  }

  /** A structure falling in: dust and smoke, with only a small residual flame. */
  collapse(x: number, y: number, z: number, scale = 1): void {
    this.dust(x, y + 0.4, z, Math.round(14 + 6 * scale), 0.3);
    this.smoke(x, y + 1.2, z, Math.round(6 + 4 * scale), 0.2);
    this.push({
      x, y: y + 1, z, vx: 0, vy: 0.8, vz: 0,
      life: 0.35, maxLife: 0.35,
      size0: 1.1 * scale, size1: 0.2,
      r: 1, g: 0.45, b: 0.12, alpha: 0.65, gravity: 2, drag: 1, additive: true,
    });
  }

  smoke(x: number, y: number, z: number, count: number, tint = 0.4): void {
    for (let i = 0; i < count; i++) {
      const life = 1.2 + Math.random() * 1.8;
      this.push({
        x: x + (Math.random() - 0.5) * 1.2,
        y: y + Math.random() * 0.7,
        z: z + (Math.random() - 0.5) * 1.2,
        vx: (Math.random() - 0.5) * 0.7,
        vy: 0.4 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.7,
        life,
        maxLife: life,
        size0: 0.5,
        size1: 2.2 + Math.random() * 1.4,
        r: tint, g: tint, b: tint * 0.95, alpha: 0.22,
        gravity: -0.3, drag: 0.6, additive: false,
        // Fully feathered, with its own curl phase so a column of puffs breaks
        // up instead of reading as one expanding disc.
        soft: 1, turbulence: 0.4 + Math.random() * 0.5,
      });
    }
  }

  /**
   * One emission of a smoke screen: large, soft, slow puffs spread across the
   * cloud footprint instead of a thin column from a single point. `radius` and
   * `density` come from the authoritative cloud, so the visible cloud is the
   * same size as the obstruction and thins out as its clock runs down.
   */
  smokeScreen(x: number, y: number, z: number, radius: number, density = 1): void {
    const count = Math.max(1, Math.round(4 * density));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * Math.sqrt(Math.random()) * 0.85;
      const life = 2.1 + Math.random() * 1.5;
      this.push({
        x: x + Math.cos(a) * r,
        y: y + Math.random() * 0.9,
        z: z + Math.sin(a) * r,
        vx: (Math.random() - 0.5) * 0.35,
        vy: 0.22 + Math.random() * 0.3,
        vz: (Math.random() - 0.5) * 0.35,
        life,
        maxLife: life,
        size0: radius * 0.5,
        size1: radius * 1.05,
        r: 0.66, g: 0.66, b: 0.63,
        alpha: 0.1 + 0.16 * density,
        gravity: -0.04,
        drag: 0.5,
        additive: false,
        soft: 1,
        turbulence: 0.22,
      });
    }
  }

  dust(x: number, y: number, z: number, count: number, tint = 0.4): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 1.6;
      const life = 0.7 + Math.random() * 1.2;
      this.push({
        x: x + (Math.random() - 0.5) * 1.4,
        y: y + Math.random() * 0.5,
        z: z + (Math.random() - 0.5) * 1.4,
        vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.7, vz: Math.sin(a) * sp,
        life,
        maxLife: life,
        size0: 0.45,
        size1: 1.7 + Math.random(),
        r: tint, g: tint * 0.92, b: tint * 0.75, alpha: 0.24,
        gravity: -0.15, drag: 1.1, additive: false,
        soft: 0.95, turbulence: 0.3 + Math.random() * 0.35,
      });
    }
  }

  trackDust(x: number, y: number, z: number, angle: number): void {
    const px = x - Math.cos(angle) * 1.4;
    const pz = z - Math.sin(angle) * 1.4;
    this.push({
      x: px + (Math.random() - 0.5), y: y + 0.15, z: pz + (Math.random() - 0.5),
      vx: -Math.cos(angle) * 0.9 + (Math.random() - 0.5) * 0.7,
      vy: 0.3 + Math.random() * 0.4,
      vz: -Math.sin(angle) * 0.9 + (Math.random() - 0.5) * 0.7,
      life: 0.7 + Math.random() * 0.8, maxLife: 1.5,
      size0: 0.35, size1: 1.5, r: 0.36, g: 0.32, b: 0.24, alpha: 0.2,
      gravity: -0.1, drag: 1.2, additive: false,
      soft: 0.95, turbulence: 0.2,
    });
  }

  wake(x: number, y: number, z: number, angle: number, distance = 4): void {
    const px = x - Math.cos(angle) * distance;
    const pz = z - Math.sin(angle) * distance;
    this.push({
      x: px + (Math.random() - 0.5) * 1.6, y: y + 0.05, z: pz + (Math.random() - 0.5) * 1.6,
      vx: -Math.cos(angle) * 0.4,
      vy: 0.06,
      vz: -Math.sin(angle) * 0.4,
      life: 0.8 + Math.random() * 0.9, maxLife: 1.7,
      size0: 0.6, size1: 2.0, r: 0.62, g: 0.76, b: 0.8, alpha: 0.22,
      gravity: 0, drag: 0.8, additive: false, soft: 0.95,
    });
  }

  jetTrail(x: number, y: number, z: number): void {
    this.push({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
      vx: 0, vy: -0.1, vz: 0,
      life: 0.6 + Math.random() * 0.7, maxLife: 1.3,
      size0: 0.25, size1: 1.1, r: 0.55, g: 0.58, b: 0.6, alpha: 0.2,
      gravity: 0, drag: 0.2, additive: false, soft: 0.9,
    });
  }

  damageSmoke(x: number, y: number, z: number, severe: boolean): void {
    this.push({
      x: x + (Math.random() - 0.5) * 1.2, y, z: z + (Math.random() - 0.5) * 1.2,
      vx: (Math.random() - 0.5) * 0.4, vy: 0.7 + Math.random() * 0.6, vz: (Math.random() - 0.5) * 0.4,
      life: 1.8 + Math.random() * 2.2, maxLife: 4,
      size0: 0.5, size1: severe ? 3.2 : 2.2,
      r: severe ? 0.11 : 0.25, g: severe ? 0.11 : 0.25, b: severe ? 0.11 : 0.24,
      alpha: severe ? 0.36 : 0.2, gravity: -0.25, drag: 0.5, additive: false,
      soft: 1, turbulence: 0.35 + Math.random() * 0.4,
    });
  }

  capture(x: number, y: number, z: number, color: [number, number, number]): void {
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      this.push({
        x, y: y + 0.5 + Math.random() * 5, z,
        vx: Math.cos(a) * 2.2, vy: 0.4, vz: Math.sin(a) * 2.2,
        life: 0.8, maxLife: 0.8,
        size0: 0.45, size1: 0.1,
        r: color[0], g: color[1], b: color[2], alpha: 0.8,
        gravity: -0.2, drag: 1.4, additive: true,
      });
    }
  }

  /** A direct hit on infantry: a small bright impact, not a ground miss puff. */
  hit(x: number, y: number, z: number, scale = 1): void {
    this.push({
      x, y, z, vx: 0, vy: 0.3, vz: 0,
      life: 0.12, maxLife: 0.12, size0: 0.55 * scale, size1: 0.12,
      r: 1, g: 0.74, b: 0.38, alpha: 0.8, gravity: 2, drag: 0.8, additive: true,
    });
    this.sparks(x, y, z, Math.max(0.45, scale * 0.6));
    this.dust(x, y, z, 1, 0.3);
  }

  /**
   * One frame of a cutting beam from the harvester's drum to the seam face.
   *
   * The particle pass already lays a streak along a world axis, so the beam is
   * one stretched additive quad re-emitted a few times a second rather than a
   * line mesh rebuilt every frame. The sprite's rounded ends keep it reading as
   * a cutting arc instead of a ruler.
   */
  cutBeam(
    x0: number,
    y0: number,
    z0: number,
    x1: number,
    y1: number,
    z1: number,
    width = 0.12,
  ): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    const w = width * (0.9 + Math.random() * 0.25);
    this.push({
      x: (x0 + x1) / 2,
      y: (y0 + y1) / 2,
      z: (z0 + z1) / 2,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0.07,
      maxLife: 0.07,
      size0: w,
      size1: w * 0.75,
      r: 1,
      g: 0.88,
      b: 0.5,
      alpha: 0.5 + Math.random() * 0.24,
      gravity: 0,
      drag: 0,
      additive: true,
      // The quad spans size * stretch either side of its centre, so this is the
      // beam length restated as a stretch factor.
      stretch: len / (2 * w),
      soft: 0.12,
      dir: [dx / len, dy / len, dz / len],
    });
    // A hot spot where the cutter touches mineral, so the beam has a source of
    // light rather than ending in mid-air.
    this.push({
      x: x1,
      y: y1,
      z: z1,
      vx: 0,
      vy: 0.2,
      vz: 0,
      life: 0.08,
      maxLife: 0.08,
      size0: 0.55,
      size1: 0.16,
      r: 1,
      g: 0.9,
      b: 0.56,
      alpha: 0.8,
      gravity: 0,
      drag: 0,
      additive: true,
      soft: 0.2,
    });
  }

  /** Gold chips thrown off the seam face and pulled back into the intake. */
  oreChips(
    x: number,
    y: number,
    z: number,
    towardX: number,
    towardY: number,
    towardZ: number,
  ): void {
    for (let i = 0; i < 2; i++) {
      const px = x + (Math.random() - 0.5) * 0.55;
      const py = y + (Math.random() - 0.5) * 0.55;
      const pz = z + (Math.random() - 0.5) * 0.55;
      let dx = towardX - px;
      let dy = towardY - py + 0.9 + Math.random() * 1.1;
      let dz = towardZ - pz;
      const len = Math.hypot(dx, dy, dz) || 1;
      const speed = 6 + Math.random() * 5;
      dx = (dx / len) * speed;
      dy = (dy / len) * speed;
      dz = (dz / len) * speed;
      const life = 0.18 + Math.random() * 0.12;
      this.push({
        x: px,
        y: py,
        z: pz,
        vx: dx,
        vy: dy,
        vz: dz,
        life,
        maxLife: life,
        size0: 0.2 + Math.random() * 0.08,
        size1: 0.05,
        r: 1,
        g: 0.74 + Math.random() * 0.14,
        b: 0.26,
        alpha: 0.9,
        gravity: 7,
        drag: 1.4,
        additive: true,
        stretch: 1.8,
        soft: 0.18,
        dir: [dx / speed, dy / speed, dz / speed],
      });
    }
  }

  sparks(x: number, y: number, z: number, scale = 1): void {
    const count = Math.max(2, Math.round(4 * scale));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const vx = Math.cos(a) * 4 * scale;
      const vy = (2 + Math.random() * 4) * scale;
      const vz = Math.sin(a) * 4 * scale;
      const len = Math.hypot(vx, vy, vz) || 1;
      this.push({
        x, y, z, vx, vy, vz,
        life: 0.28, maxLife: 0.3, size0: 0.3 * scale, size1: 0.05,
        r: 1, g: 0.75, b: 0.3, alpha: 0.9, gravity: 14, drag: 0, additive: true,
        // Each ember is a short hot streak along its own flight path.
        stretch: 2.4, soft: 0.1,
        dir: [vx / len, vy / len, vz / len],
      });
    }
  }
}
