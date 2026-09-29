import { AIRCRAFT, PLAYER_AIRCRAFT, isUnlocked } from '../../sim/config/aircraft';
import { ABILITIES } from '../../sim/config/abilities';
import { GUNS, MISSILES } from '../../sim/config/weapons';
import type { AudioEngine } from '../audio/audio';
import { keyLabel, type InputManager } from '../input/input';
import { PALETTES, drawAirframe, drawExhaust } from '../render/aircraftArt';
import { ACTIONS, DEFAULT_BINDINGS, levelFromXp, type Action, type SaveStore } from '../save/save';

export type ScreenId = 'title' | 'main' | 'play' | 'hangar' | 'profile' | 'settings' | 'pause' | 'results' | 'error';

export type UiAction =
  | { type: 'start'; tutorial: boolean }
  | { type: 'resume' }
  | { type: 'restart' }
  | { type: 'quit' }
  | { type: 'settingsChanged' }
  | { type: 'enteredMenu' };

export interface ResultsData {
  title: string;
  subtitle: string;
  score: number;
  wave: number;
  kills: number;
  deaths: number;
  assists: number;
  damageDealt: number;
  damageTaken: number;
  accuracy: number;
  bestStreak: number;
  timeSurvived: number;
  xpGained: number;
  creditsGained: number;
  xpBefore: number;
  xpAfter: number;
  newBest: boolean;
  /** Names of aircraft unlocked during this match. */
  unlocked: string[];
}

const LOCK_ICON = `<svg class="lock" viewBox="0 0 16 16" aria-label="Locked" role="img"><rect x="3" y="7" width="10" height="8" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 0 1 6 0v2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`;

/** Scale used for hangar stat bars (the best value any flyable aircraft reaches). */
const STAT_SCALE = { boost: 900, cruise: 500, turn: 4, hull: 160, dps: 130, missiles: 8, lock: 1600 };

const ACTION_LABELS: Record<Action, string> = {
  up: 'Throttle up', down: 'Throttle down', left: 'Turn anticlockwise', right: 'Turn clockwise',
  fire: 'Fire cannons', missile: 'Launch missile', flare: 'Deploy flares', boost: 'Afterburner',
  brake: 'Air brake', ability: 'Special ability', pause: 'Pause / back',
};

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const EMBLEM = `<svg viewBox="0 0 110 70" aria-hidden="true">
  <defs><linearGradient id="eg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#36d8ff"/></linearGradient></defs>
  <path d="M55 4 L104 58 L74 50 L55 66 L36 50 L6 58 Z" fill="none" stroke="url(#eg)" stroke-width="4" stroke-linejoin="round"/>
  <path d="M55 20 L70 44 L55 38 L40 44 Z" fill="url(#eg)"/>
</svg>`;

/**
 * DOM-based menus layered over the game canvas. Screens are small HTML
 * templates; all interaction is routed through `onAction` so the UI never
 * touches game state directly.
 */
export class UI {
  current: ScreenId | null = null;
  private stack: ScreenId[] = [];
  private settingsTab = 'audio';
  private resultsData: ResultsData | null = null;
  private errorText = '';
  private previewRaf = 0;
  private toastTimer = 0;
  /** Aircraft currently shown in the hangar (any plane can be inspected, locked or not). */
  private hangarSel = '';
  /** Ignore activations until this time — screens that appear mid-action (results) must not eat a held key. */
  private guardUntil = 0;

