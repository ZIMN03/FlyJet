import { PHYSICS } from '../constants';
import { angleDiff, approach, clamp, damp } from '../math';
import type { AircraftDef } from '../config/aircraft';
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

// --- Throttle & stall ---
/** Throttle travel per second while up/down is held. */
const THROTTLE_RATE = 0.9;
/** Engine speed at zero throttle, as a fraction of the stall speed (def.minSpeed). */
const IDLE_SPEED_FRACTION = 0.35;
/** Up to this much extra turn rate as speed falls from cruise toward zero: slower = tighter turns. */
const SLOW_TURN_BONUS = 0.7;
/** Turn-rate multiplier while stalled: the nose can be whipped around ("stall flip"). */
const STALL_TURN_MULT = 1.9;
/** How fast the nose falls toward the ground while stalled and not being turned, rad/s. */
const STALL_NOSE_DROP = 1.7;
/** Stalled wings stop carrying the aircraft: gravity pulls it down, grip is poor. */
const STALL_GRAVITY = 420;
const STALL_GRIP_MULT = 0.25;
/** Must regain this multiple of stall speed to recover (hysteresis prevents flicker). */
const STALL_RECOVERY = 1.08;
const MIN_SPEED_FLOOR = 40;

function idleSpeed(def: AircraftDef): number {
  return def.minSpeed * IDLE_SPEED_FRACTION;
}

/** Throttle setting whose target speed is the aircraft's cruise speed (the default). */
export function cruiseThrottle(def: AircraftDef): number {
  const idle = idleSpeed(def);
  return clamp((def.cruiseSpeed - idle) / (def.maxSpeed - idle), 0, 1);
}

/**
 * Sanitise a command in place. Anything coming from a remote client must pass
 * through here before touching the simulation.
 */
export function sanitizeCommand(cmd: InputCommand): void {
  if (!Number.isFinite(cmd.steerX)) cmd.steerX = 0;
  if (!Number.isFinite(cmd.steerY)) cmd.steerY = 0;
  cmd.turn = Number.isFinite(cmd.turn) ? clamp(cmd.turn, -1, 1) : 0;
  const m = Math.hypot(cmd.steerX, cmd.steerY);
  if (m > 1) {
    cmd.steerX /= m;
    cmd.steerY /= m;
  }
  cmd.buttons &= 0xff;
}

export function speedMultiplier(a: Aircraft): number {
  if (a.abilityTimer > 0 && a.ability.kind === 'speedBurst') return a.ability.speedMult ?? 1;
  return 1;
}

/**
 * Arcade flight model: the nose turns at a limited rate, engine speed chases a
 * target set by the throttle (or afterburner / brake), and velocity
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

  // --- Throttle ---
  if (cmd.buttons & Button.ThrottleUp) a.throttle = Math.min(1, a.throttle + THROTTLE_RATE * dt);
  if (cmd.buttons & Button.ThrottleDown) a.throttle = Math.max(0, a.throttle - THROTTLE_RATE * dt);

  // --- Stall state (with hysteresis) ---
  if (a.boosting) a.stalled = false;
  else if (a.stalled) a.stalled = a.speed < def.minSpeed * STALL_RECOVERY;
  else a.stalled = a.speed < def.minSpeed;

  // --- Turning ---
  let turnRate = def.turnRate;
  if (a.boosting) turnRate *= def.boostTurnPenalty;
  if (a.braking) turnRate *= def.brakeTurnBonus;
  // Slower flight turns tighter: both a smaller radius (lower speed) and a higher rate.
  turnRate *= 1 + SLOW_TURN_BONUS * clamp((def.cruiseSpeed - a.speed) / def.cruiseSpeed, 0, 1);
  if (a.stalled) turnRate *= STALL_TURN_MULT;
  const steerMag = Math.hypot(cmd.steerX, cmd.steerY);
  if (Math.abs(cmd.turn) > STEER_DEADZONE) {
    // Rotation controls: holding a direction keeps turning, so the aircraft
    // flies full loops for as long as the button is held.
    a.heading += cmd.turn * turnRate * dt;
    if (a.heading > Math.PI) a.heading -= Math.PI * 2;
    else if (a.heading < -Math.PI) a.heading += Math.PI * 2;
  } else if (steerMag > STEER_DEADZONE) {
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
  } else if (a.stalled) {
    // Hands off in a stall: the nose falls toward the ground (which also rebuilds speed).
    const maxDrop = STALL_NOSE_DROP * dt;
    a.heading += clamp(angleDiff(a.heading, Math.PI / 2), -maxDrop, maxDrop);
  }

  // --- Engine speed ---
  const mult = speedMultiplier(a);
  const idle = idleSpeed(def);
  const throttleSpeed = idle + (def.maxSpeed - idle) * a.throttle;
  const target = a.boosting ? def.boostSpeed : a.braking ? Math.min(def.minSpeed, throttleSpeed) : throttleSpeed;
  const targetSpeed = target * mult;
  if (a.speed < targetSpeed) {
    a.speed = approach(a.speed, targetSpeed, def.acceleration * (a.boosting ? BOOST_ACCEL_MULT : 1) * mult * dt);
  } else {
    a.speed = approach(a.speed, targetSpeed, def.deceleration * (a.braking ? 1 : COAST_DRAG) * dt);
  }
  // Energy trade: diving gains speed, climbing bleeds it.
  a.speed += Math.sin(a.heading) * PHYSICS.gravitySpeedEffect * dt;
  const cap = (a.boosting ? def.boostSpeed : def.maxSpeed) * mult;
  a.speed = clamp(a.speed, MIN_SPEED_FLOOR, cap);

  // --- Velocity & position ---
  const k = damp(def.grip * (a.stalled ? STALL_GRIP_MULT : 1), dt);
  a.vx += (Math.cos(a.heading) * a.speed - a.vx) * k;
  a.vy += (Math.sin(a.heading) * a.speed - a.vy) * k;
  if (a.stalled) a.vy += STALL_GRAVITY * dt;
  a.x += a.vx * dt;
  a.y += a.vy * dt;

  void world;
}
