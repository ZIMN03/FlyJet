import { COMBAT } from '../constants';
import { angleDiff, clamp, segmentPointDist2 } from '../math';
import type { Missile } from '../types';
import type { World } from '../world';
import { applyDamage } from './damage';

/** Extra hit radius for bullets beyond the aircraft collider (bullet thickness). */
const BULLET_RADIUS = 3;
/** Cheap broadphase: skip aircraft further than this on either axis from a bullet. */
const BULLET_BROADPHASE = 160;
const MISSILE_TERRAIN_RADIUS = 4;
/** Minimum fraction of missile damage at the edge of the blast. */
const BLAST_EDGE_FALLOFF = 0.35;
const BLAST_KNOCKBACK = 220;
const FLARE_GRAVITY = 260;
const FLARE_DRAG = 1.6;
const FLARE_FUSE = 30;

export function updateBullets(world: World, dt: number): void {
  const t = world.terrain;
  for (let i = 0; i < world.bullets.length; i++) {
    const b = world.bullets[i];
    if (!b.active) continue;
    b.px = b.x;
    b.py = b.y;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    if (b.life <= 0) {
      b.active = false;
      continue;
    }
    const g = t.groundY(b.x);
    if (b.y >= g) {
      b.active = false;
      world.emit({ type: 'bulletImpact', x: b.x, y: g, water: g >= t.seaLevel - 1 });
      continue;
    }
    for (let k = 0; k < world.aircraft.length; k++) {
      const a = world.aircraft[k];
      if (!a.alive || a.id === b.ownerId) continue;
      if (!world.friendlyFire && a.team === b.team) continue;
      if (Math.abs(a.x - b.x) > BULLET_BROADPHASE || Math.abs(a.y - b.y) > BULLET_BROADPHASE) continue;
      const r = a.def.radius + BULLET_RADIUS;
      if (segmentPointDist2(b.px, b.py, b.x, b.y, a.x, a.y) > r * r) continue;
      const crit = world.rng.chance(COMBAT.critChance);
      const dmg = b.damage * (crit ? COMBAT.critMultiplier : 1);
      b.active = false;
      const owner = world.getAircraft(b.ownerId);
      if (owner) owner.stats.shotsHit++;
      world.emit({ type: 'bulletHit', x: b.x, y: b.y, targetId: a.id, attackerId: b.ownerId, damage: dmg, crit });
      applyDamage(world, a, dmg, b.ownerId, 'gun');
      break;
    }
  }
}

export function updateMissiles(world: World, dt: number): void {
  for (let i = 0; i < world.missiles.length; i++) {
    const m = world.missiles[i];
    if (!m.active) continue;
    m.px = m.x;
    m.py = m.y;
    m.age += dt;
    const d = m.def;
    const armed = m.age >= d.armTime;

    if (m.chaseLeft >= 0) {
      // Chasing: follows its target for chaseTime seconds, then gives up.
      m.chaseLeft -= dt;
      if (m.chaseLeft <= 0) {
        fizzleMissile(world, m);
        continue;
      }
    } else {
      // Searching: flies straight until an enemy comes into range ahead.
      m.life -= dt;
      if (armed) acquireTarget(world, m);
      if (m.chaseLeft < 0 && m.life <= 0) {
        fizzleMissile(world, m);
        continue;
      }
    }

    if (armed && !steerMissile(world, m, dt)) {
      fizzleMissile(world, m);
      continue;
    }

    m.speed = Math.min(d.maxSpeed, m.speed + d.acceleration * dt);
    m.x += Math.cos(m.heading) * m.speed * dt;
    m.y += Math.sin(m.heading) * m.speed * dt;

    if (world.terrain.collides(m.x, m.y, MISSILE_TERRAIN_RADIUS)) {
      explodeMissile(world, m);
      continue;
    }
    if (armed && checkProximity(world, m)) explodeMissile(world, m);
  }
}

/**
 * A missile that runs out of chase time (or search time) pops harmlessly and
 * disappears — it never deals splash damage when it misses.
 */
function fizzleMissile(world: World, m: Missile): void {
  m.active = false;
  world.emit({ type: 'missileExplode', missileId: m.id, x: m.x, y: m.y, radius: 0, water: false });
}

/** Pick the closest enemy within acquire range and inside the forward cone. */
function acquireTarget(world: World, m: Missile): void {
  const d = m.def;
  let best = 0;
  let bestDist = d.acquireRange;
  for (const a of world.aircraft) {
    if (!a.alive || a.id === m.ownerId) continue;
    if (!world.friendlyFire && a.team === m.team) continue;
    const dx = a.x - m.x;
    const dy = a.y - m.y;
    const dist = Math.hypot(dx, dy);
    if (dist >= bestDist) continue;
    if (Math.abs(angleDiff(m.heading, Math.atan2(dy, dx))) > d.acquireCone) continue;
    best = a.id;
    bestDist = dist;
  }
  if (best) {
    m.targetId = best;
    m.chaseLeft = d.chaseTime;
  }
}

