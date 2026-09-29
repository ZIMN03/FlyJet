import { describe, expect, it } from 'vitest';
import { AiBrain } from '../src/sim/ai/brain';
import { PERSONALITIES } from '../src/sim/ai/personalities';
import { TEAM_BLUE } from '../src/sim/constants';
import { WaveMode } from '../src/sim/modes/waves';
import { stepWorld } from '../src/sim/step';
import { spawnAircraft, chooseSpawn } from '../src/sim/systems/spawn';
import { applyDamage } from '../src/sim/systems/damage';
import type { SimEvent } from '../src/sim/types';
import { makeWorld } from './helpers';

function setupMatch(seed: number, bot: boolean, lives = 3) {
  const world = makeWorld(seed);
  const p = world.addAircraft('viper', TEAM_BLUE, 'Pilot', true, lives);
  if (bot) world.brains.set(p.id, new AiBrain(PERSONALITIES.ace, 1));
  const mode = new WaveMode([p.id]);
  world.mode = mode;
  const sp = chooseSpawn(world, p);
  spawnAircraft(world, p, sp.x, sp.y, sp.facing);
  return { world, p, mode };
}

describe('wave match flow', () => {
  it('counts down, then spawns wave 1 with weapons enabled', () => {
    const { world, mode } = setupMatch(3, false);
    expect(mode.phase).toBe('countdown');
    expect(mode.combatEnabled).toBe(false);
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    expect(mode.phase).toBe('playing');
    expect(mode.wave).toBe(1);
    expect(mode.enemiesRemaining).toBe(1);
    expect(mode.combatEnabled).toBe(true);
  });

  it('player death -> respawn with lives, final death -> match ends', () => {
    const { world, p, mode } = setupMatch(4, false, 2);
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    p.spawnProtection = 0;
    applyDamage(world, p, 999, 0, 'debug');
    expect(p.alive).toBe(false);
    expect(p.lives).toBe(1);
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    expect(p.alive).toBe(true);
    expect(p.spawnProtection).toBeGreaterThan(0);
    p.spawnProtection = 0;
    applyDamage(world, p, 999, 0, 'debug');
    expect(p.lives).toBe(0);
    expect(mode.phase).toBe('ending');
    let ended = false;
    for (let i = 0; i < 60 * 4; i++) {
      stepWorld(world, new Map());
      if (world.events.some((e) => e.type === 'matchEnd')) ended = true;
    }
    expect(ended).toBe(true);
    expect(mode.phase).toBe('ended');
  });

  it('soak: 4 minutes of bot-vs-AI combat keeps state valid and progresses', () => {
    for (const seed of [11, 22, 33]) {
      const { world, p, mode } = setupMatch(seed, true, 99);
      const counts: Record<string, number> = {};
      let aiCrashes = 0;
      for (let i = 0; i < 60 * 240; i++) {
        stepWorld(world, new Map());
        for (const e of world.events as SimEvent[]) {
          counts[e.type] = (counts[e.type] ?? 0) + 1;
          if (e.type === 'crash' && e.id !== p.id) aiCrashes++;
        }
        for (const a of world.aircraft) {
          if (!a.alive) continue;
          expect(Number.isFinite(a.x) && Number.isFinite(a.y) && Number.isFinite(a.heading)).toBe(true);
          expect(a.health).toBeGreaterThan(0);
          expect(a.health).toBeLessThanOrEqual(a.def.health);
          expect(a.y).toBeLessThan(world.terrain.seaLevel);
          expect(a.missileAmmo).toBeGreaterThanOrEqual(0);
        }
      }
      const activeBullets = world.bullets.filter((b) => b.active).length;
      console.log(`seed ${seed}: wave ${mode.wave}, player K/D ${p.stats.kills}/${p.stats.deaths}, ` +
        `aiCrashes ${aiCrashes}, bullets ${activeBullets}`, JSON.stringify(counts));
      // Levels are now three stages (two waves + a boss); a bot should clear several stages.
      expect(counts.waveClear ?? 0).toBeGreaterThanOrEqual(3);
      expect(mode.wave).toBeGreaterThanOrEqual(2);
      expect(counts.kill ?? 0).toBeGreaterThan(2);
      expect(counts.missileLaunch ?? 0).toBeGreaterThan(0);
      // AI shouldn't be flying into the terrain constantly.
      expect(aiCrashes).toBeLessThan(counts.kill);
    }
  }, 60_000);
});
