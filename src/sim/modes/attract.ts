import { COMBAT } from '../constants';
import { chooseSpawn, spawnAircraft } from '../systems/spawn';
import type { Aircraft } from '../types';
import type { World } from '../world';
import type { GameMode, MatchPhase } from './mode';

/**
 * Endless free-for-all with instant respawns. Used for the animated main-menu
 * backdrop and as a simple sandbox for AI tuning.
 */
export class AttractMode implements GameMode {
  readonly id = 'attract';
  readonly phase: MatchPhase = 'playing';
  readonly phaseTimer = 0;
  readonly combatEnabled = true;

  update(world: World, dt: number): void {
    for (const a of world.aircraft) {
      if (a.alive || a.respawnTimer < 0) continue;
      a.respawnTimer -= dt;
      if (a.respawnTimer <= 0) {
        const sp = chooseSpawn(world, a);
        spawnAircraft(world, a, sp.x, sp.y, sp.facing);
      }
    }
  }

  onDestroyed(_world: World, victim: Aircraft): void {
    victim.respawnTimer = COMBAT.respawnDelay;
  }
}
