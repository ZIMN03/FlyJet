import { FLIGHT } from '../config/flight';
import { segmentPointDist2 } from '../math';
import type { Aircraft } from '../types';
import type { World } from '../world';
import { applyDamage } from './damage';

/**
 * Mid-air collisions between hostile aircraft.
 *
 * Swept test: we check the closest approach of the two aircraft over the whole
 * tick (relative motion from last tick's positions to this tick's), so fast
 * aircraft can't pass through each other between ticks at any frame rate.
 * Each aircraft then gets COLLISION_IMMUNITY seconds so one impact can't deal
 * damage twice.
 */
export function updateAircraftCollisions(world: World, dt: number): void {
  const list = world.aircraft;
  for (const a of list) if (a.collisionImmunity > 0) a.collisionImmunity -= dt;
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    if (!a.alive) continue;
    for (let j = i + 1; j < list.length; j++) {
      const b = list[j];
      if (!b.alive || !world.areEnemies(a, b)) continue;
      if (a.collisionImmunity > 0 || b.collisionImmunity > 0) continue;
      const r = (a.def.radius + b.def.radius) * FLIGHT.COLLISION_RADIUS_MULT;
      // Relative position of b w.r.t. a at the start and end of the tick.
      const rx0 = b.px - a.px;
      const ry0 = b.py - a.py;
      const rx1 = b.x - a.x;
      const ry1 = b.y - a.y;
      // Cheap reject: the whole relative-motion segment stays on one side of the collision box.
      if ((rx0 > r && rx1 > r) || (rx0 < -r && rx1 < -r) || (ry0 > r && ry1 > r) || (ry0 < -r && ry1 < -r)) continue;
      // Swept test: closest approach of that segment to the origin.
      const d2 = segmentPointDist2(rx0, ry0, rx1, ry1, 0, 0);
      if (d2 > r * r) continue;
      collide(world, a, b);
    }
  }
}

function collide(world: World, a: Aircraft, b: Aircraft): void {
  let nx = b.x - a.x;
  let ny = b.y - a.y;
  const len = Math.hypot(nx, ny) || 1;
  nx /= len;
  ny /= len;
  // Shove them apart so they don't stay overlapped.
  a.vx -= nx * FLIGHT.COLLISION_BOUNCE;
  a.vy -= ny * FLIGHT.COLLISION_BOUNCE;
  b.vx += nx * FLIGHT.COLLISION_BOUNCE;
  b.vy += ny * FLIGHT.COLLISION_BOUNCE;
  a.collisionImmunity = FLIGHT.COLLISION_IMMUNITY;
  b.collisionImmunity = FLIGHT.COLLISION_IMMUNITY;
  world.emit({ type: 'collision', a: a.id, b: b.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  // Each takes damage relative to its own hull; the other aircraft is credited (ramming counts).
  applyDamage(world, a, Math.max(FLIGHT.COLLISION_MIN_DAMAGE, a.def.health * FLIGHT.COLLISION_DAMAGE_FRACTION), b.id, 'collision');
  applyDamage(world, b, Math.max(FLIGHT.COLLISION_MIN_DAMAGE, b.def.health * FLIGHT.COLLISION_DAMAGE_FRACTION), a.id, 'collision');
}
