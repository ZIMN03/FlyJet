import { angleDiff } from '../math';
import { Button, LockState, type Aircraft, type InputCommand } from '../types';
import type { World } from '../world';
import { applyDamage } from './damage';
import { creditEvasion } from './projectiles';

/** Guns come back online once cooled to this heat after an overheat. */
const OVERHEAT_RESUME = 0.35;
/** Number of flare pellets per deployment. */
const FLARES_PER_DEPLOY = 4;
const FLARE_LIFETIME = 2.2;
const FLARE_DEPLOY_COOLDOWN = 0.6;
/** Seconds during which nobody can lock onto an aircraft that just flared. */
const FLARE_LOCK_IMMUNITY = 1.4;
/** Lock-cone hysteresis: once targeted, the target may drift this much wider before the lock drops. */
const LOCK_CONE_HYSTERESIS = 1.35;
const LOCK_DECAY_RATE = 2.5;
const LOS_SAMPLES = 10;
/** Hardpoint offset below the fuselage centreline for missile launch. */
const MISSILE_HARDPOINT_DROP = 10;

function pressed(a: Aircraft, cmd: InputCommand, b: Button): boolean {
  return (cmd.buttons & b) !== 0 && (a.prevButtons & b) === 0;
}

function gunFireRateMult(a: Aircraft): number {
  return a.abilityTimer > 0 && a.ability.kind === 'overcharge' ? a.ability.fireRateMult ?? 1 : 1;
}

function gunDamageMult(a: Aircraft): number {
  return a.abilityTimer > 0 && a.ability.kind === 'overcharge' ? a.ability.damageMult ?? 1 : 1;
}

/** Terrain line-of-sight between two points (sampled). Terrain is a counter to lock-ons. */
export function hasLineOfSight(world: World, ax: number, ay: number, bx: number, by: number): boolean {
  const t = world.terrain;
  for (let i = 1; i < LOS_SAMPLES; i++) {
    const f = i / LOS_SAMPLES;
    const x = ax + (bx - ax) * f;
    const y = ay + (by - ay) * f;
    if (y >= t.groundY(x)) return false;
  }
  return true;
}

/** Guns, missiles, flares, abilities and all their timers. */
export function updateWeapons(world: World, a: Aircraft, cmd: InputCommand, dt: number, combatEnabled: boolean): void {
  const def = a.def;

  // --- Timers ---
  if (a.missileCooldown > 0) a.missileCooldown -= dt;
  if (a.flareCooldown > 0) a.flareCooldown -= dt;
  if (a.abilityCooldown > 0) a.abilityCooldown -= dt;
  if (a.abilityTimer > 0) a.abilityTimer -= dt;
  if (a.missileAmmo < def.missileCapacity && def.missileRearmTime > 0) {
    a.missileRearmTimer += dt;
    if (a.missileRearmTimer >= def.missileRearmTime) {
      a.missileRearmTimer = 0;
      a.missileAmmo++;
    }
  } else {
    a.missileRearmTimer = 0;
  }
  if (a.flareCharges < def.flareCharges) {
    a.flareRechargeTimer += dt;
    if (a.flareRechargeTimer >= def.flareRechargeTime) {
      a.flareRechargeTimer = 0;
      a.flareCharges++;
    }
  } else {
    a.flareRechargeTimer = 0;
  }

  // Gun cooldown accumulates negative while held so the fire rate is exact at any tick rate.
  a.gunCooldown -= dt;
  const trigger = combatEnabled && (cmd.buttons & Button.Fire) !== 0;
  // Cannon heat: sustained fire overheats the guns; they must cool to OVERHEAT_RESUME to fire again.
  if (a.overheated && a.gunHeat <= OVERHEAT_RESUME) a.overheated = false;
  const firing = trigger && !a.overheated;
  if (!firing) {
    if (a.gunCooldown < 0) a.gunCooldown = 0;
    a.gunHeat = Math.max(0, a.gunHeat - a.gun.coolRate * dt);
  }
  if (!combatEnabled) return;

  if (firing) {
    const interval = a.gun.fireInterval / gunFireRateMult(a);
    // Overcharge vents heat: the cannons can't overheat while it is active.
    const heatMult = a.abilityTimer > 0 && a.ability.kind === 'overcharge' ? 0 : 1;
    // Cap shots per tick to avoid bursts after a hitch.
    let shots = 0;
    while (a.gunCooldown <= 0 && shots < 3) {
      fireGun(world, a);
      a.gunCooldown += interval;
      a.gunHeat = Math.min(1, a.gunHeat + a.gun.heatPerShot * heatMult);
      shots++;
    }
    if (a.gunHeat >= 1) {
      a.overheated = true;
      world.emit({ type: 'overheat', id: a.id });
    }
    a.spawnProtection = 0;
  }

  if (pressed(a, cmd, Button.Missile)) launchMissile(world, a);
  if (pressed(a, cmd, Button.Flare)) deployFlares(world, a);
  if (pressed(a, cmd, Button.Ability) && a.abilityCooldown <= 0) {
    a.abilityTimer = a.ability.duration;
    a.abilityCooldown = a.ability.cooldown;
    world.emit({ type: 'ability', id: a.id, ability: a.ability.id });
    activateAbility(world, a);
  }
  // Stealth: nobody can build a lock while the veil is up.
  if (a.abilityTimer > 0 && a.ability.kind === 'stealth') a.lockImmunity = Math.max(a.lockImmunity, 0.1);
}

