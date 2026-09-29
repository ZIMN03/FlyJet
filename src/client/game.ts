import { AudioEngine } from './audio/audio';
import { MusicDirector } from './audio/music';
import { DebugTools } from './debug';
import { InputManager } from './input/input';
import { FxDirector } from './render/fx';
import type { HudView } from './render/hud';
import { Renderer } from './render/renderer';
import { SaveStore } from './save/save';
import { AIRCRAFT, PLAYER_AIRCRAFT, isUnlocked } from '../sim/config/aircraft';
import { AttractSession, WaveSession, type MatchSession } from './session';
import { TutorialTracker } from './tutorial';
import { RewardLedger } from './rewards';
import { UI, type ResultsData, type UiAction } from './ui/ui';

type AppState = 'menu' | 'match' | 'results';

const PLAYER_LIVES = 3;
/** Music intensity targets. */
const MUSIC = { menu: 0.15, calm: 0.4, combat: 0.9 };
const COMBAT_MUSIC_RANGE = 1800;

/**
 * Top-level application: owns every subsystem, the main loop and the
 * menu <-> match state machine. Errors inside a frame are caught and shown
 * as a recoverable error screen instead of freezing the game.
 */
export class Game {
  private readonly save = new SaveStore();
  private readonly audio = new AudioEngine();
  private readonly music = new MusicDirector(this.audio);
  private readonly input: InputManager;
  private readonly renderer: Renderer;
  private readonly fx: FxDirector;
  private readonly ui: UI;
  private readonly debug = new DebugTools();
  private state: AppState = 'menu';
  private session: MatchSession | null = null;
  private attract: AttractSession;
  private tutorial = new TutorialTracker(false);
  private tutorialRequested = false;
  private lastTime = 0;
  private time = 0;
  private matchTime = 0;
  private resultsShown = false;
  private tip = '';
  private readonly flareBtn: HTMLButtonElement;
  private flareBtnState = '';
  /** Aircraft unlocked during the current match (shown on the results screen). */
  private unlockedThisMatch: string[] = [];
  /** Itemised XP/credit rewards for the current match. */
  private ledger: RewardLedger | null = null;

  constructor(canvas: HTMLCanvasElement, uiRoot: HTMLElement) {
    this.input = new InputManager(this.save.data.settings.bindings);
    this.renderer = new Renderer(canvas);
    this.fx = new FxDirector(this.renderer.particles, this.renderer.cam, this.audio, this.renderer.hud);
    this.fx.onSlowmo = (d, s) => this.session?.slowmo(d, s);
    this.ui = new UI(uiRoot, this.save, this.audio, this.input, (a) => this.onUiAction(a));
    this.attract = new AttractSession();
    this.flareBtn = this.createFlareButton();
    this.applySettings();

    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('keydown', (e) => {
      if (e.code.startsWith('F') && e.code.length <= 3 && this.debug.enabled) {
        if (this.debug.handleKey(e.code, this.session, () => this.restart(), (s) => this.ui.toast(s))) {
          e.preventDefault();
          // Debug actions mutate the world between ticks; deliver their events now,
          // otherwise the next step() would clear them before FX/HUD see them.
          const w = this.session?.world;
          if (w && w.events.length) {
            this.fx.handle(w, w.events);
            w.events.length = 0;
          }
        }
      }
    });
    // Audio can only start after a user gesture.
    const unlock = () => {
      this.audio.unlock();
      this.applySettings();
      this.music.start();
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.input.onAnyPress = () => {
      if (this.ui.current === 'title') {
        unlock();
        this.audio.play('uiSelect');
        this.ui.show('main');
      }
    };
    window.addEventListener('beforeunload', () => this.save.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'match' && this.session && !this.session.paused) this.pause();
    });

