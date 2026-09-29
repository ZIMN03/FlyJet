import { describe, expect, it } from 'vitest';
import { AIRCRAFT, PLAYER_AIRCRAFT, isUnlocked } from '../src/sim/config/aircraft';
import { TEAM_BLUE, TEAM_ORANGE } from '../src/sim/constants';
import {
  bossOverrides, enemyOverrides, enemyPersonality, levelDifficulty, levelStages, WaveMode,
} from '../src/sim/modes/waves';
import { BOSS_PROFILES, BossBrain } from '../src/sim/ai/boss';
import { stepWorld } from '../src/sim/step';
import { spawnAircraft } from '../src/sim/systems/spawn';
import { Button, LockState } from '../src/sim/types';
import { applyDamage } from '../src/sim/systems/damage';
import { cmd, duelSetup, makeWorld, run } from './helpers';

describe('level difficulty curve', () => {
  it('level N sends N opponents', () => {
    for (const n of [1, 2, 3, 5, 8]) expect(levelDifficulty(n).enemies).toBe(n);
  });

  it('opening levels are much easier: fragile light fighters, no missiles, trainees', () => {
    const l1 = levelDifficulty(1);
    const l10 = levelDifficulty(10);
    expect(l1.archetypes).toEqual(['dart']);
    expect(enemyPersonality('dart', 1)).toBe('trainee');
    expect(enemyOverrides('dart', l1).missileCapacity).toBe(0);
    expect(enemyOverrides('dart', l1).health!).toBeLessThan(AIRCRAFT.dart.health * 0.5);
    expect(enemyOverrides('dart', l10).health).toBe(AIRCRAFT.dart.health);
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
      expect(b.healthMult).toBeGreaterThanOrEqual(a.healthMult);
      expect(b.turnMult).toBeGreaterThanOrEqual(a.turnMult);
      expect(Number(b.missiles)).toBeGreaterThanOrEqual(Number(a.missiles));
      expect(b.archetypes.length).toBeGreaterThanOrEqual(a.archetypes.length);
    }
  });

  it('each level is a sequence: wave of N, wave of N+1, then a boss (Stormbreaker every 3rd)', () => {
    for (const lvl of [1, 2, 3, 4, 6]) {
      const st = levelStages(lvl);
      expect(st.map((s) => s.kind)).toEqual(['wave', 'wave', 'boss']);
      expect(st[0].kind === 'wave' && st[0].count).toBe(lvl);
      expect(st[1].kind === 'wave' && st[1].count).toBe(lvl + 1);
      expect(st[2].kind === 'boss' && st[2].boss).toBe(lvl % 3 === 0 ? 'stormbreaker' : 'warden');
    }
  });

  it('level 1 plays through: contact, second wave, Warden, level complete, then level 2', () => {
    const world = makeWorld(5);
    const p = world.addAircraft('viper', TEAM_BLUE, 'P', true, 3);
    const mode = new WaveMode([p.id]);
    world.mode = mode;
    spawnAircraft(world, p, 4000, 1000, 1);
    p.godMode = true;
    const seen: string[] = [];
    const clearStage = () => {
      for (const a of world.aircraft) {
        if (a.team === TEAM_ORANGE && a.alive) {
          a.spawnProtection = 0;
          a.godMode = false;
          applyDamage(world, a, 99999, p.id, 'debug');
        }
      }
    };
    for (let i = 0; i < 60 * 40 && mode.wave < 2; i++) {
      stepWorld(world, new Map());
      for (const e of world.events) seen.push(e.type);
      if (mode.phase === 'playing' && i % 30 === 0) clearStage();
    }
    expect(seen).toContain('contact');
    expect(seen).toContain('bossIncoming');
    expect(seen).toContain('levelComplete');
    expect(mode.wave).toBe(2);
    // The first stage of level 1 was a single weakened light fighter.
    expect(seen.filter((t) => t === 'stageStart').length).toBeGreaterThanOrEqual(4);
  });

  it('the first stage of level 2 has two weakened opponents', () => {
    const world = makeWorld(6);
    const p = world.addAircraft('viper', TEAM_BLUE, 'P', true, 3);
    const mode = new WaveMode([p.id]);
    world.mode = mode;
    spawnAircraft(world, p, 4000, 1000, 1);
    p.godMode = true;
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    const first = world.aircraft.find((a) => a.team === TEAM_ORANGE && a.alive)!;
    expect(first.def.health).toBe(enemyOverrides('dart', levelDifficulty(1)).health);
    // Jump straight to level 2 via the mode's own flow.
    (mode as unknown as { startLevel(w: typeof world, l: number): void }).startLevel(world, 2);
    const hostiles = world.aircraft.filter((a) => a.team === TEAM_ORANGE && a.alive && a.id !== first.id);
    expect(hostiles.length).toBe(2);
  });
});

