import { describe, expect, it } from 'vitest';
import {
  WEAPON_POWER, weaponFireRateMult, weaponGunDamageMult, weaponMark, weaponMissileDamageMult,
} from '../src/sim/config/weaponPower';
import { TEAM_BLUE } from '../src/sim/constants';
import { WaveMode } from '../src/sim/modes/waves';
import { stepWorld } from '../src/sim/step';
import { spawnAircraft } from '../src/sim/systems/spawn';
import { spawnMissile } from '../src/sim/systems/weapons';
import { Button } from '../src/sim/types';
import { cmd, duelSetup, makeWorld, run } from './helpers';

describe('weapon power scales with level', () => {
  it('multipliers start at 1, only grow, and stop at the cap', () => {
    expect(weaponGunDamageMult(1)).toBe(1);
    expect(weaponMissileDamageMult(1)).toBe(1);
    expect(weaponFireRateMult(1)).toBe(1);
    for (let l = 1; l < 20; l++) {
      expect(weaponGunDamageMult(l + 1)).toBeGreaterThanOrEqual(weaponGunDamageMult(l));
      expect(weaponMissileDamageMult(l + 1)).toBeGreaterThanOrEqual(weaponMissileDamageMult(l));
      expect(weaponFireRateMult(l + 1)).toBeGreaterThanOrEqual(weaponFireRateMult(l));
    }
    expect(weaponGunDamageMult(99)).toBe(weaponGunDamageMult(WEAPON_POWER.maxLevel));
    expect(weaponGunDamageMult(5)).toBeCloseTo(1.48, 5);
    expect([1, 3, 4, 6, 7, 10, 15].map(weaponMark)).toEqual([0, 0, 1, 1, 2, 3, 3]);
  });

  it('cannon rounds from a higher weapon level carry more damage', () => {
    const shot = (level: number) => {
      const { world, p } = duelSetup(3000);
      p.weaponLevel = level;
      run(world, 1 / 60, new Map([[p.id, cmd({ buttons: Button.Fire })]]));
      const b = world.bullets.find((x) => x.active && x.ownerId === p.id)!;
      return b;
    };
    const base = shot(1);
    const lv6 = shot(6);
    expect(lv6.damage / base.damage).toBeCloseTo(weaponGunDamageMult(6), 5);
    expect(base.mark).toBe(0);
    expect(lv6.mark).toBe(1);
  });

  it('missiles from a higher weapon level hit harder', () => {
    const hit = (level: number) => {
      const { world, p, e } = duelSetup(350);
      e.def.health = e.health = 5000;
      p.weaponLevel = level;
      spawnMissile(world, p, e.id, 0);
      run(world, 3);
      return 5000 - e.health;
    };
    const base = hit(1);
    const lv8 = hit(8);
    expect(base).toBeGreaterThan(0);
    expect(lv8 / base).toBeCloseTo(weaponMissileDamageMult(8), 3);
  });

  it('faster fire at higher levels does not overheat the cannons sooner', () => {
    const timeToOverheat = (level: number) => {
      const { world, p } = duelSetup(3000);
      p.weaponLevel = level;
      const fire = new Map([[p.id, cmd({ buttons: Button.Fire })]]);
      let t = 0;
      while (!p.overheated && t < 30) { run(world, 1 / 60, fire); t += 1 / 60; }
      return t;
    };
    expect(timeToOverheat(10)).toBeGreaterThanOrEqual(timeToOverheat(1) - 0.1);
  });

  it('reaching a new level upgrades the pilot weapons and announces it', () => {
    const world = makeWorld(5);
    const p = world.addAircraft('viper', TEAM_BLUE, 'P', true, 3);
    const mode = new WaveMode([p.id]);
    world.mode = mode;
    spawnAircraft(world, p, 4000, 1000, 1);
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    expect(p.weaponLevel).toBe(1);
    (mode as unknown as { startLevel(w: typeof world, l: number): void }).startLevel(world, 4);
    expect(p.weaponLevel).toBe(4);
    const ev = world.events.find((e) => e.type === 'weaponsUpgraded');
    expect(ev && ev.type === 'weaponsUpgraded' && ev.newMark).toBe(true);
    expect(ev && ev.type === 'weaponsUpgraded' && ev.gunPct).toBe(36);
  });
});