/** One-off effects when an ability fires. Duration-based effects are read where they apply. */
function activateAbility(world: World, a: Aircraft): void {
  const ab = a.ability;
  if (ab.kind === 'stealth') {
    for (const o of world.aircraft) {
      if (o.lockTargetId === a.id) {
        o.lockProgress = 0;
        o.lockState = LockState.Detected;
      }
    }
    // Chasing missiles lose the target and fly on blind until their chase timer runs out.
    for (const m of world.missiles) if (m.active && m.targetId === a.id) m.targetId = 0;
  } else if (ab.kind === 'energyPulse') {
    const r = ab.pulseRadius ?? 0;
    for (const o of world.aircraft) {
      if (!o.alive || o.id === a.id || !world.areEnemies(a, o)) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      if (d <= r + o.def.radius) applyDamage(world, o, ab.pulseDamage ?? 0, a.id, 'pulse');
    }
    for (const m of world.missiles) {
      if (!m.active || m.team === a.team) continue;
      if (Math.hypot(m.x - a.x, m.y - a.y) <= r) {
        m.active = false;
        world.emit({ type: 'missileExplode', missileId: m.id, x: m.x, y: m.y, radius: 0, water: false });
        creditEvasion(world, m);
      }
    }
  }
}

function fireGun(world: World, a: Aircraft): void {
  const g = a.gun;
  const pellets = g.pellets ?? 1;
  const cos = Math.cos(a.heading);
  const sin = Math.sin(a.heading);
  a.barrel ^= 1;
  const side = g.barrelSpacing * (a.barrel ? 1 : -1);
  let angle = a.heading;
  for (let i = 0; i < pellets; i++) {
    const b = world.allocBullet();
    if (!b) return;
    // Multi-pellet guns fan evenly across the spread; single guns jitter randomly.
    angle = pellets > 1
      ? a.heading + (i / (pellets - 1) - 0.5) * 2 * g.spread
      : a.heading + world.rng.range(-g.spread, g.spread);
    b.active = true;
    b.x = b.px = a.x + cos * g.muzzleOffset - sin * side;
    b.y = b.py = a.y + sin * g.muzzleOffset + cos * side;
    // Inherit the aircraft's velocity so bullets never appear to lag behind the shooter.
    b.vx = Math.cos(angle) * g.bulletSpeed + a.vx;
    b.vy = Math.sin(angle) * g.bulletSpeed + a.vy;
    b.life = g.bulletLife;
    b.damage = g.damage * gunDamageMult(a);
    b.ownerId = a.id;
    b.team = a.team;
    a.stats.shotsFired++;
  }
  world.emit({ type: 'gunFire', id: a.id, x: a.x + cos * g.muzzleOffset, y: a.y + sin * g.muzzleOffset, angle: a.heading });
}

function launchMissile(world: World, a: Aircraft): void {
  if (a.missileAmmo <= 0 || a.missileCooldown > 0) return;
  // A full lock gives the missile its target immediately; otherwise it flies
  // straight and picks up the first enemy that comes within range ahead of it.
  const target = a.lockState === LockState.Locked ? a.lockTargetId : 0;
  if (!spawnMissile(world, a, target, 0)) return;
  a.missileAmmo--;
  a.missileCooldown = a.def.missileCooldown;
  a.spawnProtection = 0;
}

/**
 * Launch one missile from `a` toward `targetId` (0 = unguided search), with an
 * optional heading offset. Used by normal launches and by boss salvos (which
 * don't consume the carrier's missile ammo).
 */
export function spawnMissile(world: World, a: Aircraft, targetId: number, angleOffset: number): boolean {
  const m = world.allocMissile();
  if (!m) return false;
  const d = a.missileDef;
  const cos = Math.cos(a.heading);
  const sin = Math.sin(a.heading);
  m.active = true;
  m.id = world.allocMissileId();
  m.def = d;
  // Drop from the belly hardpoint. The aircraft is drawn rolled so its belly
  // faces the ground whichever way it flies, so the perpendicular flips with facing.
  const belly = cos >= 0 ? 1 : -1;
  m.x = m.px = a.x - sin * MISSILE_HARDPOINT_DROP * belly + cos * 6;
  m.y = m.py = a.y + cos * MISSILE_HARDPOINT_DROP * belly + sin * 6;
  m.heading = a.heading + angleOffset;
  m.speed = a.speed + d.launchBoost;
  m.life = d.lifetime;
  m.age = 0;
  m.ownerId = a.id;
  m.team = a.team;
  m.targetId = targetId;
  m.victimId = targetId;
  m.flareTarget = -1;
  m.chaseLeft = targetId ? d.chaseTime : -1;
  a.stats.missilesFired++;
  world.emit({ type: 'missileLaunch', id: a.id, missileId: m.id, targetId: m.targetId, x: m.x, y: m.y });
  return true;
}

