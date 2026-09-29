import type { MapDef } from './config/maps';
import { smoothstep } from './math';

/** Cheap deterministic 1D value noise built from incommensurate sines. */
function ridgeNoise(x: number, seed: number): number {
  return (
    Math.sin(x * 0.0113 + seed * 1.7) * 0.5 +
    Math.sin(x * 0.0291 + seed * 3.1) * 0.3 +
    Math.sin(x * 0.0717 + seed * 5.3) * 0.2
  );
}

/**
 * Baked terrain heightfield. `groundY(x)` returns the world y of the solid surface
 * (y grows downward). Sea is treated as solid: the sea surface is the lowest ground.
 */
export class Terrain {
  readonly step: number;
  readonly seaLevel: number;
  readonly width: number;
  readonly heights: Float32Array;

  constructor(map: MapDef) {
    this.step = map.terrainStep;
    this.seaLevel = map.seaLevel;
    this.width = map.width;
    const n = Math.ceil(map.width / this.step) + 2;
    this.heights = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = i * this.step;
      let h = 0;
      for (let k = 0; k < map.landmasses.length; k++) {
        const lm = map.landmasses[k];
        const half = lm.width / 2;
        const t = Math.abs(x - lm.x) / half;
        if (t >= 1) continue;
        const shape = 1 - smoothstep(1 - lm.slope, 1, t);
        let lh = lm.height * shape;
        if (lh > 0) lh += lm.rough * ridgeNoise(x, k + 1) * shape;
        if (lh > h) h = lh;
      }
      this.heights[i] = map.seaLevel - Math.max(0, h);
    }
  }

  groundY(x: number): number {
    const fx = x / this.step;
    if (fx <= 0) return this.heights[0];
    const last = this.heights.length - 1;
    if (fx >= last) return this.heights[last];
    const i = fx | 0;
    const t = fx - i;
    return this.heights[i] + (this.heights[i + 1] - this.heights[i]) * t;
  }

  /** True if a circle at (x,y) with radius r touches ground or sea. */
  collides(x: number, y: number, r: number): boolean {
    if (y + r >= this.seaLevel) return true;
    // Sample under the circle's span so thin sea stacks can't be clipped through.
    return (
      y + r * 0.6 >= this.groundY(x) ||
      y >= this.groundY(x - r) ||
      y >= this.groundY(x + r)
    );
  }

  /**
   * Unit surface normal (pointing out of the ground, i.e. upward-ish) at x.
   * Writes into `out` to avoid allocation.
   */
  normal(x: number, out: { x: number; y: number }): void {
    const dx = this.step * 2;
    const slope = (this.groundY(x + dx) - this.groundY(x - dx)) / (dx * 2);
    // Surface tangent is (1, slope); the outward normal is (slope, -1) normalized.
    const len = Math.hypot(slope, 1);
    out.x = slope / len;
    out.y = -1 / len;
  }

  /** Height above the ground at a point (negative = inside ground). */
  clearance(x: number, y: number): number {
    return this.groundY(x) - y;
  }
}
