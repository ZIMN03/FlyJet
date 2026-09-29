/**
 * Fully synthesized audio (no sample files): one-shot SFX, a continuous engine
 * voice that follows speed/afterburner, lock/warning tone loops and spatial
 * attenuation/panning relative to the camera.
 */

export type Sfx =
  | 'gun' | 'gunEnemy' | 'hitConfirm' | 'hitCrit' | 'hurt' | 'missileLaunch' | 'explosionSmall'
  | 'explosionBig' | 'flare' | 'lockOn' | 'ability' | 'splash' | 'crash' | 'spawn'
  | 'uiMove' | 'uiSelect' | 'uiBack' | 'countdown' | 'go' | 'waveStart' | 'waveClear' | 'kill' | 'defeat';

/** Distance (world units) at which spatial sounds fade out completely. */
const HEARING_RANGE = 2600;
const PAN_RANGE = 1300;
/** Per-sound minimum spacing (s) — stops gunfire stacking into noise. */
const RATE_LIMIT: Partial<Record<Sfx, number>> = { gun: 0.05, gunEnemy: 0.07, hitConfirm: 0.04, hurt: 0.08, flare: 0.1 };

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfxBus!: GainNode;
  musicBus!: GainNode;
  private noise!: AudioBuffer;
  private lastPlayed = new Map<string, number>();
  listenerX = 0;
  listenerY = 0;
  private volumes = { master: 0.8, music: 0.5, sfx: 0.8 };

  // Continuous voices.
  private engineOsc: OscillatorNode | null = null;
  private engineOsc2: OscillatorNode | null = null;
  private engineFilter!: BiquadFilterNode;
  private engineGain!: GainNode;
  private burnerGain!: GainNode;
  private burnerFilter!: BiquadFilterNode;
  private lockGain!: GainNode;
  private lockOsc: OscillatorNode | null = null;
  private lockBeepTimer = 0;
  private warnTimer = 0;
  private warnHigh = false;

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const c = this.ctx;
    this.master = c.createGain();
    this.master.connect(c.destination);
    // Gentle compression glues the mix and prevents clipping in big fights.
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.connect(this.master);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(comp);
    this.musicBus = c.createGain();
    this.musicBus.connect(comp);
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.applyVolumes();
    this.buildContinuousVoices();
  }

  setVolumes(master: number, music: number, sfx: number): void {
    this.volumes = { master, music, sfx };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.volumes.master, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.volumes.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.volumes.sfx, t, 0.05);
  }

  private buildContinuousVoices(): void {
    const c = this.ctx!;
    this.engineGain = c.createGain();
    this.engineGain.gain.value = 0;
    this.engineFilter = c.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 500;
    this.engineFilter.connect(this.engineGain);
    this.engineGain.connect(this.sfxBus);
    this.engineOsc = c.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 70;
    this.engineOsc.connect(this.engineFilter);
    this.engineOsc.start();
    this.engineOsc2 = c.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.value = 141;
    this.engineOsc2.connect(this.engineFilter);
    this.engineOsc2.start();

    // Afterburner roar: looping filtered noise.
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    this.burnerFilter = c.createBiquadFilter();
    this.burnerFilter.type = 'bandpass';
    this.burnerFilter.frequency.value = 700;
    this.burnerFilter.Q.value = 0.7;
    this.burnerGain = c.createGain();
    this.burnerGain.gain.value = 0;
    src.connect(this.burnerFilter).connect(this.burnerGain).connect(this.sfxBus);
    src.start();

    this.lockGain = c.createGain();
    this.lockGain.gain.value = 0;
    this.lockGain.connect(this.sfxBus);
    this.lockOsc = c.createOscillator();
    this.lockOsc.type = 'square';
    this.lockOsc.frequency.value = 1320;
    const lf = c.createBiquadFilter();
    lf.type = 'lowpass';
    lf.frequency.value = 2500;
    this.lockOsc.connect(lf).connect(this.lockGain);
    this.lockOsc.start();
  }

  /**
   * Per-frame update of continuous voices.
   * @param speedFrac 0..1+ normalized speed of the local aircraft (0 = silent)
   * @param lock 0 none, 1 locking, 2 locked
   * @param warnDist distance of the nearest incoming missile (Infinity = none)
   * @param lockedOnUs someone has a lock on the player
   */
  updateLoops(dt: number, speedFrac: number, boosting: boolean, alive: boolean, lock: number, warnDist: number, lockedOnUs: boolean): void {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const on = alive ? 1 : 0;
    this.engineOsc.frequency.setTargetAtTime(52 + speedFrac * 58 + (boosting ? 18 : 0), t, 0.12);
    this.engineOsc2!.frequency.setTargetAtTime(105 + speedFrac * 118 + (boosting ? 40 : 0), t, 0.12);
    this.engineFilter.frequency.setTargetAtTime(280 + speedFrac * 700 + (boosting ? 900 : 0), t, 0.15);
    this.engineGain.gain.setTargetAtTime(on * (0.07 + speedFrac * 0.05), t, 0.1);
    this.burnerGain.gain.setTargetAtTime(on * (boosting ? 0.32 : 0.025), t, boosting ? 0.06 : 0.25);
    this.burnerFilter.frequency.setTargetAtTime(boosting ? 1300 : 600, t, 0.2);

    // Lock tone: intermittent beeps while locking, solid tone when locked.
    this.lockBeepTimer -= dt;
    let lockLevel = 0;
    if (alive && lock === 2) lockLevel = 0.05;
    else if (alive && lock === 1) {
      if (this.lockBeepTimer <= 0) this.lockBeepTimer = 0.16;
      lockLevel = this.lockBeepTimer > 0.1 ? 0.04 : 0;
      this.lockOsc!.frequency.setValueAtTime(880, t);
    }
    if (lock === 2) this.lockOsc!.frequency.setTargetAtTime(1320, t, 0.01);
    this.lockGain.gain.setTargetAtTime(lockLevel, t, 0.008);

    // Missile warning: alternating two-tone beeps that speed up as the missile closes.
    this.warnTimer -= dt;
    if (alive && warnDist < Infinity) {
      const interval = Math.max(0.07, Math.min(0.4, warnDist / 2600));
      if (this.warnTimer <= 0) {
        this.warnTimer = interval;
        this.warnHigh = !this.warnHigh;
        this.tone(this.warnHigh ? 1180 : 820, 0.06, 'triangle', 0.12);
      }
    } else if (alive && lockedOnUs && this.warnTimer <= 0) {
      this.warnTimer = 0.5;
      this.tone(620, 0.08, 'triangle', 0.07);
    }
  }

  /** Silence continuous voices (menus, pause). */
  quiet(): void {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    this.engineGain.gain.setTargetAtTime(0, t, 0.1);
    this.burnerGain.gain.setTargetAtTime(0, t, 0.1);
    this.lockGain.gain.setTargetAtTime(0, t, 0.02);
  }

  private spatial(x?: number, y?: number): { gain: number; pan: number } {
    if (x === undefined || y === undefined) return { gain: 1, pan: 0 };
    const dx = x - this.listenerX;
    const d = Math.hypot(dx, y - this.listenerY);
    const gain = Math.max(0, 1 - d / HEARING_RANGE);
    return { gain: gain * gain, pan: Math.max(-1, Math.min(1, dx / PAN_RANGE)) };
  }

  private out(gain: number, pan: number): AudioNode {
    const c = this.ctx!;
    const g = c.createGain();
    g.gain.value = gain;
    if (pan !== 0 && c.createStereoPanner) {
      const p = c.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.sfxBus);
    } else {
      g.connect(this.sfxBus);
    }
    return g;
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, freqEnd?: number, delay = 0, dest?: AudioNode): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest ?? this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private burst(dur: number, vol: number, filter: BiquadFilterType, f0: number, f1: number, q: number, dest: AudioNode, delay = 0): void {
    const c = this.ctx!;
    const t = c.currentTime + delay;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter();
    f.type = filter;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  play(name: Sfx, x?: number, y?: number, volume = 1): void {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const limit = RATE_LIMIT[name];
    if (limit) {
      const key = name + (x !== undefined ? Math.round(x / 400) : '');
      const last = this.lastPlayed.get(key) ?? -1;
      if (c.currentTime - last < limit) return;
      this.lastPlayed.set(key, c.currentTime);
    }
    const { gain, pan } = this.spatial(x, y);
    if (gain * volume < 0.01) return;
    const out = this.out(gain * volume, pan);
    switch (name) {
      case 'gun':
        this.burst(0.06, 0.5, 'bandpass', 2600, 900, 1.2, out);
        this.tone(190, 0.05, 'square', 0.12, 90, 0, out);
        break;
      case 'gunEnemy':
        this.burst(0.07, 0.45, 'bandpass', 1500, 600, 1.4, out);
        this.tone(140, 0.05, 'square', 0.1, 70, 0, out);
        break;
      case 'hitConfirm':
        this.tone(1650, 0.045, 'sine', 0.22, 1100, 0, out);
        break;
      case 'hitCrit':
        this.tone(2100, 0.07, 'square', 0.12, 1500, 0, out);
        this.tone(1400, 0.08, 'sine', 0.2, 900, 0.02, out);
        break;
      case 'hurt':
        this.burst(0.14, 0.7, 'lowpass', 900, 200, 0.8, out);
        this.tone(95, 0.12, 'sine', 0.35, 50, 0, out);
        break;
      case 'missileLaunch':
        this.burst(0.8, 0.55, 'bandpass', 500, 2400, 0.9, out);
        this.burst(0.5, 0.4, 'lowpass', 400, 120, 0.5, out);
        break;
      case 'explosionSmall':
        this.burst(0.9, 1.0, 'lowpass', 2200, 90, 0.7, out);
        this.tone(80, 0.5, 'sine', 0.55, 32, 0, out);
        break;
      case 'explosionBig':
        this.burst(1.8, 1.2, 'lowpass', 3000, 60, 0.6, out);
        this.burst(0.3, 0.8, 'highpass', 3000, 1200, 0.5, out);
        this.tone(62, 1.2, 'sine', 0.8, 24, 0, out);
        this.burst(1.2, 0.35, 'bandpass', 400, 150, 1, out, 0.25);
        break;
      case 'flare':
        for (let i = 0; i < 4; i++) this.burst(0.09, 0.4, 'highpass', 3500, 2000, 0.5, out, i * 0.06);
        this.burst(0.7, 0.18, 'highpass', 5000, 3000, 0.3, out);
        break;
      case 'lockOn':
        this.tone(1320, 0.07, 'square', 0.08, undefined, 0, out);
        this.tone(1760, 0.1, 'square', 0.08, undefined, 0.08, out);
        break;
      case 'ability':
        this.tone(220, 0.5, 'sawtooth', 0.14, 880, 0, out);
        this.tone(440, 0.4, 'square', 0.06, 1760, 0.05, out);
        break;
      case 'splash':
        this.burst(0.7, 0.6, 'highpass', 1800, 500, 0.4, out);
        break;
      case 'crash':
        this.burst(0.5, 0.9, 'lowpass', 1500, 100, 0.8, out);
        this.tone(70, 0.4, 'sine', 0.5, 35, 0, out);
        break;
      case 'spawn':
        this.tone(330, 0.5, 'sine', 0.15, 990, 0, out);
        break;
      case 'uiMove':
        this.tone(700, 0.03, 'sine', 0.09, undefined, 0, out);
        break;
      case 'uiSelect':
        this.tone(660, 0.06, 'triangle', 0.14, 990, 0, out);
        this.tone(1320, 0.08, 'sine', 0.08, undefined, 0.05, out);
        break;
      case 'uiBack':
        this.tone(660, 0.07, 'triangle', 0.12, 440, 0, out);
        break;
      case 'countdown':
        this.tone(660, 0.14, 'square', 0.1, undefined, 0, out);
        break;
      case 'go':
        this.tone(880, 0.35, 'square', 0.09, undefined, 0, out);
        this.tone(1320, 0.35, 'triangle', 0.1, undefined, 0, out);
        break;
      case 'waveStart':
        [440, 554, 659].forEach((f, i) => this.tone(f, 0.18, 'triangle', 0.12, undefined, i * 0.09, out));
        break;
      case 'waveClear':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.13, undefined, i * 0.08, out));
        break;
      case 'kill':
        this.tone(988, 0.08, 'square', 0.07, undefined, 0, out);
        this.tone(1318, 0.14, 'triangle', 0.12, undefined, 0.07, out);
        break;
      case 'defeat':
        [392, 330, 262].forEach((f, i) => this.tone(f, 0.4, 'triangle', 0.13, undefined, i * 0.22, out));
        break;
    }
  }
}
