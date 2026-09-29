import { TICK_DT } from '../constants';
import { angleDiff, clamp } from '../math';
import { Button, LockState, emptyCommand, type Aircraft, type InputCommand } from '../types';
import type { World } from '../world';
import type { Personality } from './personalities';

export type AiState =
  | 'PATROL' | 'SEARCH' | 'APPROACH' | 'ATTACK' | 'EVADE'
  | 'MISSILE_DODGE' | 'RETREAT' | 'REPOSITION' | 'DESTROYED';

/** How far the AI can "see" enemies. */
const DETECT_RANGE = 3200;
/** Incoming missile distance that triggers a dodge. */
const MISSILE_DODGE_DIST = 950;
/** Distance at which a flare is worth popping. */
const FLARE_TRIGGER_DIST = 380;
/** Terrain look-ahead times (seconds of travel). */
const TERRAIN_PROBES = [0.25, 0.55, 0.9];
const TERRAIN_SAFE_CLEARANCE = 150;
const CEILING_SAFE = 260;
const EDGE_SAFE = 450;
/** Cone in which the AI will pull the trigger (radians, before skill scaling). */
const FIRE_CONE = 0.1;

/**
 * Finite-state AI pilot. Produces an InputCommand each tick exactly like a
 * human would, so AI and players share one flight/weapon code path (and the
 * server can run AI with no special cases).
 */
export class AiBrain {
  state: AiState = 'PATROL';
  targetId = 0;
  private stateTime = 0;
  private stateDuration = 0;
  private decisionTimer = 0;
  private patrolX = 0;
  private patrolY = 0;
  private waypointX = 0;
  private waypointY = 0;
  private jinkSign = 1;
  private jinkTimer = 0;
  private flareRolled = false;
  private missileHeld = false;
  private readonly cmd: InputCommand = emptyCommand();

  constructor(
    readonly personality: Personality,
    /** 0..1 overall competence; scales aim error and reaction time. */
    readonly skill: number,
  ) {}

  private setState(s: AiState, duration = 0): void {
    if (s !== this.state) {
      this.state = s;
      this.stateTime = 0;
    }
    this.stateDuration = duration;
  }