describe('bosses', () => {
  it('Stormbreaker changes phase, raises a shield, launches salvos and drones', () => {
    const world = makeWorld(9);
    const p = world.addAircraft('titan', TEAM_BLUE, 'P', true, 3);
    spawnAircraft(world, p, 3500, 900, 1);
    p.godMode = true;
    const mode = new WaveMode([p.id]);
    world.mode = mode;
    for (let i = 0; i < 60 * 4; i++) stepWorld(world, new Map());
    (mode as unknown as { startLevel(w: typeof world, l: number): void }).startLevel(world, 3);
    (mode as unknown as { stage: number }).stage = 2;
    (mode as unknown as { startStage(w: typeof world): void }).startStage(world);
    const events: string[] = [];
    for (let i = 0; i < 60 * 4; i++) { stepWorld(world, new Map()); events.push(...world.events.map((e) => e.type)); }
    const boss = world.aircraft.find((a) => a.def.id === 'stormbreaker')!;
    expect(boss).toBeTruthy();
    expect(boss.def.boss).toBe(true);
    // Knock it into phase 2 (below 70%).
    boss.spawnProtection = 0;
    applyDamage(world, boss, boss.def.health * 0.5, p.id, 'debug'); // 25% armour => ~37% hull lost
    for (let i = 0; i < 60 * 14; i++) { stepWorld(world, new Map()); events.push(...world.events.map((e) => e.type)); }
    expect(events).toContain('bossPhase');
    expect(events).toContain('missileLaunch');
    const drones = world.aircraft.filter((a) => a.def.id === 'dart' && a.alive).length;
    expect(drones).toBeGreaterThan(0);
  });

  it('a boss is invulnerable only during its phase-change shield', () => {
    const world = makeWorld(9);
    const p = world.addAircraft('viper', TEAM_BLUE, 'P', true, 3);
    spawnAircraft(world, p, 3500, 900, 1);
    const w = world.addAircraft('warden', TEAM_ORANGE, 'W', false, 1, bossOverrides('warden', 1));
    const brain = new BossBrain(BOSS_PROFILES.warden, { spawnEscorts: () => 0, escortsAlive: () => 0 });
    world.brains.set(w.id, brain);
    spawnAircraft(world, w, 5000, 900, -1);
    w.spawnProtection = 0;
    applyDamage(world, w, w.def.health * 0.8, p.id, 'debug'); // 20% armour => 64% lost -> phase 2 next tick
    stepWorld(world, new Map());
    expect(brain.phase).toBe(2);
    expect(brain.shielded).toBe(true);
    const hp = w.health;
    applyDamage(world, w, 50, p.id, 'debug');
    expect(w.health).toBe(hp);
    for (let i = 0; i < 60 * 3; i++) stepWorld(world, new Map());
    expect(brain.shielded).toBe(false);
    applyDamage(world, w, 10, p.id, 'debug');
    expect(w.health).toBeLessThan(hp);
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
