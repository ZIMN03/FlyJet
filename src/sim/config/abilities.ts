/** Special ability definitions. Behaviour is implemented in systems/abilities.ts by `kind`. */

export type AbilityKind = 'overcharge' | 'speedBurst' | 'armor' | 'stealth' | 'energyPulse';

export interface AbilityDef {
  id: string;
  kind: AbilityKind;
  name: string;
  description: string;
  duration: number;
  cooldown: number;
  /** Kind-specific tuning. */
  fireRateMult?: number;
  damageMult?: number;
  speedMult?: number;
  damageTakenMult?: number;
}

export const ABILITIES: Record<string, AbilityDef> = {
  overcharge: {
    id: 'overcharge',
    kind: 'overcharge',
    name: 'Overcharge',
    description: 'Cannons fire faster and hit harder for a short time.',
    duration: 4,
    cooldown: 18,
    fireRateMult: 1.6,
    damageMult: 1.3,
  },
  speedBurst: {
    id: 'speedBurst',
    kind: 'speedBurst',
    name: 'Slipstream',
    description: 'A short burst of extreme speed.',
    duration: 1.6,
    cooldown: 14,
    speedMult: 1.45,
  },
};
