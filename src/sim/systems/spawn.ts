import { COMBAT } from '../constants';
import { LockState, type Aircraft } from '../types';
import type { World } from '../world';

/** Spawns closer than this to a living enemy are heavily penalised. */
const UNSAFE_ENEMY_DIST = 1400;
const UNSAFE_MISSILE_DIST = 1200;

/**
 * Pick the safest spawn point for `a`: maximise distance to the nearest living
 * enemy and nearest hostile missile, with a little randomness so spawns aren't
 * perfectly predictable.
 */
export function chooseSpawn(world: World, a: Aircraft): { x: number; y: number; facing: 1 | -1 } {
  let best = world.map.spawns[0];
  let bestScore = -Infinity;
  for (const sp of world.map.spawns) {
    let nearest = Infinity;
    let centroidX = 0;
    let enemyCount = 0;
    for (const o of world.aircraft) {
      if (!o.alive || o.id === a.id || !world.areEnemies(a, o)) continue;
      nearest = Math.min(nearest, Math.hypot(o.x - sp.x, o.y - sp.y));
      centroidX += o.x;
      enemyCount++;
    }
    for (const m of world.missiles) {
      if (!m.active || m.team === a.team) continue;
      nearest = Math.min(nearest, Math.hypot(m.x - sp.x, m.y - sp.y) * (UNSAFE_ENEMY_DIST / UNSAFE_MISSILE_DIST));
    }
    let score = Math.min(nearest, 4000);
    if (nearest < UNSAFE_ENEMY_DIST) score -= 5000;
    score += world.rng.range(0, 300);
    if (score > bestScore) {
      bestScore = score;
      best = sp;
      // Face toward the action if enemies exist, otherwise use the authored facing.
      if (enemyCount > 0) {
        const cx = centroidX / enemyCount;
        best = { ...sp, facing: cx >= sp.x ? 1 : -1 };
      }
    }
  }
  return best;
}

/** Reset an aircraft to a fresh, alive state at the given position. */
export function spawnAircraft(world: World, a: Aircraft, x: number, y: number, facing: 1 | -1): void {
  const def = a.def;
  a.alive = true;
  a.respawnTimer = -1;
  a.x = a.px = x;
  a.y = a.py = y;
  a.heading = a.pheading = facing > 0 ? 0 : Math.PI;
  a.speed = def.cruiseSpeed;
  a.vx = Math.cos(a.heading) * a.speed;
  a.vy = 0;
  a.health = def.health;
  a.boostEnergy = def.afterburnerCapacity;
  a.boosting = false;
  a.boostRegenDelay = 0;
  a.braking = false;
  a.gunCooldown = 0;
  a.missileAmmo = def.missileCapacity;
  a.missileCooldown = 0;
  a.missileRearmTimer = 0;
  a.flareCharges = def.flareCharges;
  a.flareRechargeTimer = 0;
  a.flareCooldown = 0;
  a.abilityCooldown = 0;
  a.abilityTimer = 0;
  a.lockTargetId = 0;
  a.lockProgress = 0;
  a.lockState = LockState.None;
  a.lockImmunity = 0;
  a.spawnProtection = COMBAT.spawnProtection;
  a.crashImmunity = 0;
  a.outOfBoundsTime = 0;
  a.outOfBounds = false;
  a.timeSinceDamaged = 999;
  a.lastAttackerId = 0;
  a.lastAttackerTime = -999;
  a.damageLog.clear();
  a.stats.streak = 0;
  world.emit({ type: 'spawn', id: a.id, x, y });
}