/**
 * Turn toward the current target (a decoy flare takes priority). Returns false
 * when the missile has lost what it was chasing and should disappear.
 */
function steerMissile(world: World, m: Missile, dt: number): boolean {
  const d = m.def;
  let tx = 0;
  let ty = 0;
  let tvx = 0;
  let tvy = 0;

  if (m.flareTarget >= 0) {
    const f = world.flares[m.flareTarget];
    // Decoy burnt out: the spoofed seeker gives up and the missile disappears.
    if (!f.active) return false;
    tx = f.x; ty = f.y; tvx = f.vx; tvy = f.vy;
  } else if (m.targetId) {
    const t = world.getAircraft(m.targetId);
    // Target already destroyed: nothing left to chase.
    if (!t || !t.alive) return false;
    tx = t.x; ty = t.y; tvx = t.vx; tvy = t.vy;
  } else {
    return true; // still searching, fly straight
  }

  const dist = Math.hypot(tx - m.x, ty - m.y);
  const tGo = dist / Math.max(m.speed, 1);
  const aimX = tx + tvx * tGo * d.lead;
  const aimY = ty + tvy * tGo * d.lead;
  const desired = Math.atan2(aimY - m.y, aimX - m.x);
  const maxTurn = d.turnRate * dt;
  m.heading += clamp(angleDiff(m.heading, desired), -maxTurn, maxTurn);
  return true;
}

function checkProximity(world: World, m: Missile): boolean {
  if (m.flareTarget >= 0) {
    const f = world.flares[m.flareTarget];
    if (f.active && Math.hypot(f.x - m.x, f.y - m.y) < FLARE_FUSE) return true;
  }
  for (const a of world.aircraft) {
    if (!a.alive || a.id === m.ownerId) continue;
    if (!world.friendlyFire && a.team === m.team) continue;
    const r = a.def.radius + m.def.proximityFuse;
    if (Math.abs(a.x - m.x) > r || Math.abs(a.y - m.y) > r) continue;
    if ((a.x - m.x) ** 2 + (a.y - m.y) ** 2 <= r * r) return true;
  }
  return false;
}

function explodeMissile(world: World, m: Missile): void {
  m.active = false;
  const d = m.def;
  const water = m.y >= world.terrain.seaLevel - 8;
  world.emit({ type: 'missileExplode', missileId: m.id, x: m.x, y: m.y, radius: d.blastRadius, water });
  let hitAny = false;
  for (const a of world.aircraft) {
    if (!a.alive || a.id === m.ownerId) continue;
    if (!world.friendlyFire && a.team === m.team) continue;
    const dx = a.x - m.x;
    const dy = a.y - m.y;
    const dist = Math.hypot(dx, dy);
    const edge = dist - a.def.radius;
    if (edge > d.blastRadius) continue;
    const f = 1 - clamp(edge / d.blastRadius, 0, 1) * (1 - BLAST_EDGE_FALLOFF);
    const inv = dist > 0.001 ? 1 / dist : 0;
    a.vx += dx * inv * BLAST_KNOCKBACK * f;
    a.vy += dy * inv * BLAST_KNOCKBACK * f;
    applyDamage(world, a, d.damage * f, m.ownerId, 'missile');
    hitAny = true;
  }
  if (hitAny) {
    const owner = world.getAircraft(m.ownerId);
    if (owner) owner.stats.missileHits++;
  }
}

export function updateFlares(world: World, dt: number): void {
  const t = world.terrain;
  for (const f of world.flares) {
    if (!f.active) continue;
    f.vy += FLARE_GRAVITY * dt;
    const k = Math.exp(-FLARE_DRAG * dt);
    f.vx *= k;
    f.vy *= k;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.life -= dt;
    if (f.life <= 0 || f.y >= t.groundY(f.x)) f.active = false;
  }
}

/** Fill each aircraft's incoming-missile awareness (HUD warning + AI dodge input). */
export function updateThreats(world: World): void {
  for (const a of world.aircraft) {
    a.incomingMissileDist = Infinity;
  }
  for (const m of world.missiles) {
    if (!m.active || !m.targetId || m.flareTarget >= 0) continue;
    const t = world.getAircraft(m.targetId);
    if (!t || !t.alive) continue;
    const d = Math.hypot(m.x - t.x, m.y - t.y);
    if (d < t.incomingMissileDist) {
      t.incomingMissileDist = d;
      t.incomingMissileAngle = Math.atan2(m.y - t.y, m.x - t.x);
    }
  }
}