    this.ui.show('title');
    if (this.save.recovered) this.ui.toast('Save data was corrupted and has been reset. A backup was kept.');
    requestAnimationFrame((t) => this.frame(t));
  }

  /** On-screen FLARES button (mouse or touch), mirroring the flare key. */
  private createFlareButton(): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'flare-btn';
    b.type = 'button';
    b.tabIndex = -1; // never takes keyboard focus, so Space/Enter can't trigger it
    b.hidden = true;
    b.setAttribute('aria-label', 'Deploy flares');
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.audio.unlock();
      this.input.virtualPress('flare');
      b.classList.remove('pop');
      void b.offsetWidth;
      b.classList.add('pop');
    });
    document.body.appendChild(b);
    return b;
  }

  private updateFlareButton(): void {
    const s = this.session;
    const me = s?.local();
    const show = this.state === 'match' && !!s && !s.paused && !this.ui.visible;
    const charges = me && me.alive ? me.flareCharges : 0;
    const max = me ? me.def.flareCharges : 0;
    const key = `${show}|${charges}|${max}|${me?.alive}|${this.input.label('flare')}`;
    if (key === this.flareBtnState) return;
    this.flareBtnState = key;
    this.flareBtn.hidden = !show;
    this.flareBtn.disabled = charges <= 0;
    const pips = Array.from({ length: max }, (_, i) => `<i class="${i < charges ? 'on' : ''}"></i>`).join('');
    this.flareBtn.innerHTML = `<span class="label">FLARES</span><span class="pips">${pips}</span><span class="key">${this.input.label('flare')}</span>`;
  }

  private applySettings(): void {
    const s = this.save.data.settings;
    this.audio.setVolumes(s.masterVolume, s.musicVolume, s.sfxVolume);
    this.renderer.cam.shakeScale = s.screenShake;
    this.renderer.particles.density = s.effects;
  }

  private onUiAction(a: UiAction): void {
    switch (a.type) {
      case 'start':
        this.tutorialRequested = a.tutorial;
        this.startMatch();
        break;
      case 'resume':
        this.resume();
        break;
      case 'restart':
        this.restart();
        break;
      case 'quit':
        this.quitToMenu();
        break;
      case 'settingsChanged':
        this.applySettings();
        break;
      case 'enteredMenu':
        this.music.target = MUSIC.menu;
        break;
    }
  }

  private startMatch(): void {
    const p = this.save.data.profile;
    // Fly the equipped aircraft if it is unlocked; otherwise fall back to the Viper.
    const aircraft = isUnlocked(p.favoriteAircraft, p.stats.bestWave) ? p.favoriteAircraft : 'viper';
    this.session = new WaveSession({
      aircraft, callsign: p.callsign, lives: PLAYER_LIVES, upgrades: p.upgrades[aircraft] ?? {},
    });
    this.fx.playerPaint = p.paint;
    this.ledger = new RewardLedger(this.session.localId);
    this.unlockedThisMatch = [];
    this.fx.reset();
    this.fx.localId = this.session.localId;
    this.renderer.hud.reset();
    const me = this.session.local()!;
    this.renderer.cam.snap(me.x, me.y);
    this.tutorial = new TutorialTracker(this.tutorialRequested || !p.tutorialDone);
    const tips = this.session.world.map.tips;
    this.tip = tips[Math.floor(Math.random() * tips.length)];
    this.state = 'match';
    this.matchTime = 0;
    this.resultsShown = false;
    this.input.clearPressed();
    this.ui.hide();
  }

  private restart(): void {
    if (this.state === 'menu' && !this.session) return;
    this.startMatch();
  }

  private pause(): void {
    if (!this.session || this.state !== 'match') return;
    this.session.paused = true;
    this.audio.quiet();
    this.ui.show('pause');
  }

  private resume(): void {
    if (!this.session) return;
    this.session.paused = false;
    this.input.clearPressed();
    this.ui.hide();
  }

  private quitToMenu(): void {
    if (this.session && this.state === 'match' && !this.resultsShown) this.recordMatch(false);
    this.session = null;
    this.state = 'menu';
    this.audio.quiet();
    this.fx.reset();
    this.renderer.hud.reset();
    this.fx.localId = this.attract.localId;
    this.ui.hide();
    this.ui.show('main');
  }

  /** Award progression and update lifetime stats. Returns the results screen data. */
  private recordMatch(completed: boolean): ResultsData {
    const s = this.session!;
    const me = s.local()!;
    const st = me.stats;
    const wave = s.mode?.wave ?? 0;
    const prof = this.save.data.profile;
    const xpBefore = prof.xp;
    // Itemised rewards from what actually happened (offline: computed locally;
    // online: the server will compute the same ledger from its own events).
    const survived = s.mode?.survivalTime ?? this.matchTime;
    const ledger = this.ledger ?? new RewardLedger(me.id);
    const rewardLines = ledger.lines(survived);
    const { xp: xpGained, credits: creditsGained } = ledger.totals(survived);
    prof.xp += xpGained;
    prof.credits += creditsGained;
    const ps = prof.stats;
    ps.missilesEvaded += ledger.missilesEvaded;
    ps.bossesDefeated += ledger.bossesDefeated;
    ps.levelsCompleted += ledger.levelsCompleted;
    const newBest = st.score > ps.bestScore;
    ps.matches++;
    ps.kills += st.kills;
    ps.deaths += st.deaths;
    ps.assists += st.assists;
    ps.bestWave = Math.max(ps.bestWave, wave);
    ps.bestScore = Math.max(ps.bestScore, st.score);
    ps.bestStreak = Math.max(ps.bestStreak, st.bestStreak);
    ps.playTimeSec += this.matchTime;
    if (this.tutorial.finished) prof.tutorialDone = true;
    this.save.save();
    return {
      title: completed ? 'MISSION REPORT' : 'SORTIE ABORTED',
      subtitle: `Endless Skies · Azure Coast · Level ${wave}`,
      score: st.score,
      wave,
      kills: st.kills,
      deaths: st.deaths,
      assists: st.assists,
      damageDealt: st.damageDealt,
      damageTaken: st.damageTaken,
      accuracy: st.shotsFired > 0 ? st.shotsHit / st.shotsFired : 0,
      bestStreak: st.bestStreak,
      timeSurvived: s.mode?.survivalTime ?? this.matchTime,
      xpGained,
      creditsGained,
      xpBefore,
      xpAfter: prof.xp,
      newBest,
      unlocked: this.unlockedThisMatch.slice(),
      rewards: rewardLines,
      creditsTotal: prof.credits,
    };
  }

  private frame(ts: number): void {
    const t0 = performance.now();
    const dt = this.lastTime ? Math.min(0.1, (ts - this.lastTime) / 1000) : 1 / 60;
    this.lastTime = ts;
    try {
      this.step(dt);
    } catch (err) {
      console.error(err);
      this.recoverFromError(err);
    }
    this.debug.tickFps(dt, performance.now() - t0);
    requestAnimationFrame((t) => this.frame(t));
  }

  private recoverFromError(err: unknown): void {
    this.session = null;
    this.state = 'menu';
    this.audio.quiet();
    try {
      this.fx.reset();
      this.renderer.hud.reset();
    } catch { /* ignore */ }
    this.ui.showError(err instanceof Error ? err.message : String(err));
  }

  private step(dt: number): void {
    this.time += dt;
    this.input.pollGamepad();
    this.handleMenuInput();

    const inMatch = this.state === 'match' && this.session !== null;
    const session: MatchSession = inMatch ? this.session! : this.attract;
    this.input.captureGameplay = inMatch && !session.paused;

    if (inMatch && !session.paused && this.input.consumePressed('pause')) {
      this.pause();
      return;
    }

    const sample = inMatch ? () => this.input.sampleCommand() : null;
    this.fx.soundEnabled = inMatch;
    session.update(dt, sample, (events) => {
      this.fx.handle(session.world, events);
      if (inMatch) this.ledger?.handle(session.world, events, session.mode?.wave ?? 1);
    });
    if (!inMatch) this.fx.localId = session.localId;
    const paused = session.paused;
    const fdt = paused ? 0 : dt;

    const me = session.local();
    if (me) {
      const ax = me.px + (me.x - me.px) * session.alpha;
      const ay = me.py + (me.y - me.py) * session.alpha;
      this.renderer.cam.update(fdt, ax, ay, me.vx, me.vy, session.world.map.width, session.world.map.seaLevel);
    }
    this.audio.listenerX = this.renderer.cam.x;
    this.audio.listenerY = this.renderer.cam.y;
    if (!paused) {
      this.fx.update(session.world, fdt, session.alpha);
      this.renderer.particles.update(fdt);
      this.renderer.hud.update(fdt);
    }

    if (inMatch && !paused) {
      this.matchTime += dt;
      this.tutorial.update(dt, me, this.input);
      if (this.tutorial.finished && !this.save.data.profile.tutorialDone) {
        this.save.data.profile.tutorialDone = true;
        this.save.save();
      }
      this.updateMatchAudio(session, dt);
      this.trackLevelProgress(session);
      const mode = session.mode;
      if (mode && mode.phase === 'ended' && !this.resultsShown) {
        this.resultsShown = true;
        this.state = 'results';
        this.audio.quiet();
        this.audio.play('defeat');
        this.music.stinger(false);
        const data = this.recordMatch(true);
        this.ui.showResults(data);
      }
    } else if (!inMatch) {
      this.audio.quiet();
      this.music.target = MUSIC.menu;
    }

    const hudView: HudView | null = inMatch
      ? {
          world: session.world,
          cam: this.renderer.cam,
          local: me,
          mode: session.mode,
          alpha: session.alpha,
          time: this.time,
          showMinimap: this.save.data.settings.showMinimap,
          scale: this.save.data.settings.hudScale,
          tutorial: this.tutorial.current(me, this.input),
          tip: session.mode?.phase === 'countdown' ? this.tip : '',
          keyLabel: (a) => (a === 'throttleUp' ? '↑' : this.input.label(a)),
          debugLines: this.debug.overlay ? this.debug.lines(session, this.renderer.particles.count) : null,
          fps: this.save.data.settings.showFps ? this.debug.fps : 0,
        }
      : null;
    this.renderer.render(session.world, session.alpha, this.time, fdt, this.fx, hudView);
    this.updateFlareButton();
  }

  private updateMatchAudio(session: MatchSession, dt: number): void {
    const me = session.local();
    const alive = !!me && me.alive;
    let lock = 0;
    if (me && me.lockState === 2) lock = 1;
    if (me && me.lockState === 3) lock = 2;
    this.audio.updateLoops(
      dt,
      me ? me.speed / me.def.boostSpeed : 0,
      !!me && me.boosting,
      alive,
      lock,
      me ? me.incomingMissileDist : Infinity,
      !!me && me.lockedOn,
    );
    let combat = false;
    if (me && me.alive) {
      for (const a of session.world.aircraft) {
        if (a.alive && a.team !== me.team && Math.hypot(a.x - me.x, a.y - me.y) < COMBAT_MUSIC_RANGE) combat = true;
      }
      if (me.timeSinceDamaged < 3) combat = true;
    }
    this.music.target = combat ? MUSIC.combat : MUSIC.calm;
  }

  /**
   * Save a new highest level the moment it is reached (so an unlock is never
   * lost to a crash or quit) and announce any aircraft it unlocks.
   */
  private trackLevelProgress(session: MatchSession): void {
    const level = session.mode?.wave ?? 0;
    const stats = this.save.data.profile.stats;
    if (level <= stats.bestWave) return;
    const before = stats.bestWave;
    stats.bestWave = level;
    this.save.save();
    for (const id of PLAYER_AIRCRAFT) {
      const def = AIRCRAFT[id];
      if (def.unlockLevel > Math.max(1, before) && def.unlockLevel <= level) {
        this.unlockedThisMatch.push(def.name);
        this.renderer.hud.banner('NEW AIRCRAFT UNLOCKED', `${def.name}. Equip it in the Hangar`, 3.2, 'good');
        this.audio.play('waveClear');
      }
    }
  }

  /** Menu navigation via the input abstraction (keyboard arrows or gamepad). */
  private handleMenuInput(): void {
    if (!this.ui.visible) return;
    if (this.input.consumePressed('pause')) this.ui.back();
    if (this.input.consumePressed('up')) this.ui.moveFocus(-1);
    if (this.input.consumePressed('down')) this.ui.moveFocus(1);
    // Keyboard activates via native Enter/Space; gamepad A needs help.
    if (this.input.consumePressed('fire') && this.input.lastDevice === 'gamepad') this.ui.activateFocused();
    this.input.consumePressed('left');
    this.input.consumePressed('right');
  }
}
