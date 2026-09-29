import type { AircraftDef } from './aircraft';

/**
 * Hangar upgrades bought with credits. Each level really changes the aircraft's
 * stats in the simulation (see applyUpgrades). Offline these are client-owned;
 * online they will be validated/applied by the server from the same table.
 */
export type UpgradeId = 'engine' | 'airframe' | 'weapons' | 'missiles' | 'burner';

export interface UpgradeDef {
  id: UpgradeId;
  name: string;
  /** What one level does, in player terms. */
  perLevel: string;
  /** Credit cost for level 1, 2, 3. */
  costs: [number, number, number];
}

export const MAX_UPGRADE_LEVEL = 3;

export const UPGRADES: UpgradeDef[] = [
  { id: 'engine', name: 'Engine', perLevel: '+4% speed and acceleration', costs: [250, 600, 1200] },
  { id: 'airframe', name: 'Airframe', perLevel: '+10% hull', costs: [250, 600, 1200] },
  { id: 'weapons', name: 'Cannons', perLevel: '+6% cannon damage, 10% less heat', costs: [300, 700, 1400] },
  { id: 'missiles', name: 'Missile rack', perLevel: '+1 missile, 12% faster re-arm', costs: [300, 700, 1400] },
  { id: 'burner', name: 'Afterburner', perLevel: '+12% burner fuel and recharge', costs: [200, 500, 1000] },
];

export type UpgradeLevels = Partial<Record<UpgradeId, number>>;

/** Stat overrides for an aircraft with the given upgrade levels. */
export function applyUpgrades(def: AircraftDef, levels: UpgradeLevels): Partial<AircraftDef> {
  const lv = (id: UpgradeId) => Math.max(0, Math.min(MAX_UPGRADE_LEVEL, Math.floor(levels[id] ?? 0)));
  const eng = 1 + 0.04 * lv('engine');
  const burn = 1 + 0.12 * lv('burner');
  return {
    cruiseSpeed: def.cruiseSpeed * eng,
    maxSpeed: def.maxSpeed * eng,
    boostSpeed: def.boostSpeed * eng,
    acceleration: def.acceleration * eng,
    health: Math.round(def.health * (1 + 0.1 * lv('airframe'))),
    gunDamageMult: (def.gunDamageMult ?? 1) * (1 + 0.06 * lv('weapons')),
    gunHeatMult: (def.gunHeatMult ?? 1) * (1 - 0.1 * lv('weapons')),
    missileCapacity: def.missileCapacity + lv('missiles'),
    missileRearmTime: def.missileRearmTime * (1 - 0.12 * lv('missiles')),
    afterburnerCapacity: def.afterburnerCapacity * burn,
    afterburnerRegen: def.afterburnerRegen * burn,
  };
}

/** Credits needed for the next level of an upgrade, or null if maxed. */
export function nextUpgradeCost(id: UpgradeId, currentLevel: number): number | null {
  const u = UPGRADES.find((x) => x.id === id);
  if (!u || currentLevel >= MAX_UPGRADE_LEVEL) return null;
  return u.costs[currentLevel];
}
