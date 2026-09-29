import { PHYSICS } from '../constants';
import { FLIGHT } from '../config/flight';
import { angleDiff, approach, clamp, damp, wrapAngle } from '../math';
import type { AircraftDef } from '../config/aircraft';
import { Button, type Aircraft, type InputCommand } from '../types';
import type { World } from '../world';

/** Steering deflection below this is treated as "hold heading". */
const STEER_DEADZONE = 0.15;
/** When the requested heading is within this of a full reversal, we loop "over the top". */
const REVERSAL_THRESHOLD = 0.2;

function idleSpeed(def: AircraftDef): number {
  return def.minSpeed * FLIGHT.IDLE_SPEED_FRACTION;
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

/** Current maximum turn rate (rad/s) given speed, burner, brake and stall. */
export function currentTurnRate(a: Aircraft): number {
  const def = a.def;
  let rate = def.turnRate;
  if (a.boosting) rate *= def.boostTurnPenalty;
  if (a.braking) rate *= def.brakeTurnBonus;
  // Slower flight turns tighter: both a smaller radius (lower speed) and a higher rate.
  rate *= 1 + FLIGHT.SLOW_TURN_BONUS * clamp((def.cruiseSpeed - a.speed) / def.cruiseSpeed, 0, 1);
  if (a.stalled) rate *= FLIGHT.STALL_TURN_MULT;
  return rate;
}

/**
 * Arcade flight model.
 *
 * The aircraft always flies along its nose. Turning input sets a *target*
 * angular velocity; the actual angular velocity (turnVel) eases toward it
 * (TURN_RESPONSE_TIME) and back to zero on release (TURN_RELEASE_TIME), so
 * turns start immediately but never snap. Heading is kept wrapped to (-PI, PI]
 * every tick, so any number of continuous 360° loops is fine.
 *
 * Engine speed chases a target set by the throttle (or burner / brake), and
 * velocity = heading direction x speed, blended by a grip factor so a hard
 * turn carries a touch of momentum instead of pivoting on the spot.
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
  if (cmd.buttons & Button.ThrottleUp) a.throttle = Math.min(1, a.throttle + FLIGHT.THROTTLE_RATE * dt);
  if (cmd.buttons & Button.ThrottleDown) a.throttle = Math.max(0, a.throttle - FLIGHT.THROTTLE_RATE * dt);

  // --- Stall state (with hysteresis) ---
  if (a.boosting) a.stalled = false;
  else if (a.stalled) a.stalled = a.speed < def.minSpeed * FLIGHT.STALL_RECOVERY;
  else a.stalled = a.speed < def.minSpeed;

  // --- Turning: pick a target angular velocity ---
  const maxRate = currentTurnRate(a);
  let targetRate = 0;
  let active = true;
  const steerMag = Math.hypot(cmd.steerX, cmd.steerY);
  if (Math.abs(cmd.turn) > STEER_DEADZONE) {
    // Rotation controls: holding a direction keeps turning, through any number of loops.
    targetRate = cmd.turn * maxRate;
  } else if (steerMag > STEER_DEADZONE) {
    // Steer toward a direction (used by AI pilots).
    let diff = angleDiff(a.heading, Math.atan2(cmd.steerY, cmd.steerX));
    if (Math.abs(diff) > Math.PI - REVERSAL_THRESHOLD) {
      // Full reversal requested: pull the nose up and over (y-down world).
      diff = (Math.cos(a.heading) >= 0 ? -1 : 1) * Math.abs(diff);
    }
    targetRate = clamp(diff * FLIGHT.STEER_GAIN, -maxRate, maxRate);
  } else if (a.stalled) {
    // Hands off in a stall: the nose falls toward the ground (which also rebuilds speed).
    targetRate = clamp(angleDiff(a.heading, Math.PI / 2) * 3, -FLIGHT.STALL_NOSE_DROP, FLIGHT.STALL_NOSE_DROP);
  } else {
    active = false;
  }

  // --- Ease the angular velocity toward the target ---
  // Speeding up a turn (or reversing it) uses the response rate; winding down uses the release rate.
  const speedingUp = active && (Math.sign(targetRate) !== Math.sign(a.turnVel) || Math.abs(targetRate) > Math.abs(a.turnVel));
  const time = speedingUp ? FLIGHT.TURN_RESPONSE_TIME : FLIGHT.TURN_RELEASE_TIME;
  a.turnVel = approach(a.turnVel, targetRate, (maxRate / time) * dt);
  a.heading = wrapAngle(a.heading + a.turnVel * dt);

  // --- Engine speed ---
  const mult = speedMultiplier(a);
  const idle = idleSpeed(def);
  const throttleSpeed = idle + (def.maxSpeed - idle) * a.throttle;
  const target = a.boosting ? def.boostSpeed : a.braking ? Math.min(def.minSpeed, throttleSpeed) : throttleSpeed;
  const targetSpeed = target * mult;
  if (a.speed < targetSpeed) {
    a.speed = approach(a.speed, targetSpeed, def.acceleration * (a.boosting ? FLIGHT.BOOST_ACCEL_MULT : 1) * mult * dt);
  } else {
    a.speed = approach(a.speed, targetSpeed, def.deceleration * (a.braking ? 1 : FLIGHT.COAST_DRAG) * dt);
  }
  // Energy trade: diving gains speed, climbing bleeds it.
  a.speed += Math.sin(a.heading) * PHYSICS.gravitySpeedEffect * dt;
  const cap = (a.boosting ? def.boostSpeed : def.maxSpeed) * mult;
  a.speed = clamp(a.speed, FLIGHT.MIN_SPEED_FLOOR, cap);

  // --- Velocity & position: velocity = forward direction x speed (with grip) ---
  const k = damp(def.grip * FLIGHT.GRIP_MULT * (a.stalled ? FLIGHT.STALL_GRIP_MULT : 1), dt);
  a.vx += (Math.cos(a.heading) * a.speed - a.vx) * k;
  a.vy += (Math.sin(a.heading) * a.speed - a.vy) * k;
  if (a.stalled) a.vy += FLIGHT.STALL_GRAVITY * dt;
  a.x += a.vx * dt;
  a.y += a.vy * dt;

  void world;
}