  think(world: World, self: Aircraft): InputCommand {
    const cmd = this.cmd;
    cmd.steerX = 0;
    cmd.steerY = 0;
    cmd.buttons = 0;
    if (!self.alive) {
      this.state = 'DESTROYED';
      return cmd;
    }
    if (this.state === 'DESTROYED') this.setState('PATROL');

    const p = this.personality;
    const dt = TICK_DT;
    this.stateTime += dt;
    this.decisionTimer -= dt;

    let target = this.targetId ? world.getAircraft(this.targetId) : undefined;
    if (target && (!target.alive || dist(self, target) > DETECT_RANGE * 1.2)) target = undefined;

    // --- High-level decisions at personality-dependent reaction time ---
    if (this.decisionTimer <= 0) {
      this.decisionTimer = p.reactionTime * (1.4 - this.skill * 0.6) * (0.8 + world.rng.next() * 0.4);
      target = this.pickTarget(world, self) ?? undefined;
      this.targetId = target ? target.id : 0;
      this.decide(world, self, target);
    }
    if (self.incomingMissileDist < MISSILE_DODGE_DIST && this.state !== 'MISSILE_DODGE') {
      // Missile threats bypass the reaction timer — survival reflex.
      this.flareRolled = false;
      this.setState('MISSILE_DODGE');
    }

    // --- Execute current state ---
    let sx = 0;
    let sy = 0;
    let boost = false;
    let brake = false;
    switch (this.state) {
      case 'PATROL':
      case 'SEARCH': {
        if (Math.hypot(this.patrolX - self.x, this.patrolY - self.y) < 400 || this.patrolX === 0) {
          this.pickPatrolPoint(world);
        }
        [sx, sy] = dirTo(self.x, self.y, this.patrolX, this.patrolY);
        break;
      }
      case 'APPROACH': {
        if (!target) break;
        // Flankers aim for a point above-behind the target instead of flying straight at it.
        const behind = -Math.sign(target.vx || 1);
        const off = p.flankBias * 420;
        const ax = target.x + target.vx * 0.6 + behind * off;
        const ay = target.y + target.vy * 0.6 - off * 0.6;
        [sx, sy] = dirTo(self.x, self.y, ax, ay);
        const d = dist(self, target);
        boost = d > p.preferredRange * 2.4 && self.boostEnergy > 45 && world.rng.next() < p.boostUse;
        break;
      }
      case 'ATTACK': {
        if (!target) break;
        const d = dist(self, target);
        const bulletSpeed = self.gun.bulletSpeed;
        const tHit = d / bulletSpeed;
        // Lead the target; wobble simulates imperfect aim.
        const wobble = Math.sin(world.time * 2.3 + self.id * 1.7) * p.aimError * (1.5 - this.skill);
        const ax = target.x + (target.vx - self.vx * 0.5) * tHit;
        const ay = target.y + (target.vy - self.vy * 0.5) * tHit;
        const aimAngle = Math.atan2(ay - self.y, ax - self.x) + wobble;
        sx = Math.cos(aimAngle);
        sy = Math.sin(aimAngle);
        const off = Math.abs(angleDiff(self.heading, aimAngle));
        const gunRange = bulletSpeed * self.gun.bulletLife * 0.85;
        if (d < gunRange && off < FIRE_CONE + (1 - this.skill) * 0.08) cmd.buttons |= Button.Fire;
        // Tight turn if the target is getting away from the nose.
        brake = p.brakeTurns && off > 1.2 && self.speed > self.def.cruiseSpeed * 0.9;
        if (d > p.preferredRange * 1.3 && self.boostEnergy > 50) boost = world.rng.next() < p.boostUse * 0.5;
        this.tryMissile(world, self, target);
        break;
      }
      case 'EVADE': {
        // Jink: alternate hard up/down breaks perpendicular to the threat.
        this.jinkTimer -= dt;
        if (this.jinkTimer <= 0) {
          this.jinkSign = -this.jinkSign;
          this.jinkTimer = 0.5 + world.rng.next() * 0.6;
        }
        const threatAngle = target ? Math.atan2(target.y - self.y, target.x - self.x) : self.heading;
        const a = threatAngle + (Math.PI / 2) * this.jinkSign;
        sx = Math.cos(a);
        sy = Math.sin(a);
        boost = self.boostEnergy > 20 && world.rng.next() < p.boostUse;
        brake = p.brakeTurns && !boost && target !== undefined && dist(self, target) < 500;
        break;
      }
      case 'MISSILE_DODGE': {
        if (self.incomingMissileDist === Infinity) {
          this.setState(target ? 'APPROACH' : 'PATROL');
          break;
        }
        // Break perpendicular to the missile's line of approach, favouring away from terrain.
        const mAngle = self.incomingMissileAngle;
        const perpA = mAngle + Math.PI / 2;
        const perpB = mAngle - Math.PI / 2;
        const clearance = world.terrain.clearance(self.x, self.y);
        const pick = clearance < 500 ? (Math.sin(perpA) < Math.sin(perpB) ? perpA : perpB)
          : Math.abs(angleDiff(self.heading, perpA)) < Math.abs(angleDiff(self.heading, perpB)) ? perpA : perpB;
        sx = Math.cos(pick);
        sy = Math.sin(pick);
        const md = self.incomingMissileDist;
        boost = md > 450 && self.boostEnergy > 10;
        // Late brake-turn makes the missile overshoot — only skilled pilots time it.
        brake = p.brakeTurns && md < 320;
        if (md < FLARE_TRIGGER_DIST && !this.flareRolled) {
          this.flareRolled = true;
          if (world.rng.next() < p.flareSkill) cmd.buttons |= Button.Flare;
        }
        break;
      }
      case 'RETREAT': {
        const from = target ?? self;
        const awayX = self.x - from.x || Math.cos(self.heading);
        const awayY = Math.min(-200, self.y - from.y);
        [sx, sy] = dirTo(0, 0, awayX, awayY);
        boost = self.boostEnergy > 25;
        break;
      }
      case 'REPOSITION': {
        [sx, sy] = dirTo(self.x, self.y, this.waypointX, this.waypointY);
        boost = self.boostEnergy > 60 && world.rng.next() < p.boostUse * 0.4;
        break;
      }
      case 'DESTROYED':
        break;
    }

    // --- Safety overrides: terrain, ceiling, map edges ---
    [sx, sy] = this.avoidHazards(world, self, sx, sy);

    cmd.steerX = sx;
    cmd.steerY = sy;
    if (boost) cmd.buttons |= Button.Boost;
    if (brake && !boost) cmd.buttons |= Button.Brake;
    return cmd;
  }

