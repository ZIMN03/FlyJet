import { CRASH, PHYSICS } from '../constants';
import type { Aircraft } from '../types';
import type { World } from '../world';
import { applyDamage } from './damage';

/** Absolute safety limit beyond the map edge; should never be reached in normal play. */
const HARD_LIMIT = 600;
const scratchNormal = { x: 0, y: 0 };

/**
 * Soft map boundaries: a push-back force that ramps up inside a margin near the
 * edges and ceiling, a warning state when past the edge, and damage only after
 * a grace period. Invisible walls are a last-resort safety net only.
 */
export function applyBoundaries(world: World, a: Aircraft, dt: number): void {
  const W = world.map.width;
  const M = PHYSICS.boundaryMargin;
  const k = PHYSICS.boundaryPushStrength;

  if (a.x < M) a.vx += (M - a.x) * k * dt;
  else if (a.x > W - M) a.vx -= (a.x - (W - M)) * k * dt;
  if (a.y < M) a.vy += (M - a.y) * k * dt;

  a.x = Math.max(-HARD_LIMIT, Math.min(W + HARD_LIMIT, a.x));
  a.y = Math.max(-HARD_LIMIT, a.y);

  a.outOfBounds = a.x < 0 || a.x > W || a.y < 0;
  if (a.outOfBounds) {
    a.outOfBoundsTime += dt;
    if (a.outOfBoundsTime > PHYSICS.boundaryGraceTime) {
      applyDamage(world, a, PHYSICS.boundaryDamagePerSecond * dt, 0, 'boundary');
    }
  } else {
    a.outOfBoundsTime = Math.max(0, a.outOfBoundsTime - dt * 2);
  }
}

/**
 * Terrain/sea collision. Instead of instant death, a crash costs a large chunk of
 * health and bounces the aircraft away along the surface normal — forgiving for
 * new players, but still a real punishment in a fight.
 */
export function applyTerrainCollision(world: World, a: Aircraft, dt: number): void {
  if (a.crashImmunity > 0) a.crashImmunity -= dt;
  const t = world.terrain;
  const r = a.def.radius * 0.7;
  if (!t.collides(a.x, a.y, r)) return;

  const water = a.y + r >= t.seaLevel - 1 && t.groundY(a.x) >= t.seaLevel - 1;
  if (water) {
    scratchNormal.x = 0;
    scratchNormal.y = -1;
  } else {
    t.normal(a.x, scratchNormal);
    // Hitting the side of a steep formation: the heightfield normal is nearly
    // horizontal; make sure it points away from where we came from.
    const dot = (a.x - a.px) * scratchNormal.x + (a.y - a.py) * scratchNormal.y;
    if (dot > 0) {
      scratchNormal.x = -scratchNormal.x;
      scratchNormal.y = -scratchNormal.y;
    }
  }

  // Step back to the last collision-free position.
  a.x = a.px;
  a.y = a.py;
  if (t.collides(a.x, a.y, r)) a.y = Math.min(a.y, t.groundY(a.x) - r - 2, t.seaLevel - r - 2);

  // Reflect and guarantee a minimum escape speed along the normal.
  const vn = a.vx * scratchNormal.x + a.vy * scratchNormal.y;
  a.vx -= 2 * vn * scratchNormal.x;
  a.vy -= 2 * vn * scratchNormal.y;
  const vn2 = a.vx * scratchNormal.x + a.vy * scratchNormal.y;
  if (vn2 < CRASH.bounceSpeed) {
    a.vx += (CRASH.bounceSpeed - vn2) * scratchNormal.x;
    a.vy += (CRASH.bounceSpeed - vn2) * scratchNormal.y;
  }
  a.heading = Math.atan2(a.vy, a.vx);
  a.speed = Math.max(a.def.minSpeed, Math.hypot(a.vx, a.vy) * 0.8);

  if (a.crashImmunity <= 0) {
    a.crashImmunity = CRASH.immunityTime;
    world.emit({ type: 'crash', id: a.id, x: a.x, y: a.y, water });
    applyDamage(world, a, a.def.health * CRASH.damageFraction, 0, 'crash');
  }
}
