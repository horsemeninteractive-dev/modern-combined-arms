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
}

const MAX_PARTICLES = 2800;

export class ParticleSystem {
  particles: Particle[] = [];
  /** Graphics presets lower this; the authored ceiling is the default. */
  maxParticles = MAX_PARTICLES;

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
    let write = 0;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      const damping = Math.max(0, 1 - p.drag * dt);
      p.vx *= damping;
      p.vz *= damping;
      p.vy = p.vy * damping - p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      this.particles[write++] = p;
    }
    this.particles.length = write;
  }

  /** Bright flash + fireball + sparks + smoke. */
  explosion(x: number, y: number, z: number, scale = 1, teamColor?: [number, number, number]): void {
    this.push({
      x, y: y + 0.5, z, vx: 0, vy: 0.2, vz: 0,
      life: 0.28, maxLife: 0.28, size0: 2.2 * scale, size1: 6.2 * scale,
      r: 1, g: 0.82, b: 0.5, alpha: 0.95, gravity: 0, drag: 0, additive: true,
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
      this.push({
        x: x + (Math.random() - 0.5) * 1.2,
        y: y + Math.random() * 0.7,
        z: z + (Math.random() - 0.5) * 1.2,
        vx: (Math.random() - 0.5) * 0.7,
        vy: 0.4 + Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.7,
        life: 1.2 + Math.random() * 1.8, maxLife: 3,
        size0: 0.5, size1: 2.2 + Math.random() * 1.4,
        r: tint, g: tint, b: tint * 0.95, alpha: 0.22,
        gravity: -0.3, drag: 0.6, additive: false,
      });
    }
  }

  dust(x: number, y: number, z: number, count: number, tint = 0.4): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.5 + Math.random() * 1.6;
      this.push({
        x: x + (Math.random() - 0.5) * 1.4,
        y: y + Math.random() * 0.5,
        z: z + (Math.random() - 0.5) * 1.4,
        vx: Math.cos(a) * sp, vy: 0.3 + Math.random() * 0.7, vz: Math.sin(a) * sp,
        life: 0.7 + Math.random() * 1.2, maxLife: 2,
        size0: 0.45, size1: 1.7 + Math.random(),
        r: tint, g: tint * 0.92, b: tint * 0.75, alpha: 0.24,
        gravity: -0.15, drag: 1.1, additive: false,
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
      gravity: 0, drag: 0.8, additive: false,
    });
  }

  jetTrail(x: number, y: number, z: number): void {
    this.push({
      x: x + (Math.random() - 0.5) * 0.4, y, z: z + (Math.random() - 0.5) * 0.4,
      vx: 0, vy: -0.1, vz: 0,
      life: 0.6 + Math.random() * 0.7, maxLife: 1.3,
      size0: 0.25, size1: 1.1, r: 0.55, g: 0.58, b: 0.6, alpha: 0.2,
      gravity: 0, drag: 0.2, additive: false,
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

  sparks(x: number, y: number, z: number, scale = 1): void {
    const count = Math.max(2, Math.round(4 * scale));
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      this.push({
        x, y, z, vx: Math.cos(a) * 4 * scale, vy: (2 + Math.random() * 4) * scale, vz: Math.sin(a) * 4 * scale,
        life: 0.28, maxLife: 0.3, size0: 0.3 * scale, size1: 0.05,
        r: 1, g: 0.75, b: 0.3, alpha: 0.9, gravity: 14, drag: 0, additive: true,
      });
    }
  }
}