  constructor(
    private readonly root: HTMLElement,
    private readonly save: SaveStore,
    private readonly audio: AudioEngine,
    private readonly input: InputManager,
    private readonly onAction: (a: UiAction) => void,
  ) {
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('input', (e) => this.onInput(e));
    root.addEventListener('change', (e) => this.onInput(e));
    root.addEventListener('mouseover', (e) => {
      const t = (e.target as HTMLElement).closest('button:not(:disabled)');
      if (t && t !== document.activeElement) {
        (t as HTMLElement).focus({ preventScroll: true });
        this.audio.play('uiMove', undefined, undefined, 0.6);
      }
    });
    // Arrow up/down navigate between controls rather than nudging sliders.
    root.addEventListener('keydown', (e) => {
      if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && (e.target as HTMLElement).matches('input[type=range]')) e.preventDefault();
    }, true);
  }

  get visible(): boolean {
    return this.current !== null;
  }

  show(id: ScreenId, push = true): void {
    if (push && this.current && this.current !== id && this.current !== 'title') this.stack.push(this.current);
    this.current = id;
    if (id === 'results' || id === 'error') this.guardUntil = performance.now() + 900;
    cancelAnimationFrame(this.previewRaf);
    this.root.innerHTML = this.render(id);
    if (id === 'hangar') this.startPreview();
    if (id === 'results') this.animateResults();
    const first = this.root.querySelector<HTMLElement>('[autofocus], button:not(:disabled), .card:not(:disabled)');
    first?.focus({ preventScroll: true });
    if (id === 'main') this.onAction({ type: 'enteredMenu' });
  }

  hide(): void {
    cancelAnimationFrame(this.previewRaf);
    this.current = null;
    this.stack = [];
    this.root.innerHTML = '';
  }

  showResults(data: ResultsData): void {
    this.resultsData = data;
    this.stack = [];
    this.show('results', false);
  }

  showError(text: string): void {
    this.errorText = text;
    this.stack = [];
    this.show('error', false);
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    document.body.appendChild(el);
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.remove(), 3500);
  }

  /** Back/escape: pop to the previous screen where that makes sense. */
  back(): void {
    if (!this.current || this.input.captureNext) return;
    if (this.current === 'pause') {
      this.onAction({ type: 'resume' });
      return;
    }
    if (this.current === 'title' || this.current === 'main' || this.current === 'results' || this.current === 'error') return;
    this.audio.play('uiBack');
    const prev = this.stack.pop() ?? 'main';
    this.show(prev, false);
  }

  /** Gamepad/keyboard focus movement across focusable controls. */
  moveFocus(dir: number): void {
    const items = Array.from(this.root.querySelectorAll<HTMLElement>('button:not(:disabled), input, .keycap'))
      .filter((el) => el.offsetParent !== null);
    if (!items.length) return;
    const i = items.indexOf(document.activeElement as HTMLElement);
    const next = items[(i + dir + items.length) % items.length];
    next.focus({ preventScroll: false });
    this.audio.play('uiMove', undefined, undefined, 0.6);
  }

  activateFocused(): void {
    if (performance.now() < this.guardUntil) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && this.root.contains(el)) el.click();
  }

  // ---------------------------------------------------------------- templates

  private render(id: ScreenId): string {
    switch (id) {
      case 'title': return this.titleHtml();
      case 'main': return this.mainHtml();
      case 'play': return this.playHtml();
      case 'hangar': return this.hangarHtml();
      case 'profile': return this.profileHtml();
      case 'settings': return this.settingsHtml();
      case 'pause': return this.pauseHtml();
      case 'results': return this.resultsHtml();
      case 'error': return this.errorHtml();
    }
  }

  private titleHtml(): string {
    return `<div class="screen title" data-action="title-continue">
      <div class="logo">${EMBLEM}<div class="wordmark">AEROVANT</div><div class="tagline">Arcade Sky Combat</div></div>
      <div class="press">PRESS ANY KEY</div>
      <div class="footer-note">v0.1 prototype · keyboard or gamepad</div>
    </div>`;
  }

  private playerCard(): string {
    const p = this.save.data.profile;
    const lv = levelFromXp(p.xp);
    return `<div class="panel pcard side">
      <h2>Pilot</h2>
      <div class="name">${esc(p.callsign)}</div>
      <div class="lvl">RANK ${lv.level}</div>
      <div class="xpbar"><i style="width:${(lv.into / lv.needed) * 100}%"></i></div>
      <div class="kv"><span>XP</span><b>${lv.into} / ${lv.needed}</b></div>
      <div class="kv"><span>Credits</span><b>${Math.floor(p.credits)}</b></div>
      <div class="kv"><span>Highest level</span><b>${p.stats.bestWave}</b></div>
    </div>`;
  }

  private mainHtml(): string {
    return `<div class="screen dim"><div class="menu-layout">
      <div class="menu-col">
        <div class="menu-head"><div class="wordmark">AEROVANT</div><div class="sub">Command deck</div></div>
        <button class="mbtn primary" data-action="nav" data-to="play">PLAY <small>Endless Skies · Training</small></button>
        <button class="mbtn" data-action="nav" data-to="hangar">HANGAR <small>Aircraft & loadout</small></button>
        <button class="mbtn" data-action="nav" data-to="profile">PROFILE <small>Records</small></button>
        <button class="mbtn" data-action="nav" data-to="settings">SETTINGS <small>Audio · Visual · Controls</small></button>
      </div>
      ${this.playerCard()}
    </div></div>`;
  }

  private playHtml(): string {
    const done = this.save.data.profile.tutorialDone;
    return `<div class="screen dim"><div class="center-wrap"><div class="panel wide">
      <h2>Select operation</h2>
      <div class="cards">
        <button class="card" data-action="start" data-tutorial="${done ? '0' : '1'}">
          <span class="tag ok">OFFLINE</span>
          <h3>ENDLESS SKIES</h3>
          <p>Level 1 sends one opponent, level 2 sends two, and so on. They start easy and get sharper every level. Three lives. How far can you go?</p>
        </button>
        <button class="card" data-action="start" data-tutorial="1">
          <span class="tag ok">OFFLINE</span>
          <h3>TRAINING FLIGHT</h3>
          <p>Endless Skies with step-by-step prompts: flying, cannons, lock-on, missiles, afterburner, flares, abilities.</p>
        </button>
        <button class="card" disabled>
          <span class="tag hot">ONLINE · IN DEVELOPMENT</span>
          <h3>SKY DUEL</h3>
          <p>2–8 pilot free-for-all on dedicated servers. Arrives with the multiplayer milestone.</p>
        </button>
        <button class="card" disabled>
          <span class="tag hot">ONLINE · PLANNED</span>
          <h3>TEAM BATTLE</h3>
          <p>Blue vs Orange squadrons, 4v4. Private rooms and invites to follow.</p>
        </button>
      </div>
      <div class="btn-row"><button class="mbtn" data-action="back">BACK</button></div>
    </div></div></div>`;
  }

  private bestLevel(): number {
    return this.save.data.profile.stats.bestWave;
  }

  private hangarHtml(): string {
    const prof = this.save.data.profile;
    const best = this.bestLevel();
    if (!this.hangarSel) this.hangarSel = prof.favoriteAircraft;
    const def = AIRCRAFT[this.hangarSel] ?? AIRCRAFT.viper;
    const unlocked = isUnlocked(def.id, best);
    const equipped = prof.favoriteAircraft === def.id;
    const gun = GUNS[def.gun];
    const msl = MISSILES[def.missile];
    const ab = ABILITIES[def.ability];
    const stat = (label: string, v: number, max: number, shown: string | number) =>
      `<div class="stat"><span>${label}</span><div class="b"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div><span>${shown}</span></div>`;
    const list = PLAYER_AIRCRAFT.map((id) => {
      const a = AIRCRAFT[id];
      const open = isUnlocked(id, best);
      const tag = prof.favoriteAircraft === id ? '<span class="tag ok">EQUIPPED</span>'
        : open ? '' : `<span class="tag">LEVEL ${a.unlockLevel}</span>`;
      return `<button class="ac-item ${id === def.id ? 'sel' : ''} ${open ? '' : 'locked'}" data-action="hangar-select" data-id="${id}">
        <div class="ac-name">${open ? '' : LOCK_ICON}${a.name} ${tag}</div>
        <div class="cls">${a.className}</div></button>`;
    }).join('');
    const status = unlocked
      ? equipped
        ? '<span class="tag ok">EQUIPPED</span>'
        : `<button class="mbtn primary equip" data-action="equip" data-id="${def.id}">EQUIP</button>`
      : '';
    const lockNote = unlocked ? '' : `<div class="lock-note">
        <b>Locked.</b> Reach <b>level ${def.unlockLevel}</b> in Endless Skies to unlock the ${def.name}.
        Level ${def.unlockLevel} means surviving until ${def.unlockLevel} opponents come at you at once.
        <span>Your best so far: level ${Math.max(0, best)}.</span></div>`;
    return `<div class="screen dim"><div class="center-wrap"><div class="panel wide">
      <h2>Hangar</h2>
      <div class="hangar">
        <div class="ac-list">${list}</div>
        <div>
          <div class="preview-wrap ${unlocked ? '' : 'is-locked'}"><canvas class="preview" id="preview"></canvas></div>
          <div class="hangar-title">
            <div><div style="font-size:24px;font-weight:800">${def.name}</div><div class="cls" style="color:var(--dim);letter-spacing:.14em;font-size:12px">${def.className.toUpperCase()}</div></div>
            ${status}
          </div>
          ${lockNote}
          <p style="color:var(--dim);margin:0 0 12px;font-size:14px">${def.description}</p>
          ${stat('TOP SPEED', def.boostSpeed, STAT_SCALE.boost, def.boostSpeed)}
          ${stat('CRUISE', def.cruiseSpeed, STAT_SCALE.cruise, def.cruiseSpeed)}
          ${stat('TURN RATE', def.turnRate, STAT_SCALE.turn, def.turnRate.toFixed(1))}
          ${stat('HULL', def.health, STAT_SCALE.hull, def.health)}
          ${stat('CANNON DPS', gun.damage / gun.fireInterval, STAT_SCALE.dps, Math.round(gun.damage / gun.fireInterval))}
          ${stat('MISSILES', def.missileCapacity, STAT_SCALE.missiles, def.missileCapacity)}
          ${stat('LOCK RANGE', def.lockRange, STAT_SCALE.lock, def.lockRange)}
          <div class="kv" style="margin-top:10px"><span>Primary</span><b>${gun.name}</b></div>
          <div class="kv"><span>Secondary</span><b>${msl.name} ×${def.missileCapacity}</b></div>
          <div class="kv"><span>Countermeasure</span><b>Decoy flares ×${def.flareCharges}</b></div>
          <div class="kv"><span>Ability</span><b>${ab.name}: ${ab.description}</b></div>
        </div>
      </div>
      <div class="btn-row"><button class="mbtn" data-action="back">BACK</button></div>
    </div></div></div>`;
  }

  private profileHtml(): string {
    const p = this.save.data.profile;
    const s = p.stats;
    const lv = levelFromXp(p.xp);
    const hrs = Math.floor(s.playTimeSec / 3600);
    const mins = Math.floor((s.playTimeSec % 3600) / 60);
    return `<div class="screen dim"><div class="center-wrap"><div class="panel wide" style="max-width:560px">
      <h2>Pilot profile</h2>
      <div style="font-size:28px;font-weight:800">${esc(p.callsign)}</div>
      <div class="lvl" style="color:var(--accent-2);font-weight:700;letter-spacing:.14em">RANK ${lv.level}</div>
      <div class="xpbar"><i style="width:${(lv.into / lv.needed) * 100}%"></i></div>
      <div class="kv"><span>Favourite aircraft</span><b>${AIRCRAFT[p.favoriteAircraft]?.name ?? 'VX-7 Viper'}</b></div>
      <div class="kv"><span>Matches played</span><b>${s.matches}</b></div>
      <div class="kv"><span>Eliminations</span><b>${s.kills}</b></div>
      <div class="kv"><span>Assists</span><b>${s.assists}</b></div>
      <div class="kv"><span>Times shot down</span><b>${s.deaths}</b></div>
      <div class="kv"><span>Highest level</span><b>${s.bestWave}</b></div>
      <div class="kv"><span>Best score</span><b>${s.bestScore}</b></div>
      <div class="kv"><span>Best streak</span><b>${s.bestStreak}</b></div>
      <div class="kv"><span>Total flight time</span><b>${hrs}h ${mins}m</b></div>
      <div class="kv"><span>Credits</span><b>${Math.floor(p.credits)}</b></div>
      <div class="btn-row"><button class="mbtn" data-action="back">BACK</button></div>
    </div></div></div>`;
  }

  private settingsHtml(): string {
    const s = this.save.data.settings;
    const tab = this.settingsTab;
    const slider = (key: string, label: string, v: number, min: number, max: number, step: number, fmt: (v: number) => string, hint = '') =>
      `<div class="row"><label for="s-${key}">${label}</label><input id="s-${key}" type="range" data-setting="${key}" min="${min}" max="${max}" step="${step}" value="${v}"><span class="val">${fmt(v)}</span>${hint ? `<div class="hint">${hint}</div>` : ''}</div>`;
    const toggle = (key: string, label: string, v: boolean) =>
      `<div class="row"><label for="s-${key}">${label}</label><span><input id="s-${key}" type="checkbox" data-setting="${key}" ${v ? 'checked' : ''}></span><span></span></div>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    let body = '';
    if (tab === 'audio') {
      body = slider('masterVolume', 'Master volume', s.masterVolume, 0, 1, 0.05, pct) +
        slider('musicVolume', 'Music', s.musicVolume, 0, 1, 0.05, pct) +
        slider('sfxVolume', 'Sound effects', s.sfxVolume, 0, 1, 0.05, pct);
    } else if (tab === 'visual') {
      body = slider('screenShake', 'Screen shake', s.screenShake, 0, 1, 0.1, pct, 'Set to 0% to disable camera shake entirely.') +
        slider('effects', 'Effects density', s.effects, 0.35, 1, 0.05, pct, 'Lower values reduce particles for clarity or performance.') +
        slider('hudScale', 'HUD / text scale', s.hudScale, 0.8, 1.4, 0.05, pct) +
        toggle('showMinimap', 'Show radar minimap', s.showMinimap) +
        toggle('showFps', 'Show FPS', s.showFps);
    } else if (tab === 'controls') {
      body = ACTIONS.map((a) => `<div class="row"><span>${ACTION_LABELS[a]}</span><span>${
        s.bindings[a].map((code, i) => `<button class="keycap" data-action="rebind" data-bind="${a}" data-slot="${i}">${keyLabel(code)}</button>`).join('')
      }</span><span></span></div>`).join('') +
        `<div class="row"><span>Gamepad</span><span style="color:var(--dim);font-size:13px">Stick left/right turn, up/down throttle · RT/A fire · X missile · B/LB flares · RB boost · LT brake · Y ability</span><span></span></div>` +
        `<div class="btn-row"><button class="mbtn" data-action="reset-bindings">RESET TO DEFAULTS</button></div>`;
    } else if (tab === 'gameplay') {
      body = `<div class="row"><label for="s-callsign">Callsign</label><input id="s-callsign" type="text" maxlength="16" data-setting="callsign" value="${esc(this.save.data.profile.callsign)}"><span></span></div>` +
        slider('sensitivity', 'Steering sensitivity', s.sensitivity, 0.5, 1.5, 0.05, pct, 'Reserved for analog steering curves.') +
        `<div class="row"><span>Replay tutorial prompts</span><span><button class="keycap" data-action="reset-tutorial">RESET</button></span><span></span></div>`;
    } else {
      body = `<div class="row"><span>Region</span><span style="color:var(--dim)">Automatic (lowest ping)</span><span></span></div>
        <div class="row"><span>Show ping</span><span style="color:var(--dim)">When online play is available</span><span></span></div>
        <p style="color:var(--dim);font-size:13px">Online multiplayer is in development. Network options will appear here.</p>`;
    }
    const tabs = [['audio', 'AUDIO'], ['visual', 'VISUAL'], ['controls', 'CONTROLS'], ['gameplay', 'GAMEPLAY'], ['network', 'NETWORK']]
      .map(([id, l]) => `<button class="${tab === id ? 'on' : ''}" data-action="tab" data-tab="${id}">${l}</button>`).join('');
    return `<div class="screen dim"><div class="center-wrap"><div class="panel wide" style="max-width:720px">
      <h2>Settings</h2>
      <div class="tabs">${tabs}</div>
      ${body}
      <div class="btn-row"><button class="mbtn" data-action="back">BACK</button></div>
    </div></div></div>`;
  }

  private pauseHtml(): string {
    const i = this.input;
    const ref = (['fire', 'missile', 'flare', 'boost', 'brake', 'ability'] as Action[])
      .map((a) => `<div><span>${ACTION_LABELS[a]}</span><b>${esc(i.labels(a))}</b></div>`).join('');
    return `<div class="screen dim"><div class="menu-layout">
      <div class="menu-col">
        <div class="menu-head"><div class="wordmark" style="font-size:34px">PAUSED</div></div>
        <button class="mbtn primary" data-action="resume" autofocus>RESUME</button>
        <button class="mbtn" data-action="nav" data-to="settings">SETTINGS</button>
        <button class="mbtn" data-action="restart">RESTART</button>
        <button class="mbtn" data-action="quit">QUIT TO MENU</button>
      </div>
      <div class="panel side" style="width:380px"><h2>Controls</h2><div class="controls-ref" style="grid-template-columns:1fr">
        <div><span>Turn</span><b>${esc(i.labels('left'))} · ${esc(i.labels('right'))}</b></div>
        <div><span>Throttle</span><b>${esc(i.labels('up'))} · ${esc(i.labels('down'))}</b></div>${ref}
      </div></div>
    </div></div>`;
  }

  private resultsHtml(): string {
    const r = this.resultsData!;
    const box = (n: string | number, l: string, i: number) => `<div class="stat-box" style="animation-delay:${i * 50}ms"><div class="n">${n}</div><div class="l">${l}</div></div>`;
    const mm = Math.floor(r.timeSurvived / 60);
    const ss = String(Math.floor(r.timeSurvived % 60)).padStart(2, '0');
    const before = levelFromXp(r.xpBefore);
    const after = levelFromXp(r.xpAfter);
    return `<div class="screen dim"><div class="center-wrap"><div class="panel wide results" style="max-width:820px">
      <h1>${esc(r.title)}</h1>
      <div class="sub">${esc(r.subtitle)} ${r.newBest ? '<span class="newbest">· NEW PERSONAL BEST</span>' : ''}</div>
      <div class="results-grid">
        ${box(r.score, 'Score', 0)}${box(r.wave, 'Level reached', 1)}${box(r.kills, 'Eliminations', 2)}${box(r.assists, 'Assists', 3)}
        ${box(r.deaths, 'Shot down', 4)}${box(Math.round(r.damageDealt), 'Damage dealt', 5)}${box(Math.round(r.damageTaken), 'Damage taken', 6)}${box(`${mm}:${ss}`, 'Time survived', 7)}
      </div>
      ${r.unlocked.length ? `<div class="unlock-banner">New aircraft unlocked: <b>${r.unlocked.map(esc).join(', ')}</b>. Equip it in the Hangar.</div>` : ''}
      <div class="kv"><span>Cannon accuracy</span><b>${Math.round(r.accuracy * 100)}%</b></div>
      <div class="kv"><span>Best streak</span><b>${r.bestStreak}</b></div>
      <div class="reward" style="margin-top:16px">
        <div><div class="big">+${r.xpGained} XP</div><div class="l" style="color:var(--dim);font-size:12px">${after.level > before.level ? `RANK UP → ${after.level}` : `RANK ${after.level}`}</div></div>
        <div><div class="big">+${r.creditsGained}</div><div class="l" style="color:var(--dim);font-size:12px">CREDITS</div></div>
        <div style="flex:1"><div class="xpbar"><i id="res-xp" style="width:${after.level > before.level ? 0 : (before.into / before.needed) * 100}%" data-to="${(after.into / after.needed) * 100}"></i></div></div>
      </div>
      <div class="btn-row">
        <button class="mbtn primary" data-action="restart" autofocus>PLAY AGAIN</button>
        <button class="mbtn" data-action="quit">MAIN MENU</button>
      </div>
    </div></div></div>`;
  }

  private errorHtml(): string {
    return `<div class="screen dim"><div class="center-wrap"><div class="panel error-box">
      <h2>Something went wrong</h2>
      <p>${esc(this.errorText)}</p>
      <p>Your progress has been saved. You can return to the menu and continue playing.</p>
      <div class="btn-row"><button class="mbtn primary" data-action="quit" autofocus>RETURN TO MENU</button></div>
    </div></div></div>`;
  }

  // ------------------------------------------------------------------ events

  private onClick(e: MouseEvent): void {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || (el as HTMLButtonElement).disabled) return;
    if (performance.now() < this.guardUntil) return;
    const a = el.dataset.action!;
    switch (a) {
      case 'title-continue':
        this.audio.play('uiSelect');
        this.show('main');
        break;
      case 'nav':
        this.audio.play('uiSelect');
        this.show(el.dataset.to as ScreenId);
        break;
      case 'back':
        this.back();
        break;
      case 'start':
        this.audio.play('uiSelect');
        this.onAction({ type: 'start', tutorial: el.dataset.tutorial === '1' });
        break;
      case 'resume':
      case 'restart':
      case 'quit':
        this.audio.play('uiSelect');
        this.onAction({ type: a });
        break;
      case 'tab':
        this.settingsTab = el.dataset.tab!;
        this.show('settings', false);
        this.root.querySelector<HTMLElement>(`[data-tab="${this.settingsTab}"]`)?.focus();
        break;
      case 'rebind': {
        const action = el.dataset.bind as Action;
        const slot = Number(el.dataset.slot);
        el.classList.add('listening');
        el.textContent = 'press key…';
        this.input.captureNext = (code) => {
          if (code !== 'Escape') {
            const b = this.save.data.settings.bindings;
            // A key can only drive one action: remove it from others first.
            for (const other of ACTIONS) b[other] = b[other].filter((c, i) => !(c === code && !(other === action && i === slot)));
            for (const other of ACTIONS) if (b[other].length === 0) b[other] = [...DEFAULT_BINDINGS[other]].filter((c) => c !== code).slice(0, 1);
            b[action][slot] = code;
            this.save.save();
            this.input.setBindings(b);
            this.onAction({ type: 'settingsChanged' });
          }
          this.show('settings', false);
          this.root.querySelector<HTMLElement>(`[data-bind="${action}"][data-slot="${slot}"]`)?.focus();
        };
        break;
      }
      case 'reset-bindings':
        this.save.data.settings.bindings = structuredClone(DEFAULT_BINDINGS);
        this.save.save();
        this.input.setBindings(this.save.data.settings.bindings);
        this.show('settings', false);
        break;
      case 'hangar-select':
        this.audio.play('uiMove');
        this.hangarSel = el.dataset.id!;
        this.show('hangar', false);
        this.root.querySelector<HTMLElement>(`[data-action="hangar-select"][data-id="${this.hangarSel}"]`)?.focus();
        break;
      case 'equip': {
        const id = el.dataset.id!;
        if (isUnlocked(id, this.bestLevel())) {
          this.save.data.profile.favoriteAircraft = id;
          this.save.save();
          this.audio.play('uiSelect');
          this.show('hangar', false);
          this.toast(`${AIRCRAFT[id].name} equipped.`);
        }
        break;
      }
      case 'reset-tutorial':
        this.save.data.profile.tutorialDone = false;
        this.save.save();
        this.toast('Tutorial prompts will show in your next match.');
        break;
    }
  }

  private onInput(e: Event): void {
    const el = e.target as HTMLInputElement;
    const key = el.dataset.setting;
    if (!key) return;
    const s = this.save.data.settings as unknown as Record<string, unknown>;
    if (key === 'callsign') {
      const v = el.value.trim().slice(0, 16);
      if (v) this.save.data.profile.callsign = v;
    } else if (el.type === 'checkbox') {
      s[key] = el.checked;
    } else {
      s[key] = Number(el.value);
      const val = el.parentElement?.querySelector('.val');
      if (val) val.textContent = `${Math.round(Number(el.value) * 100)}%`;
    }
    this.save.save();
    this.onAction({ type: 'settingsChanged' });
  }

  private animateResults(): void {
    requestAnimationFrame(() => {
      const bar = document.getElementById('res-xp');
      if (bar) setTimeout(() => (bar.style.width = `${bar.dataset.to}%`), 250);
    });
  }

  private startPreview(): void {
    const canvas = document.getElementById('preview') as HTMLCanvasElement | null;
    if (!canvas) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = (now - t0) / 1000;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.translate(canvas.width / 2, canvas.height / 2 + Math.sin(t * 1.3) * 6 * dpr);
      const s = Math.min(canvas.width / 110, canvas.height / 60);
      ctx.scale(s, s);
      ctx.rotate(Math.sin(t * 0.7) * 0.08);
      // Slow barrel roll shows the airframe from both sides.
      const roll = Math.cos(t * 0.9);
      const art = (AIRCRAFT[this.hangarSel] ?? AIRCRAFT.viper).art;
      drawExhaust(ctx, art, PALETTES.blue, 1, Math.sin(t * 0.5) > 0.3, t, false);
      drawAirframe(ctx, art, PALETTES.blue, { roll, flash: 0, missiles: true, damage: 0 });
      this.previewRaf = requestAnimationFrame(frame);
    };
    this.previewRaf = requestAnimationFrame(frame);
  }
}