  private decide(world: World, self: Aircraft, target: Aircraft | undefined): void {
    const p = this.personality;
    const rng = world.rng;
    const timed = this.stateDuration > 0 && this.stateTime < this.stateDuration;
    if (this.state === 'MISSILE_DODGE' && self.incomingMissileDist < Infinity) return;
    if (timed && (this.state === 'EVADE' || this.state === 'RETREAT' || this.state === 'REPOSITION')) return;

    if (!target) {
      this.setState(this.state === 'PATROL' ? 'PATROL' : 'SEARCH');
      return;
    }
    const d = dist(self, target);
    const healthFrac = self.health / self.def.health;

    if (healthFrac < p.retreatHealth && rng.next() < 0.35) {
      this.setState('RETREAT', 2 + rng.next() * 1.5);
      return;
    }
    // Someone on our tail and pointed at us, or we're under fire: evade.
    const targetBehind = Math.abs(angleDiff(self.heading, Math.atan2(target.y - self.y, target.x - self.x))) > 2.0;
    const targetAimingAtUs =
      Math.abs(angleDiff(target.heading, Math.atan2(self.y - target.y, self.x - target.x))) < 0.35;
    if (((targetBehind && targetAimingAtUs && d < 900) || self.timeSinceDamaged < 0.4 || self.lockedOn) &&
        rng.next() < p.evadeTendency) {
      this.setState('EVADE', 0.8 + rng.next() * 1.2);
      return;
    }
    if (d < p.minRange) {
      // Too close: extend away and set up another pass instead of turning circles on the target's nose.
      const side = rng.next() < 0.5 ? -1 : 1;
      this.waypointX = clamp(self.x + Math.cos(self.heading) * 900, 600, world.map.width - 600);
      this.waypointY = clamp(self.y + side * 500, 400, world.terrain.groundY(this.waypointX) - 350);
      this.setState('REPOSITION', 1.2 + rng.next() * 1.2);
      return;
    }
    if (d > p.engageRange) {
      this.setState('APPROACH');
      return;
    }
    if (d > p.preferredRange * 1.8) this.setState('APPROACH');
    else this.setState('ATTACK');
  }

  private tryMissile(world: World, self: Aircraft, target: Aircraft): void {
    // Release the button between launches so the sim sees a fresh press.
    if (this.missileHeld) {
      this.missileHeld = false;
      return;
    }
    if (self.lockState !== LockState.Locked || self.missileAmmo <= 0 || self.missileCooldown > 0) return;
    const p = this.personality;
    if (p.strategicMissiles && target.flareCharges > 0 && dist(self, target) > 700) return;
    if (world.rng.next() < p.missileRate * TICK_DT) {
      this.cmd.buttons |= Button.Missile;
      this.missileHeld = true;
    }
  }

  private pickTarget(world: World, self: Aircraft): Aircraft | null {
    let best: Aircraft | null = null;
    let bestD = DETECT_RANGE;
    for (const o of world.aircraft) {
      if (!o.alive || o.id === self.id || !world.areEnemies(self, o)) continue;
      // Slight preference to stick with the current target to avoid dithering.
      const d = dist(self, o) * (o.id === this.targetId ? 0.75 : 1);
      if (d < bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  private pickPatrolPoint(world: World): void {
    const r = world.rng;
    this.patrolX = r.range(800, world.map.width - 800);
    this.patrolY = r.range(450, Math.min(world.terrain.groundY(this.patrolX) - 450, world.map.seaLevel - 600));
  }

  private avoidHazards(world: World, self: Aircraft, sx: number, sy: number): [number, number] {
    const t = world.terrain;
    let danger = 0;
    for (const s of TERRAIN_PROBES) {
      const x = self.x + self.vx * s;
      const y = self.y + self.vy * s;
      const c = t.groundY(x) - y;
      if (c < TERRAIN_SAFE_CLEARANCE) danger = Math.max(danger, 1 - c / TERRAIN_SAFE_CLEARANCE / 2);
    }
    if (self.y > t.groundY(self.x) - TERRAIN_SAFE_CLEARANCE) danger = Math.max(danger, 0.8);
    if (danger > 0) {
      // Pull up, keeping horizontal direction of travel.
      const k = clamp(danger, 0, 1);
      sx = sx * (1 - k) + Math.sign(self.vx || 1) * 0.35 * k;
      sy = sy * (1 - k) - 1 * k;
    }
    if (self.y < CEILING_SAFE) sy = Math.max(sy, 0.6);
    if (self.x < EDGE_SAFE) sx = Math.max(sx, 0.7);
    else if (self.x > world.map.width - EDGE_SAFE) sx = Math.min(sx, -0.7);
    const m = Math.hypot(sx, sy);
    return m > 0.001 ? [sx / m, sy / m] : [0, 0];
  }
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function dirTo(ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax;
  const dy = by - ay;
  const m = Math.hypot(dx, dy);
  return m > 0.001 ? [dx / m, dy / m] : [0, 0];
}
