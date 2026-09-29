import { AiBrain } from '../sim/ai/brain';
import { PERSONALITIES } from '../sim/ai/personalities';
import { TEAM_BLUE, TEAM_ORANGE, TICK_DT } from '../sim/constants';
import { AttractMode } from '../sim/modes/attract';
import { WaveMode } from '../sim/modes/waves';
import { stepWorld } from '../sim/step';
import { chooseSpawn, spawnAircraft } from '../sim/systems/spawn';
import type { Aircraft, InputCommand, SimEvent } from '../sim/types';
import { World } from '../sim/world';

/** Never simulate more than this many ticks per frame (avoids the "spiral of death" after a hitch). */
const MAX_TICKS_PER_FRAME = 6;

/**
 * A running match as seen by the client. The offline implementation steps the
 * simulation locally; an online implementation will instead send commands to
 * the server, apply snapshots, predict the local aircraft and interpolate
 * everything else — but expose this same interface to the rest of the client.
 */
export interface MatchSession {
  readonly world: World;
  readonly localId: number;
  readonly mode: WaveMode | null;
  /** Interpolation factor between the previous and current tick (0..1). */
  readonly alpha: number;
  readonly offline: boolean;
  paused: boolean;
  update(frameDt: number, sample: (() => InputCommand) | null, onEvents: (events: readonly SimEvent[]) => void): void;
  local(): Aircraft | undefined;
  /** Brief slow-motion (offline only; ignored online). */
  slowmo(duration: number, scale: number): void;
}

abstract class LocalSession implements MatchSession {
  abstract readonly world: World;
  abstract readonly localId: number;
  abstract readonly mode: WaveMode | null;
  readonly offline = true;
  alpha = 0;
  paused = false;
  private acc = 0;
  private slowT = 0;
  private slowScale = 1;
  private readonly commands = new Map<number, InputCommand>();

  update(frameDt: number, sample: (() => InputCommand) | null, onEvents: (events: readonly SimEvent[]) => void): void {
    if (this.paused) return;
    let scale = 1;
    if (this.slowT > 0) {
      this.slowT -= frameDt;
      scale = this.slowScale;
    }
    this.acc += Math.min(frameDt, 0.1) * scale;
    let ticks = 0;
    while (this.acc >= TICK_DT && ticks < MAX_TICKS_PER_FRAME) {
      this.commands.clear();
      if (sample) this.commands.set(this.localId, sample());
      stepWorld(this.world, this.commands);
      onEvents(this.world.events);
      this.acc -= TICK_DT;
      ticks++;
    }
    if (ticks === MAX_TICKS_PER_FRAME) this.acc = 0;
    this.alpha = this.acc / TICK_DT;
  }

  local(): Aircraft | undefined {
    return this.world.getAircraft(this.localId);
  }

  slowmo(duration: number, scale: number): void {
    // The strongest (slowest) active request wins; durations extend, never shorten.
    if (this.slowT <= 0 || scale < this.slowScale) this.slowScale = scale;
    this.slowT = Math.max(this.slowT, duration);
  }
}

export interface WaveSessionOptions {
  aircraft: string;
  callsign: string;
  lives: number;
  seed?: number;
}

/** Offline "Endless Skies" match: the local pilot vs waves of AI. */
export class WaveSession extends LocalSession {
  readonly world: World;
  readonly localId: number;
  readonly mode: WaveMode;

  constructor(opts: WaveSessionOptions) {
    super();
    this.world = new World({ mapId: 'azureCoast', seed: opts.seed ?? (Date.now() & 0x7fffffff) });
    const p = this.world.addAircraft(opts.aircraft, TEAM_BLUE, opts.callsign, true, opts.lives);
    this.localId = p.id;
    this.mode = new WaveMode([p.id]);
    this.world.mode = this.mode;
    const sp = chooseSpawn(this.world, p);
    spawnAircraft(this.world, p, sp.x, sp.y, sp.facing);
  }
}

/** AI-only dogfight used as the animated main-menu backdrop. */
export class AttractSession extends LocalSession {
  readonly world: World;
  readonly mode = null;
  private followId = 0;
  private followTimer = 0;

  constructor() {
    super();
    this.world = new World({ mapId: 'azureCoast', seed: 7 });
    this.world.mode = new AttractMode();
    const roster = ['ace', 'tactical', 'aggressive'];
    for (let i = 0; i < 6; i++) {
      const blue = i % 2 === 0;
      // Show off the player fleet in the menu backdrop.
      const blueCraft = ['viper', 'swift', 'titan'][(i / 2) % 3];
      const a = this.world.addAircraft(blue ? blueCraft : 'scythe', blue ? TEAM_BLUE : TEAM_ORANGE, `AI ${i}`, false);
      this.world.brains.set(a.id, new AiBrain(PERSONALITIES[roster[i % 3]], 0.7));
      const sp = this.world.map.spawns[i % this.world.map.spawns.length];
      spawnAircraft(this.world, a, sp.x, sp.y, sp.facing);
    }
    this.followId = this.world.aircraft[0].id;
  }

  get localId(): number {
    return this.followId;
  }

  override update(frameDt: number, _sample: (() => InputCommand) | null, onEvents: (events: readonly SimEvent[]) => void): void {
    super.update(frameDt, null, onEvents);
    this.followTimer += frameDt;
    const cur = this.world.getAircraft(this.followId);
    if (!cur || !cur.alive || this.followTimer > 14) {
      // Follow whichever blue fighter is alive and engaged.
      const next = this.world.aircraft.find((a) => a.alive && a.team === TEAM_BLUE && a.id !== this.followId) ??
        this.world.aircraft.find((a) => a.alive);
      if (next) this.followId = next.id;
      this.followTimer = 0;
    }
  }
}
