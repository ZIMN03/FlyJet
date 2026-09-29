/**
 * AI personality presets. Every behavioural difference between AI pilots comes
 * from these numbers — the brain code is shared.
 */
export interface Personality {
  id: string;
  label: string;
  /** Start actively hunting a target inside this distance. */
  engageRange: number;
  /** Distance the pilot tries to fight at. */
  preferredRange: number;
  /** Closer than this: break off and reposition instead of overshooting. */
  minRange: number;
  /** Gun aim wobble (radians). */
  aimError: number;
  /** Seconds between high-level decisions. */
  reactionTime: number;
  /** Probability per second of launching a missile while locked. */
  missileRate: number;
  /** Only launch missiles when the target has no flares or is close (strategic use). */
  strategicMissiles: boolean;
  /** Chance to deploy flares against an incoming missile. */
  flareSkill: number;
  /** Chance to start evading when someone is on its tail. */
  evadeTendency: number;
  /** Health fraction below which it considers retreating. */
  retreatHealth: number;
  /** Willingness to use afterburner (0..1). */
  boostUse: number;
  /** Tries to approach from above/behind instead of head-on. */
  flankBias: number;
  /** Uses brake-turns to out-turn pursuers and missiles. */
  brakeTurns: boolean;
}

export const PERSONALITIES: Record<string, Personality> = {
  /** Opening levels: meant to be beaten. Wobbly aim, slow reactions, no tricks. */
  trainee: {
    id: 'trainee', label: 'Trainee',
    engageRange: 1600, preferredRange: 700, minRange: 300,
    aimError: 0.3, reactionTime: 0.75, missileRate: 0, strategicMissiles: false,
    flareSkill: 0, evadeTendency: 0.08, retreatHealth: 0, boostUse: 0.1, flankBias: 0, brakeTurns: false,
  },
  rookie: {
    id: 'rookie', label: 'Rookie',
    engageRange: 1900, preferredRange: 650, minRange: 280,
    aimError: 0.16, reactionTime: 0.5, missileRate: 0.25, strategicMissiles: false,
    flareSkill: 0.15, evadeTendency: 0.2, retreatHealth: 0, boostUse: 0.3, flankBias: 0, brakeTurns: false,
  },
  aggressive: {
    id: 'aggressive', label: 'Aggressive',
    engageRange: 2500, preferredRange: 450, minRange: 200,
    aimError: 0.1, reactionTime: 0.32, missileRate: 0.6, strategicMissiles: false,
    flareSkill: 0.35, evadeTendency: 0.25, retreatHealth: 0.15, boostUse: 0.85, flankBias: 0.1, brakeTurns: false,
  },
  defensive: {
    id: 'defensive', label: 'Defensive',
    engageRange: 2100, preferredRange: 900, minRange: 450,
    aimError: 0.085, reactionTime: 0.3, missileRate: 0.4, strategicMissiles: false,
    flareSkill: 0.7, evadeTendency: 0.65, retreatHealth: 0.4, boostUse: 0.5, flankBias: 0.2, brakeTurns: true,
  },
  tactical: {
    id: 'tactical', label: 'Tactical',
    engageRange: 2300, preferredRange: 700, minRange: 330,
    aimError: 0.075, reactionTime: 0.26, missileRate: 0.5, strategicMissiles: true,
    flareSkill: 0.6, evadeTendency: 0.45, retreatHealth: 0.3, boostUse: 0.6, flankBias: 0.9, brakeTurns: true,
  },
  ace: {
    id: 'ace', label: 'Ace',
    engageRange: 2700, preferredRange: 550, minRange: 260,
    aimError: 0.05, reactionTime: 0.18, missileRate: 0.55, strategicMissiles: true,
    flareSkill: 0.85, evadeTendency: 0.55, retreatHealth: 0.25, boostUse: 0.75, flankBias: 0.6, brakeTurns: true,
  },
};
