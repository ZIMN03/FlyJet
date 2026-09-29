/**
 * Weapon power grows with the level the pilot has reached in a run: every
 * level makes cannons and missiles hit harder and cannons fire a little
 * faster. Every few levels the weapons step up a "mark", which also changes
 * how the tracers look.
 */
export const WEAPON_POWER = {
  /** Extra cannon damage per level above 1 (0.12 = +12%). */
  gunDamagePerLevel: 0.12,
  /** Extra missile damage per level above 1. */
  missileDamagePerLevel: 0.1,
  /** Extra cannon fire rate per level above 1. */
  fireRatePerLevel: 0.025,
  /** Growth stops at this level so late levels stay balanced. */
  maxLevel: 15,
  /** Levels at which the weapons reach Mk II, Mk III and Mk IV. */
  markLevels: [4, 7, 10],
} as const;

export const WEAPON_MARK_NAMES = ['Mk I', 'Mk II', 'Mk III', 'Mk IV'] as const;

function steps(level: number): number {
  return Math.max(0, Math.min(level, WEAPON_POWER.maxLevel) - 1);
}

export function weaponGunDamageMult(level: number): number {
  return 1 + WEAPON_POWER.gunDamagePerLevel * steps(level);
}

export function weaponMissileDamageMult(level: number): number {
  return 1 + WEAPON_POWER.missileDamagePerLevel * steps(level);
}

export function weaponFireRateMult(level: number): number {
  return 1 + WEAPON_POWER.fireRatePerLevel * steps(level);
}

/** 0 = Mk I ... 3 = Mk IV. */
export function weaponMark(level: number): number {
  let m = 0;
  for (const l of WEAPON_POWER.markLevels) if (level >= l) m++;
  return m;
}
