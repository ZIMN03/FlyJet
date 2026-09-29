import { Button, emptyCommand, type InputCommand } from '../../sim/types';
import { ACTIONS, type Action } from '../save/save';

const STICK_DEADZONE = 0.22;
const TRIGGER_THRESHOLD = 0.35;

/** Standard-mapping gamepad buttons per action. */
const PAD_BINDINGS: Partial<Record<Action, number[]>> = {
  fire: [7, 0],      // RT, A
  missile: [2],      // X
  flare: [1, 4],     // B, LB
  boost: [5],        // RB
  brake: [6],        // LT
  ability: [3],      // Y
  pause: [9],        // Start
  up: [12], down: [13], left: [14], right: [15], // d-pad
};

/**
 * Input abstraction: raw keyboard/gamepad state -> logical actions -> an
 * InputCommand for the simulation. Gameplay code never looks at key codes.
 */
export class InputManager {
  private readonly keys = new Set<string>();
  private readonly pressedQueue = new Set<Action>();
  /**
   * Actions pressed since the last sampleCommand(). A tap shorter than one sim
   * tick (keydown+keyup between samples) must still register as a button press.
   */
  private readonly tapLatch = new Set<Action>();
  private readonly codeToActions = new Map<string, Action[]>();
  private padPrev = new Map<Action, boolean>();
  private readonly cmd: InputCommand = emptyCommand();
  private seq = 0;
  /** When set, the next key press is delivered here instead (for remapping). */
  captureNext: ((code: string) => void) | null = null;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';
  /**
   * True while flying: bound keys have their browser default suppressed (Space
   * scrolling etc.). In menus defaults stay intact so Enter/Space activate buttons.
   */
  captureGameplay = false;
  /** Any key/button press — used by "press any key" screens. */
  onAnyPress: (() => void) | null = null;

  constructor(private bindings: Record<Action, string[]>) {
    this.rebuild();
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', () => this.keys.clear());
  }

  setBindings(b: Record<Action, string[]>): void {
    this.bindings = b;
    this.rebuild();
  }

  private rebuild(): void {
    this.codeToActions.clear();
    for (const a of ACTIONS) {
      for (const code of this.bindings[a] ?? []) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(a);
        this.codeToActions.set(code, list);
      }
    }
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (this.captureNext) {
      e.preventDefault();
      const cb = this.captureNext;
      this.captureNext = null;
      cb(e.code);
      return;
    }
    // Typing in a text field (e.g. callsign) must never steer menus or the aircraft.
    const t = e.target;
    if (t instanceof HTMLTextAreaElement || (t instanceof HTMLInputElement && t.type === 'text')) return;
    const actions = this.codeToActions.get(e.code);
    // Stop page scrolling / browser shortcuts for bound keys while flying.
    if (actions && this.captureGameplay) e.preventDefault();
    this.lastDevice = 'keyboard';
    if (!e.repeat && actions) {
      for (const a of actions) {
        this.pressedQueue.add(a);
        this.tapLatch.add(a);
      }
    }
    this.keys.add(e.code);
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code);
    // "Any key" fires on release so the same keystroke can't also activate
    // whatever button the next screen focuses.
    this.onAnyPress?.();
  };

  private keyAction(a: Action): boolean {
    for (const code of this.bindings[a] ?? []) if (this.keys.has(code)) return true;
    return false;
  }

  private pad(): Gamepad | null {
    if (typeof navigator === 'undefined' || !navigator.getGamepads) return null;
    for (const p of navigator.getGamepads()) if (p && p.connected) return p;
    return null;
  }

  private padAction(p: Gamepad | null, a: Action): boolean {
    if (!p) return false;
    for (const i of PAD_BINDINGS[a] ?? []) {
      const b = p.buttons[i];
      if (b && (b.pressed || b.value > TRIGGER_THRESHOLD)) return true;
    }
    return false;
  }

  /** Poll gamepad edges; call once per frame. */
  pollGamepad(): void {
    const p = this.pad();
    if (!p) return;
    for (const a of ACTIONS) {
      const now = this.padAction(p, a);
      if (now && !this.padPrev.get(a)) {
        this.pressedQueue.add(a);
        this.tapLatch.add(a);
        this.lastDevice = 'gamepad';
        this.onAnyPress?.();
      }
      this.padPrev.set(a, now);
    }
  }

  isDown(a: Action): boolean {
    return this.keyAction(a) || this.padAction(this.pad(), a);
  }

  private held(a: Action): boolean {
    return this.tapLatch.has(a) || this.isDown(a);
  }

  /** Press an action from an on-screen button (click/tap); behaves like a key tap. */
  virtualPress(a: Action): void {
    this.pressedQueue.add(a);
    this.tapLatch.add(a);
  }

  /** True once per physical press. */
  consumePressed(a: Action): boolean {
    const had = this.pressedQueue.has(a);
    this.pressedQueue.delete(a);
    return had;
  }

  clearPressed(): void {
    this.pressedQueue.clear();
    this.tapLatch.clear();
  }

  /** Build the command for the local aircraft for this tick. */
  sampleCommand(): InputCommand {
    const c = this.cmd;
    // Two-button flying: only left/right matter. Left rotates the nose
    // anticlockwise, right clockwise; holding one loops all the way around.
    let turn = (this.keyAction('right') ? 1 : 0) - (this.keyAction('left') ? 1 : 0);
    const p = this.pad();
    if (p) {
      const ax = p.axes[0] ?? 0;
      if (Math.abs(ax) > STICK_DEADZONE) {
        turn = ax;
        this.lastDevice = 'gamepad';
      } else {
        if (this.padAction(p, 'right')) turn = 1;
        if (this.padAction(p, 'left')) turn = -1;
      }
    }
    c.steerX = 0;
    c.steerY = 0;
    c.turn = Math.max(-1, Math.min(1, turn));
    let b = 0;
    if (this.held('fire')) b |= Button.Fire;
    if (this.held('missile')) b |= Button.Missile;
    if (this.held('flare')) b |= Button.Flare;
    if (this.held('boost')) b |= Button.Boost;
    if (this.held('brake')) b |= Button.Brake;
    if (this.held('ability')) b |= Button.Ability;
    this.tapLatch.clear();
    c.buttons = b;
    c.seq = ++this.seq;
    return c;
  }

  /** Human-readable label for the first binding of an action. */
  label(a: Action): string {
    const code = this.bindings[a]?.[0];
    return code ? keyLabel(code) : '—';
  }

  labels(a: Action): string {
    return (this.bindings[a] ?? []).map(keyLabel).join(' / ');
  }
}

export function keyLabel(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
    ShiftLeft: 'Shift', ShiftRight: 'R-Shift', ControlLeft: 'Ctrl', Escape: 'Esc', Enter: 'Enter',
  };
  return map[code] ?? code;
}
