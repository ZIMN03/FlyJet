import type { AudioEngine } from './audio';

/**
 * Original procedural electronic score. A 16-step sequencer schedules notes
 * slightly ahead of time (Web Audio clock) and layers instruments by intensity:
 *   0.0  pad only (menus)
 *   0.3+ bass + hats (patrol)
 *   0.6+ kick + arpeggio (combat)
 */

const BPM = 122;
const STEPS = 16;
const LOOKAHEAD = 0.12;
/** Chord roots (semitones from A2) for an 8-bar cycle, and whether the chord is minor. */
const PROGRESSION: [number, boolean][] = [[0, true], [0, true], [-4, false], [-4, false], [3, false], [3, false], [-2, false], [-5, false]];
const ARP_SHAPE = [0, 7, 12, 15, 12, 7, 19, 15];
const BASS_PATTERN = [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0];
const A2 = 110;

function freq(semi: number): number {
  return A2 * Math.pow(2, semi / 12);
}

export class MusicDirector {
  private step = 0;
  private bar = 0;
  private nextTime = 0;
  private timer: number | null = null;
  /** Target intensity (0..1); smoothed internally. */
  target = 0;
  private intensity = 0;
  private out: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;

  constructor(private readonly audio: AudioEngine) {}

  start(): void {
    const c = this.audio.ctx;
    if (!c || this.timer !== null) return;
    this.out = c.createGain();
    this.out.gain.value = 0.9;
    this.out.connect(this.audio.musicBus);
    this.nextTime = c.currentTime + 0.1;
    this.timer = window.setInterval(() => this.schedule(), 25);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  /** Short stinger (victory/defeat) layered over the loop. */
  stinger(win: boolean): void {
    const c = this.audio.ctx;
    if (!c || !this.out) return;
    const notes = win ? [0, 4, 7, 12, 16] : [12, 10, 7, 3, 0];
    notes.forEach((n, i) => this.pluck(c.currentTime + i * 0.12, freq(n + 24), 0.5, 0.08, 'triangle'));
  }

  private schedule(): void {
    const c = this.audio.ctx;
    if (!c || !this.out) return;
    while (this.nextTime < c.currentTime + LOOKAHEAD) {
      this.intensity += (this.target - this.intensity) * 0.02;
      this.playStep(this.nextTime);
      this.nextTime += 60 / BPM / 4;
      this.step = (this.step + 1) % STEPS;
      if (this.step === 0) this.bar = (this.bar + 1) % PROGRESSION.length;
    }
  }

  private playStep(t: number): void {
    const [root, minor] = PROGRESSION[this.bar];
    const third = minor ? 3 : 4;
    const s = this.step;
    const I = this.intensity;
    if (s === 0 && this.bar % 2 === 0) {
      // Pad chord: three detuned saws through a soft filter, two bars long.
      const dur = (60 / BPM) * 8;
      for (const n of [root + 12, root + 12 + third, root + 19]) this.pad(t, freq(n), dur, 0.035);
    }
    if (I > 0.3 && BASS_PATTERN[s]) this.bass(t, freq(root - 12 + (s === 14 ? 7 : 0)), 0.16 * Math.min(1, (I - 0.3) * 4));
    if (I > 0.3 && s % 2 === 1) this.hat(t, 0.05 * Math.min(1, (I - 0.3) * 4));
    if (I > 0.6) {
      if (s % 4 === 0) this.kick(t, 0.5 * Math.min(1, (I - 0.6) * 4));
      if (s % 8 === 4) this.snare(t, 0.18 * Math.min(1, (I - 0.6) * 4));
      const shape = ARP_SHAPE[s % ARP_SHAPE.length];
      const semi = root + 24 + (shape === 15 ? third + 12 : shape === 3 ? third : shape);
      if (s % 2 === 0) this.pluck(t, freq(semi), 0.18, 0.035 * Math.min(1, (I - 0.6) * 4), 'square');
    }
  }

  private pad(t: number, f: number, dur: number, vol: number): void {
    const c = this.audio.ctx!;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur);
    filter.connect(g).connect(this.out!);
    for (const det of [-7, 7]) {
      const o = c.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.value = det;
      o.connect(filter);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  private bass(t: number, f: number, vol: number): void {
    const c = this.audio.ctx!;
    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    const filter = c.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1200, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(filter).connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.25);
  }

  private pluck(t: number, f: number, dur: number, vol: number, type: OscillatorType): void {
    const c = this.audio.ctx!;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.value = f;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private kick(t: number, vol: number): void {
    const c = this.audio.ctx!;
    const o = c.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.12);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + 0.3);
  }

  private noiseHit(t: number, vol: number, hp: number, dur: number): void {
    const c = this.audio.ctx!;
    if (!this.noiseBuf) {
      const len = Math.floor(c.sampleRate * 0.25);
      this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = hp;
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + dur + 0.01);
  }

  private hat(t: number, vol: number): void {
    this.noiseHit(t, vol, 7000, 0.04);
  }

  private snare(t: number, vol: number): void {
    this.noiseHit(t, vol, 1500, 0.14);
  }
}
