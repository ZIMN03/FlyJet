import { World } from '../src/sim/world';
import { stepWorld } from '../src/sim/step';
import { spawnAircraft } from '../src/sim/systems/spawn';
import { TEAM_BLUE, TEAM_ORANGE } from '../src/sim/constants';
import { emptyCommand, type InputCommand, type SimEvent } from '../src/sim/types';

export function makeWorld(seed = 1) {
  return new World({ mapId: 'azureCoast', seed });
}

/** Two aircraft facing each other's direction in open sky. */
export function duelSetup(gap = 600) {
  const world = makeWorld();
  const p = world.addAircraft('viper', TEAM_BLUE, 'Player', true);
  const e = world.addAircraft('scythe', TEAM_ORANGE, 'Enemy', false);
  spawnAircraft(world, p, 4000, 1000, 1);
  spawnAircraft(world, e, 4000 + gap, 1000, 1);
  p.spawnProtection = 0;
  e.spawnProtection = 0;
  return { world, p, e };
}

export function run(
  world: World,
  seconds: number,
  cmds: Map<number, InputCommand> = new Map(),
  onTick?: (events: SimEvent[]) => void,
) {
  const ticks = Math.round(seconds * 60);
  for (let i = 0; i < ticks; i++) {
    stepWorld(world, cmds);
    onTick?.(world.events);
  }
}

export function cmd(partial: Partial<InputCommand>): InputCommand {
  return { ...emptyCommand(), ...partial };
}
