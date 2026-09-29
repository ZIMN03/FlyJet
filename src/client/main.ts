import './ui/styles.css';
import { Game } from './game';

function fatal(message: string): void {
  const el = document.getElementById('ui');
  if (el) {
    el.innerHTML = `<div class="screen dim"><div class="center-wrap"><div class="panel error-box">
      <h2>Unable to start</h2><p></p></div></div></div>`;
    el.querySelector('p')!.textContent = message;
  }
}

try {
  const canvas = document.getElementById('game') as HTMLCanvasElement | null;
  const ui = document.getElementById('ui');
  if (!canvas || !ui) throw new Error('Missing game elements in the page.');
  const game = new Game(canvas, ui);
  // Handy for manual testing in the console; harmless in production.
  (window as unknown as { aerovant: Game }).aerovant = game;
} catch (err) {
  console.error(err);
  fatal(err instanceof Error ? err.message : String(err));
}
