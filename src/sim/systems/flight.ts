import { PHYSICS } from '../constants';
import { angleDiff, approach, clamp, damp } from '../math';
import { Button, type Aircraft, type InputCommand } from '../types';
import type { World } from '../world';

/** Steering deflection below this is treated as "hold heading". */
const STEER_DEADZONE = 0.15;
/** When the requested heading is within this of a full reversal, we loop "over the top". */
const REVERSAL_THRESHOLD = 0.2;
/** Engine drag when above target speed and not braking, as a fraction of deceleration. */
const COAST_DRAG = 0.35;
/** Extra acceleration multiplier while the afterburner is lit. */
const BOOST_ACCEL_MULT = 1.7;

/**
 * Sanitise a command in place. Anything coming from a remote client must pass
 * through here before touching the simulation.
 */
export function sanitizeCommand(cmd: InputCommand): void {
  if (!Number.isFinite(cmd.steerX)) cmd.steerX = 0;
  if (!Number.isFinite(cmd.steerY)) cmd.steerY = 0;
  const m = Math.hypot(cmd.steerX, cmd.steerY);
  if (m > 1) {
    cmd.steerX /= m;
    cmd.steerY /= m;
  }
  cmd.buttons &= 0x3f;
}

export function speedMultiplier(a: Aircraft): number {
  if (a.abilityTimer > 0 && a.ability.kind === 'speedBurst') return a.ability.speedMult ?? 1;
  return 1;
}

/**
 * Arcade flight model: the nose turns toward the stick direction at a limited
 * rate, engine speed chases a target (cruise / boost / brake), and velocity
 * chases nose*speed with a grip factor so the aircraft carries momentum and
 * drifts slightly through turns.
 */
export function updateFlight(world: World, a: Aircraft, cmd: InputCommand, dt: number): void {
  const def = a.def;

  // --- Afterburner energy ---
  const boostHeld = (cmd.buttons & Button.Boost) !== 0;
  const canBoost = a.boosting ? a.boostEnergy > 0 : a.boostEnergy >= def.afterburnerMinStart;
  if (boostHeld && canBoost) {
    a.boosting = true;
    a.boostEnergy = Math.max(0, a.boostEnergy - def.afterburnerDrain * dt);
    a.boostRegenDelay = def.afterburnerRegenDelay;
  } else {
    a.boosting = false;
    if (a.boostRegenDelay > 0) a.boostRegenDelay -= dt;
    else a.boostEnergy = Math.min(def.afterburnerCapacity, a.boostEnergy + def.afterburnerRegen * dt);
  }
  a.braking = (cmd.buttons & Button.Brake) !== 0 && !a.boosting;

  // --- Turning ---
  const steerMag = Math.hypot(cmd.steerX, cmd.steerY);
  if (steerMag > STEER_DEADZONE) {
    let turnRate = def.turnRate;
    if (a.boosting) turnRate *= def.boostTurnPenalty;
    if (a.braking) turnRate *= def.brakeTurnBonus;
    const target = Math.atan2(cmd.steerY, cmd.steerX);
    let diff = angleDiff(a.heading, target);
    if (Math.abs(diff) > Math.PI - REVERSAL_THRESHOLD) {
      // Full reversal requested: always pull the nose up and over (y-down world:
      // facing right, "up" is a negative rotation). Avoids diving into terrain.
      const upward = Math.cos(a.heading) >= 0 ? -1 : 1;
      diff = upward * Math.abs(diff);
    }
    const maxTurn = turnRate * dt;
    a.heading += clamp(diff, -maxTurn, maxTurn);
    if (a.heading > Math.PI) a.heading -= Math.PI * 2;
    else if (a.heading < -Math.PI) a.heading += Math.PI * 2;
  }

  // --- Engine speed ---
  const mult = speedMultiplier(a);
  const target = a.braking ? def.minSpeed : a.boosting ? def.boostSpeed : def.cruiseSpeed;
  const targetSpeed = target * mult;
  if (a.speed < targetSpeed) {
    a.speed = approach(a.speed, targetSpeed, def.acceleration * (a.boosting ? BOOST_ACCEL_MULT : 1) * mult * dt);
  } else {
    a.speed = approach(a.speed, targetSpeed, def.deceleration * (a.braking ? 1 : COAST_DRAG) * dt);
  }
  // Energy trade: diving gains speed, climbing bleeds it.
  a.speed += Math.sin(a.heading) * PHYSICS.gravitySpeedEffect * dt;
  const cap = (a.boosting ? def.boostSpeed : def.maxSpeed) * mult;
  a.speed = clamp(a.speed, def.minSpeed * 0.85, cap);

  // --- Velocity & position ---
  const k = damp(def.grip, dt);
  a.vx += (Math.cos(a.heading) * a.speed - a.vx) * k;
  a.vy += (Math.sin(a.heading) * a.speed - a.vy) * k;
  a.x += a.vx * dt;
  a.y += a.vy * dt;

  void world;
}
