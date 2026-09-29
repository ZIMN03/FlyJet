/**
 * Local persistence for settings, progression and statistics.
 * Every field is validated on load; corrupted data is backed up and replaced
 * with defaults instead of crashing the game.
 *
 * NOTE: offline progression is client-side by nature. When online play lands,
 * XP/credits/unlocks become server-owned and this file only caches them.
 */

export type Action =
  | 'up' | 'down' | 'left' | 'right'
  | 'fire' | 'missile' | 'flare' | 'boost' | 'brake' | 'ability' | 'pause';

export const ACTIONS: Action[] = ['up', 'down', 'left', 'right', 'fire', 'missile', 'flare', 'boost', 'brake', 'ability', 'pause'];

export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  up: ['KeyW', 'ArrowUp'],
  down: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  fire: ['Space', 'KeyJ'],
  missile: ['KeyE', 'KeyK'],
  flare: ['KeyF', 'KeyL'],
  boost: ['ShiftLeft', 'KeyI'],
  brake: ['KeyC', 'KeyU'],
  ability: ['KeyQ', 'KeyO'],
  pause: ['Escape', 'KeyP'],
};

export interface Settings {
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  /** 0 = off, 1 = full. */
  screenShake: number;
  /** Particle density multiplier (0.35..1). */
  effects: number;
  showFps: boolean;
  showMinimap: boolean;
  /** HUD text scale multiplier. */
  hudScale: number;
  /** Stick/keyboard steering sensitivity (reserved for analog curves). */
  sensitivity: number;
  bindings: Record<Action, string[]>;
}

export interface ProfileStats {
  matches: number;
  kills: number;
  deaths: number;
  assists: number;
  bestWave: number;
  bestScore: number;
  bestStreak: number;
  playTimeSec: number;
}

export interface Profile {
  callsign: string;
  xp: number;
  credits: number;
  favoriteAircraft: string;
  tutorialDone: boolean;
  stats: ProfileStats;
}

export interface SaveData {
  version: 1;
  settings: Settings;
  profile: Profile;
}

const KEY = 'aerovant.save.v1';

export function defaultSave(): SaveData {
  return {
    version: 1,
    settings: {
      masterVolume: 0.8,
      musicVolume: 0.5,
      sfxVolume: 0.8,
      screenShake: 1,
      effects: 1,
      showFps: false,
      showMinimap: true,
      hudScale: 1,
      sensitivity: 1,
      bindings: structuredClone(DEFAULT_BINDINGS),
    },
    profile: {
      callsign: 'Pilot',
      xp: 0,
      credits: 0,
      favoriteAircraft: 'viper',
      tutorialDone: false,
      stats: { matches: 0, kills: 0, deaths: 0, assists: 0, bestWave: 0, bestScore: 0, bestStreak: 0, playTimeSec: 0 },
    },
  };
}

function num(v: unknown, def: number, lo: number, hi: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
}
function bool(v: unknown, def: boolean): boolean {
  return typeof v === 'boolean' ? v : def;
}
function str(v: unknown, def: string, maxLen = 24): string {
  return typeof v === 'string' && v.length > 0 ? v.slice(0, maxLen) : def;
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate untrusted JSON into a SaveData, filling anything missing/invalid with defaults. */
export function sanitizeSave(raw: unknown): SaveData {
  const d = defaultSave();
  if (!isObj(raw)) return d;
  const s = isObj(raw.settings) ? raw.settings : {};
  const p = isObj(raw.profile) ? raw.profile : {};
  const ps = isObj(p.stats) ? p.stats : {};

  const bindings = structuredClone(DEFAULT_BINDINGS);
  if (isObj(s.bindings)) {
    for (const a of ACTIONS) {
      const b = s.bindings[a];
      if (Array.isArray(b) && b.every((k) => typeof k === 'string') && b.length > 0) bindings[a] = b.slice(0, 3) as string[];
    }
  }

  return {
    version: 1,
    settings: {
      masterVolume: num(s.masterVolume, d.settings.masterVolume, 0, 1),
      musicVolume: num(s.musicVolume, d.settings.musicVolume, 0, 1),
      sfxVolume: num(s.sfxVolume, d.settings.sfxVolume, 0, 1),
      screenShake: num(s.screenShake, d.settings.screenShake, 0, 1),
      effects: num(s.effects, d.settings.effects, 0.35, 1),
      showFps: bool(s.showFps, d.settings.showFps),
      showMinimap: bool(s.showMinimap, d.settings.showMinimap),
      hudScale: num(s.hudScale, d.settings.hudScale, 0.8, 1.4),
      sensitivity: num(s.sensitivity, d.settings.sensitivity, 0.5, 1.5),
      bindings,
    },
    profile: {
      callsign: str(p.callsign, d.profile.callsign, 16),
      xp: num(p.xp, 0, 0, 1e9),
      credits: num(p.credits, 0, 0, 1e9),
      favoriteAircraft: str(p.favoriteAircraft, 'viper'),
      tutorialDone: bool(p.tutorialDone, false),
      stats: {
        matches: num(ps.matches, 0, 0, 1e9),
        kills: num(ps.kills, 0, 0, 1e9),
        deaths: num(ps.deaths, 0, 0, 1e9),
        assists: num(ps.assists, 0, 0, 1e9),
        bestWave: num(ps.bestWave, 0, 0, 1e6),
        bestScore: num(ps.bestScore, 0, 0, 1e9),
        bestStreak: num(ps.bestStreak, 0, 0, 1e6),
        playTimeSec: num(ps.playTimeSec, 0, 0, 1e10),
      },
    },
  };
}

export interface StorageLike {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null; // e.g. storage disabled by privacy settings
  }
}

export class SaveStore {
  data: SaveData;
  /** Set when a corrupted save was found and reset, so the UI can inform the player. */
  recovered = false;

  constructor(private readonly storage: StorageLike | null = defaultStorage()) {
    this.data = this.load();
  }

  private load(): SaveData {
    if (!this.storage) return defaultSave();
    let text: string | null = null;
    try {
      text = this.storage.getItem(KEY);
      if (!text) return defaultSave();
      return sanitizeSave(JSON.parse(text));
    } catch {
      this.recovered = true;
      try {
        if (text) this.storage.setItem(`${KEY}.corrupt`, text);
      } catch { /* ignore */ }
      return defaultSave();
    }
  }

  save(): void {
    if (!this.storage) return;
    try {
      this.storage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota or privacy errors must never crash the game.
    }
  }
}

/** XP needed to go from `level` to `level + 1`. */
export function xpForLevel(level: number): number {
  return 400 + (level - 1) * 200;
}

export function levelFromXp(xp: number): { level: number; into: number; needed: number } {
  let level = 1;
  let rest = xp;
  while (rest >= xpForLevel(level)) {
    rest -= xpForLevel(level);
    level++;
  }
  return { level, into: rest, needed: xpForLevel(level) };
}
