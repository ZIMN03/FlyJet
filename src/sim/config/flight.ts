/**
 * Central flight-feel tuning. Per-aircraft numbers (max speed, turn rate,
 * acceleration, burner capacity, ...) live in config/aircraft.ts; these are
 * the shared rules that shape how every aircraft handles.
 *
 * Quick reference for the per-aircraft equivalents of common tuning names:
 *   MAX_SPEED          -> AircraftDef.maxSpeed   (boost: AircraftDef.boostSpeed)
 *   ACCELERATION       -> AircraftDef.acceleration
 *   DECELERATION       -> AircraftDef.deceleration
 *   MAX_TURN_RATE      -> AircraftDef.turnRate (rad/s at cruise)
 *   BOOST_DURATION     -> afterburnerCapacity / afterburnerDrain (seconds of burn)
 *   BOOST_COOLDOWN     -> afterburnerRegenDelay + recharge at afterburnerRegen
 *   BANK_ANGLE         -> client/render/renderer.ts (visual only)
 */
export const FLIGHT = {
  // --- Turning ---
  /** Seconds to go from level flight to the full turn rate: responsive but not instant. */
  TURN_RESPONSE_TIME: 0.09,
  /** Seconds for an active turn to wind down after the key is released. */
  TURN_RELEASE_TIME: 0.13,
  /** How strongly "steer toward a direction" (AI / legacy input) converts heading error into turn rate. */
  STEER_GAIN: 6,
  /** Up to this much extra turn rate as speed falls from cruise toward zero: slower = tighter turns. */
  SLOW_TURN_BONUS: 0.7,

  // --- Speed ---
  /** Engine drag when above target speed and not braking, as a fraction of deceleration. */
  COAST_DRAG: 0.35,
  /** Extra acceleration multiplier while the afterburner is lit. */
  BOOST_ACCEL_MULT: 1.8,
  /** Throttle travel per second while up/down is held. */
  THROTTLE_RATE: 0.9,
  /** Engine speed at zero throttle, as a fraction of the stall speed (def.minSpeed). */
  IDLE_SPEED_FRACTION: 0.35,
  MIN_SPEED_FLOOR: 40,
  /**
   * Velocity follows the nose. Grip is how fast the velocity vector realigns
   * with the heading after a turn (higher = crisper, lower = more drift).
   * Multiplies AircraftDef.grip.
   */
  GRIP_MULT: 1.5,

  // --- Stall ---
  /** Turn-rate multiplier while stalled: the nose can be whipped around ("stall flip"). */
  STALL_TURN_MULT: 1.9,
  /** How fast the nose falls toward the ground while stalled and not being turned, rad/s. */
  STALL_NOSE_DROP: 1.7,
  /** Stalled wings stop carrying the aircraft: gravity pulls it down and grip is poor. */
  STALL_GRAVITY: 420,
  STALL_GRIP_MULT: 0.2,
  /** Must regain this multiple of stall speed to recover (hysteresis prevents flicker). */
  STALL_RECOVERY: 1.08,

  // --- Mid-air collisions ---
  /** Fraction of the aircraft's own max hull lost in a collision. */
  COLLISION_DAMAGE_FRACTION: 0.25,
  COLLISION_MIN_DAMAGE: 12,
  /** Seconds before the same aircraft can take collision damage again. */
  COLLISION_IMMUNITY: 0.8,
  /** Separation speed applied to both aircraft on impact. */
  COLLISION_BOUNCE: 260,
  /** Collision radius as a fraction of the combat hit radius (wings don't count). */
  COLLISION_RADIUS_MULT: 0.75,
} as const;