function deployFlares(world: World, a: Aircraft): void {
  if (a.flareCharges <= 0 || a.flareCooldown > 0) return;
  a.flareCharges--;
  a.flareCooldown = FLARE_DEPLOY_COOLDOWN;
  a.lockImmunity = FLARE_LOCK_IMMUNITY;

  let firstFlare = -1;
  for (let i = 0; i < FLARES_PER_DEPLOY; i++) {
    const fi = world.allocFlare();
    if (fi < 0) break;
    if (firstFlare < 0) firstFlare = fi;
    const f = world.flares[fi];
    // Eject backward and fan out vertically.
    const back = a.heading + Math.PI + (i - (FLARES_PER_DEPLOY - 1) / 2) * 0.45;
    const ejectSpeed = 180 + i * 25;
    f.active = true;
    f.x = a.x;
    f.y = a.y;
    f.vx = a.vx * 0.35 + Math.cos(back) * ejectSpeed;
    f.vy = a.vy * 0.35 + Math.sin(back) * ejectSpeed;
    f.life = FLARE_LIFETIME;
    f.team = a.team;
    f.ownerId = a.id;
  }

  // Break every lock currently held on this aircraft.
  for (const o of world.aircraft) {
    if (o.lockTargetId === a.id) {
      o.lockProgress = 0;
      o.lockState = LockState.Detected;
    }
  }
  // Missiles already tracking us, within seeker range, divert to the decoys.
  if (firstFlare >= 0) {
    let k = 0;
    for (const m of world.missiles) {
      if (!m.active || m.targetId !== a.id || m.flareTarget >= 0) continue;
      const d = Math.hypot(m.x - a.x, m.y - a.y);
      if (d > m.def.flareSusceptibleRange) continue;
      m.flareTarget = firstFlare + (k++ % FLARES_PER_DEPLOY);
      if (m.flareTarget >= world.flares.length || !world.flares[m.flareTarget].active) m.flareTarget = firstFlare;
      world.emit({ type: 'missileDecoyed', missileId: m.id, victimId: a.id });
    }
  }
  world.emit({ type: 'flareDeploy', id: a.id, x: a.x, y: a.y });
}

/**
 * Lock-on: continuous acquisition of the best target inside the forward cone.
 * NONE -> DETECTED -> LOCKING -> LOCKED. Targets are told they're being locked
 * so they can react (HUD warning, flares, break turn, terrain).
 */
export function updateLock(world: World, a: Aircraft, dt: number): void {
  const def = a.def;
  let current = a.lockTargetId ? world.getAircraft(a.lockTargetId) : undefined;
  if (current && !isLockable(world, a, current, def.lockRange * 1.1, def.lockCone * LOCK_CONE_HYSTERESIS)) {
    current = undefined;
  }

  if (!current) {
    let bestScore = Infinity;
    for (const o of world.aircraft) {
      if (!isLockable(world, a, o, def.lockRange, def.lockCone)) continue;
      const d = Math.hypot(o.x - a.x, o.y - a.y);
      const off = Math.abs(angleDiff(a.heading, Math.atan2(o.y - a.y, o.x - a.x)));
      const score = off / def.lockCone + d / def.lockRange;
      if (score < bestScore) {
        bestScore = score;
        current = o;
      }
    }
    a.lockProgress = 0;
  }

  if (!current) {
    a.lockTargetId = 0;
    a.lockProgress = 0;
    a.lockState = LockState.None;
    return;
  }

  a.lockTargetId = current.id;
  const off = Math.abs(angleDiff(a.heading, Math.atan2(current.y - a.y, current.x - a.x)));
  if (current.lockImmunity > 0) {
    a.lockProgress = 0;
  } else if (off <= def.lockCone) {
    a.lockProgress = Math.min(1, a.lockProgress + (dt / def.lockTime) * current.def.lockSignature);
  } else {
    a.lockProgress = Math.max(0, a.lockProgress - dt * LOCK_DECAY_RATE);
  }

  const prev = a.lockState;
  a.lockState = a.lockProgress >= 1 ? LockState.Locked : a.lockProgress > 0 ? LockState.Locking : LockState.Detected;
  if (a.lockState === LockState.Locked && prev !== LockState.Locked) {
    world.emit({ type: 'lockAcquired', id: a.id, targetId: current.id });
  }
  if (a.lockProgress > 0) current.beingLocked = true;
  if (a.lockState === LockState.Locked) current.lockedOn = true;
}

function isLockable(world: World, a: Aircraft, o: Aircraft, range: number, cone: number): boolean {
  if (!o.alive || o.id === a.id || !world.areEnemies(a, o)) return false;
  const dx = o.x - a.x;
  const dy = o.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d > range) return false;
  if (Math.abs(angleDiff(a.heading, Math.atan2(dy, dx))) > cone) return false;
  return hasLineOfSight(world, a.x, a.y, o.x, o.y);
}
