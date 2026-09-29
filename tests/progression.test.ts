import { describe, expect, it } from 'vitest';
import { AIRCRAFT, PLAYER_AIRCRAFT, isUnlocked } from '../src/sim/config/aircraft';
import { TEAM_BLUE, TEAM_ORANGE } from '../src/sim/constants';
import { levelDifficulty, WaveMode } from '../src/sim/modes/waves';
import { stepWorld } from '../src/sim/step';
import { spawnAircraft } from '../src/sim/systems/spawn';
import { Button, LockState } from '../src/sim/types';
import { applyDamage } from '../src/sim/systems/damage';
import { cmd, duelSetup, makeWorld, run } from './helpers';

describe('level difficulty curve', () => {
  it('level N sends N opponents', () => {
    for (const n of [1, 2, 3, 5, 8]) expect(levelDifficulty(n).enemies).toBe(n);
  });

  it('opening levels are much easier: fragile, no missiles, trainees with poor skill', () => {
    const l1 = levelDifficulty(1);
    const l10 = levelDifficulty(10);
    expect(l1.roster).toEqual(['trainee']);
    expect(l1.overrides.missileCapacity).toBe(0);
    expect(l1.overrides.health!).toBeLessThan(AIRCRAFT.scythe.health * 0.5);
    expect(l10.overrides.health).toBe(AIRCRAFT.scythe.health);
    expect(l1.skill).toBeLessThan(0.2);
    expect(l10.skill).toBeGreaterThan(0.85);
    expect(levelDifficulty(12).skill).toBe(1);
  });

  it('difficulty never gets easier as levels rise', () => {
    for (let n = 1; n < 12; n++) {
      const a = levelDifficulty(n);
      const b = levelDifficulty(n + 1);
      expect(b.enemies).toBeGreaterThanOrEqual(a.enemies);
      expect(b.skill).toBeGreaterThanOrEqual(a.skill);
      expect(b.overrides.health!).toBeGreaterThanOrEqual(a.overrides.health!);
      expect(b.overrides.turnRate!).toBeGreaterThanOrEqual(a.overrides.turnRate!);
      expect(b.overrides.missileCapacity!).toBeGreaterThanOrEqual(a.overrides.missileCapacity!);
    }
  });

  it('level 2 spawns two weakened opponents in a real match', () => {
    const world = makeWorld(5);
    const p = world.addAircraft('viper', TEAM_BLUE, 'P', true, 3);
    const mode = new WaveMode([p.id]);
    world.mode = mode;
    spawnAircraft(world, p, 4000, 1000, 1);
    p.godMode = true;
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    // Level 1's single opponent uses the weakened stats; clear it instantly.
    const enemy = world.aircraft.find((a) => a.team === TEAM_ORANGE && a.alive)!;
    expect(enemy.def.health).toBe(levelDifficulty(1).overrides.health);
    enemy.spawnProtection = 0;
    applyDamage(world, enemy, 999, p.id, 'debug');
    for (let i = 0; i < 60 * 5; i++) stepWorld(world, new Map());
    expect(mode.wave).toBe(2);
    expect(mode.enemiesRemaining).toBe(2);
  });
});

describe('aircraft unlocks', () => {
  it('Viper is always available; others need the listed level', () => {
    expect(isUnlocked('viper', 0)).toBe(true);
    for (const id of PLAYER_AIRCRAFT) {
      const lvl = AIRCRAFT[id].unlockLevel;
      expect(isUnlocked(id, lvl)).toBe(true);
      if (lvl > 1) expect(isUnlocked(id, lvl - 1)).toBe(false);
    }
    expect(isUnlocked('scythe', 99)).toBe(false);
  });

  it('every player aircraft flies, fires and survives a few seconds', () => {
    for (const id of PLAYER_AIRCRAFT) {
      const world = makeWorld(3);
      const a = world.addAircraft(id, TEAM_BLUE, id, true);
      spawnAircraft(world, a, 4000, 1000, 1);
      run(world, 3, new Map([[a.id, cmd({ turn: -0.5, buttons: Button.Fire | Button.Ability })]]));
      expect(a.alive).toBe(true);
      expect(Number.isFinite(a.x) && Number.isFinite(a.heading)).toBe(true);
      expect(a.stats.shotsFired).toBeGreaterThan(5);
    }
  });
});

describe('new abilities', () => {
  it('Nova Pulse damages nearby enemies and destroys their missiles', () => {
    const { world, e } = duelSetup(250);
    const nova = world.addAircraft('nova', TEAM_BLUE, 'N', true);
    spawnAircraft(world, nova, e.x - 200, e.y, 1);
    nova.spawnProtection = 0;
    const m = world.allocMissile()!;
    Object.assign(m, { active: true, x: nova.x + 100, y: nova.y, px: nova.x + 100, py: nova.y, team: TEAM_ORANGE, ownerId: e.id, targetId: nova.id, chaseLeft: 5, heading: Math.PI, speed: 100, age: 1, life: 4, flareTarget: -1 });
    const hp = e.health;
    run(world, 1 / 60, new Map([[nova.id, cmd({ buttons: Button.Ability })]]));
    expect(e.health).toBeLessThan(hp);
    expect(m.active).toBe(false);
  });

  it('Ghost Veil breaks enemy locks and prevents new ones', () => {
    const world = makeWorld(2);
    const ph = world.addAircraft('phantom', TEAM_BLUE, 'P', true);
    const en = world.addAircraft('scythe', TEAM_ORANGE, 'E', false);
    spawnAircraft(world, en, 4000, 1000, 1);
    spawnAircraft(world, ph, 4700, 1000, 1);
    run(world, 2.5);
    expect(en.lockState).toBe(LockState.Locked);
    run(world, 1 / 60, new Map([[ph.id, cmd({ buttons: Button.Ability })]]));
    run(world, 1.5);
    expect(en.lockState).not.toBe(LockState.Locked);
  });

  it('Bulwark cuts incoming damage', () => {
    const world = makeWorld(2);
    const t = world.addAircraft('titan', TEAM_BLUE, 'T', true);
    spawnAircraft(world, t, 4000, 1000, 1);
    t.spawnProtection = 0;
    applyDamage(world, t, 20, 0, 'debug');
    const normal = t.def.health - t.health; // 20 * (1 - 10% armour) = 18
    run(world, 1 / 60, new Map([[t.id, cmd({ buttons: Button.Ability })]]));
    const before = t.health;
    applyDamage(world, t, 20, 0, 'debug');
    const shielded = before - t.health; // 18 * 0.4 = 7.2
    expect(normal).toBeCloseTo(18, 5);
    expect(shielded).toBeCloseTo(7.2, 5);
  });
});
