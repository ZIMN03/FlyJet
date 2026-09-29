import { TICK_DT } from './constants';
import { sanitizeCommand, updateFlight } from './systems/flight';
import { applyBoundaries, applyTerrainCollision } from './systems/boundary';
import { updateLock, updateWeapons } from './systems/weapons';
import { updateBullets, updateFlares, updateMissiles, updateThreats } from './systems/projectiles';
import { updateAircraftCollisions } from './systems/collision';
import { emptyCommand, type InputCommand } from './types';
import type { World } from './world';

const IDLE_COMMAND: InputCommand = emptyCommand();

/**
 * Advance the world by exactly one fixed tick.
 *
 * `commands` supplies inputs for human-controlled aircraft (local keyboard now,
 * network input buffer on a server later). AI aircraft are driven by the brains
 * registered in `world.brains`. Events emitted during this tick are available
 * in `world.events` until the next call.
 */
export function stepWorld(world: World, commands: ReadonlyMap<number, InputCommand>, dt = TICK_DT): void {
  world.events.length = 0;
  world.tick++;
  world.time += dt;
  const combat = world.mode ? world.mode.combatEnabled : true;

  // Iterate over a snapshot: modes may add/remove aircraft during the tick.
  const list = world.aircraft.slice();
  for (const a of list) {
    if (!a.alive) continue;
    a.px = a.x;
    a.py = a.y;
    a.pheading = a.heading;

    const brain = world.brains.get(a.id);
    const cmd = brain ? brain.think(world, a) : commands.get(a.id) ?? IDLE_COMMAND;
    sanitizeCommand(cmd);

    updateFlight(world, a, cmd, dt);
    applyBoundaries(world, a, dt);
    if (a.alive) applyTerrainCollision(world, a, dt);
    if (!a.alive) continue;

    if (a.spawnProtection > 0) a.spawnProtection -= dt;
    if (a.lockImmunity > 0) a.lockImmunity -= dt;
    a.timeSinceDamaged += dt;

    updateWeapons(world, a, cmd, dt, combat);
    a.prevButtons = cmd.buttons;
  }

  for (const a of list) {
    a.beingLocked = false;
    a.lockedOn = false;
  }
  for (const a of list) {
    if (a.alive && combat) updateLock(world, a, dt);
  }

  updateAircraftCollisions(world, dt);
  updateBullets(world, dt);
  updateMissiles(world, dt);
  updateFlares(world, dt);
  updateThreats(world);

  world.mode?.update(world, dt);
}
