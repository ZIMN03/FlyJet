import type { Aircraft } from '../types';
import type { World } from '../world';

export type MatchPhase =
  | 'countdown' | 'playing' | 'intermission' | 'bossWarning' | 'levelComplete' | 'ending' | 'ended';

/**
 * A game mode owns match flow: countdown, win/loss, respawns, waves, scoring
 * extras. Flight/weapons/damage are shared systems; modes only orchestrate.
 */
export interface GameMode {
  readonly id: string;
  readonly phase: MatchPhase;
  /** Seconds left in the current phase (countdown/intermission), for UI. */
  readonly phaseTimer: number;
  /** When false, weapons are disabled (e.g. countdown). */
  readonly combatEnabled: boolean;
  update(world: World, dt: number): void;
  onDestroyed(world: World, victim: Aircraft, killerId: number): void;
  /** Extra score a mode awards for this kill (e.g. bosses); included in the kill event. */
  killBonus?(world: World, victim: Aircraft, killer: Aircraft): number;
}
