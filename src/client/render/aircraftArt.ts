import type { AircraftArtId } from '../../sim/config/aircraft';

/**
 * Procedural, original aircraft artwork. Each airframe is a set of polygons in
 * local space (nose toward +x, "up" toward -y). Replacing these with sprites
 * later only requires swapping `drawAirframe`.
 */

export interface ArtPalette {
  body: string;
  bodyDark: string;
  wing: string;
  accent: string;
  canopy: string;
  canopyHi: string;
  nozzle: string;
  flameCore: string;
  flameGlow: string;
  /** Thin panel-line outline that keeps silhouettes readable against bright clouds. */
  outline: string;
}

export const PALETTES = {
  blue: {
    body: '#d9e3ec', bodyDark: '#8796a8', wing: '#b4c2d0', accent: '#27d4ff',
    canopy: '#16334f', canopyHi: '#8cecff', nozzle: '#3a4049', flameCore: '#f0ffff', flameGlow: '#3cc6ff',
    outline: 'rgba(10,24,40,0.7)',
  },
  orange: {
    body: '#646a74', bodyDark: '#363a41', wing: '#50555e', accent: '#ff7b1c',
    canopy: '#5a3208', canopyHi: '#ffc36b', nozzle: '#202226', flameCore: '#fff0d0', flameGlow: '#ff6d1a',
    outline: 'rgba(20,10,4,0.75)',
  },
  flash: {
    body: '#ffffff', bodyDark: '#ffffff', wing: '#ffffff', accent: '#ffffff',
    canopy: '#ffffff', canopyHi: '#ffffff', nozzle: '#ffffff', flameCore: '#ffffff', flameGlow: '#ffffff',
    outline: '',
  },
} satisfies Record<string, ArtPalette>;

type Poly = readonly number[];

/** Current outline colour; set per draw call so `poly` stays a tiny helper. */
let outline = '';

function poly(ctx: CanvasRenderingContext2D, pts: Poly, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
  ctx.closePath();
  ctx.fill();
  if (outline) {
    ctx.strokeStyle = outline;
    ctx.stroke();
  }
}

interface Airframe {
  nozzleX: number;
  nozzleHalf: number;
  length: number;
  draw(ctx: CanvasRenderingContext2D, p: ArtPalette, missiles: boolean): void;
}

// ---- VX-7 Viper: cranked delta, canards, single swept fin -----------------
const VIPER_BODY: Poly = [36, 1, 24, -3, 14, -5.5, -8, -6.5, -22, -6, -33, -4.5, -35, -1, -35, 4, -26, 5.5, -6, 6, 14, 5, 26, 3];
const VIPER_BELLY: Poly = [36, 1, 26, 3, 14, 5, -6, 6, -26, 5.5, -35, 4, -35, 1.2, -6, 2.2, 20, 1.6];
const VIPER_FIN: Poly = [-14, -6.2, -27, -20, -34, -20, -31, -5];
const VIPER_FIN_STRIPE: Poly = [-23.5, -16.3, -31.4, -16.3, -31.9, -13.2, -20.6, -13.2];
const VIPER_TAILPLANE: Poly = [-24, 1, -36, 6.5, -40, 6.5, -32, 1];
const VIPER_WING: Poly = [10, 2, -10, 9.5, -24, 10.5, -26, 8.4, -12, 2];
const VIPER_CANARD: Poly = [22, -1.5, 15, -4.2, 12, -4.2, 15, -1.5];
const VIPER_STRIPE: Poly = [30, -0.4, -20, -2.6, -20, -0.9, 30, 0.9];
const VIPER_CANOPY: Poly = [20, -4, 15, -8.5, 8, -10.8, 1, -10.3, -4, -6.4, 14, -5.4];

const viper: Airframe = {
  nozzleX: -35,
  nozzleHalf: 3.6,
  length: 76,
  draw(ctx, p, missiles) {
    poly(ctx, VIPER_TAILPLANE, p.bodyDark);
    poly(ctx, VIPER_FIN, p.body);
    poly(ctx, VIPER_FIN_STRIPE, p.accent);
    poly(ctx, VIPER_BODY, p.body);
    poly(ctx, VIPER_BELLY, p.bodyDark);
    poly(ctx, VIPER_STRIPE, p.accent);
    poly(ctx, VIPER_CANOPY, p.canopy);
    ctx.strokeStyle = p.canopyHi;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(15, -7.2);
    ctx.lineTo(7, -9.4);
    ctx.stroke();
    poly(ctx, VIPER_CANARD, p.bodyDark);
    poly(ctx, VIPER_WING, p.wing);
    if (missiles) {
      poly(ctx, [12, 7.6, -8, 7.6, -10, 9.8, 12, 9.8], '#e8ecef');
      poly(ctx, [15, 8.7, 12, 7.6, 12, 9.8], p.accent);
    }
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-38.5, -3.6, 4, 7.4);
  },
};

// ---- KR-3 Scythe: forward-swept wing, twin canted tails, blunt nose ---------
const SCYTHE_BODY: Poly = [32, 2, 22, -3, 10, -6, -12, -7, -26, -5, -32, -2, -32, 4, -20, 6, 4, 6, 20, 5];
const SCYTHE_BELLY: Poly = [32, 2, 20, 5, 4, 6, -20, 6, -32, 4, -32, 1, 0, 2.6];
const SCYTHE_CANOPY: Poly = [12, -5.5, 6, -10, -2, -10, -6, -6.8];
const SCYTHE_WING: Poly = [-14, 2, 2, 12, 9, 12, -2, 2];
const SCYTHE_WING_TIP: Poly = [1, 10, 8, 10, 9, 12, 2, 12];
const SCYTHE_FIN_TOP: Poly = [-16, -6.8, -22, -18, -28, -18, -29, -5];
const SCYTHE_FIN_STRIPE: Poly = [-21.5, -15.5, -27.2, -15.5, -27.5, -12.5, -20, -12.5];
const SCYTHE_FIN_LOW: Poly = [-18, 5.8, -25, 14, -30, 14, -29, 4.5];
const SCYTHE_INTAKE: Poly = [14, 1, 6, 4.6, -4, 4.6, -2, 1];
const SCYTHE_STRIPE: Poly = [26, -1.5, 12, -3.4, 12, -1.8, 26, 0];

const scythe: Airframe = {
  nozzleX: -32,
  nozzleHalf: 3.2,
  length: 66,
  draw(ctx, p, missiles) {
    poly(ctx, SCYTHE_FIN_LOW, p.bodyDark);
    poly(ctx, SCYTHE_FIN_TOP, p.body);
    poly(ctx, SCYTHE_FIN_STRIPE, p.accent);
    poly(ctx, SCYTHE_BODY, p.body);
    poly(ctx, SCYTHE_BELLY, p.bodyDark);
    poly(ctx, SCYTHE_INTAKE, '#16181c');
    poly(ctx, SCYTHE_STRIPE, p.accent);
    poly(ctx, SCYTHE_CANOPY, p.canopy);
    ctx.strokeStyle = p.canopyHi;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(7, -8.6);
    ctx.lineTo(0, -9.3);
    ctx.stroke();
    poly(ctx, SCYTHE_WING, p.wing);
    poly(ctx, SCYTHE_WING_TIP, p.accent);
    if (missiles) poly(ctx, [4, 7, -10, 7, -11, 8.8, 4, 8.8], '#c9cdd2');
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-35, -3.2, 3.5, 6.6);
  },
};

// ---- SR-2 Swift: tiny needle-nosed dart, sharply swept wing, single fin ----
const SWIFT_BODY: Poly = [36, 0.5, 22, -2.5, 8, -4, -14, -4.5, -26, -3.5, -30, -1, -30, 3, -20, 4, 4, 4, 20, 2.5];
const SWIFT_BELLY: Poly = [36, 0.5, 20, 2.5, 4, 4, -20, 4, -30, 3, -30, 1, 0, 1.5];
const SWIFT_CANOPY: Poly = [18, -2.5, 12, -7, 4, -7.5, -1, -4.5];
const SWIFT_FIN: Poly = [-15, -4.5, -27, -15, -32, -15, -28, -3.5];
const SWIFT_FIN_STRIPE: Poly = [-22, -11, -29.5, -11, -30, -9, -20, -9];
const SWIFT_WING: Poly = [4, 1.5, -18, 8.5, -25, 8.5, -12, 1.5];
const SWIFT_STRIPE: Poly = [30, -0.2, -18, -2.2, -18, -0.7, 30, 1];

const swift: Airframe = {
  nozzleX: -30,
  nozzleHalf: 2.6,
  length: 66,
  draw(ctx, p, missiles) {
    poly(ctx, SWIFT_FIN, p.body);
    poly(ctx, SWIFT_FIN_STRIPE, p.accent);
    poly(ctx, SWIFT_BODY, p.body);
    poly(ctx, SWIFT_BELLY, p.bodyDark);
    poly(ctx, SWIFT_STRIPE, p.accent);
    poly(ctx, SWIFT_CANOPY, p.canopy);
    poly(ctx, SWIFT_WING, p.wing);
    if (missiles) poly(ctx, [6, 5.5, -8, 5.5, -9, 7.2, 6, 7.2], '#e8ecef');
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-33, -2.6, 3.5, 5.2);
  },
};

// ---- HG-9 Titan: bulky twin-engine gunship, twin tails, big wing -------------
const TITAN_BODY: Poly = [38, 2, 30, -5, 16, -9, -10, -10, -30, -9, -40, -6, -40, 7, -30, 9, 10, 9, 28, 6];
const TITAN_BELLY: Poly = [38, 2, 28, 6, 10, 9, -30, 9, -40, 7, -40, 2, 0, 3.5];
const TITAN_CANOPY: Poly = [22, -7, 16, -13, 6, -14, 0, -9.5];
const TITAN_FIN_BACK: Poly = [-24, -9.5, -31, -21, -38, -21, -40, -6];
const TITAN_FIN: Poly = [-17, -10, -25, -24, -33, -24, -35, -9];
const TITAN_FIN_STRIPE: Poly = [-22.5, -19.5, -31.5, -19.5, -32, -16.5, -21, -16.5];
const TITAN_WING: Poly = [12, 3, -8, 14.5, -27, 14.5, -24, 3];
const TITAN_INTAKE: Poly = [20, 1, 8, 6.5, -6, 6.5, -4, 1];
const TITAN_STRIPE: Poly = [30, -3, -20, -6.5, -20, -4.5, 30, -1];

const titan: Airframe = {
  nozzleX: -40,
  nozzleHalf: 6,
  length: 86,
  draw(ctx, p, missiles) {
    poly(ctx, TITAN_FIN_BACK, p.bodyDark);
    poly(ctx, TITAN_FIN, p.body);
    poly(ctx, TITAN_FIN_STRIPE, p.accent);
    poly(ctx, TITAN_BODY, p.body);
    poly(ctx, TITAN_BELLY, p.bodyDark);
    poly(ctx, TITAN_INTAKE, '#16181c');
    poly(ctx, TITAN_STRIPE, p.accent);
    poly(ctx, TITAN_CANOPY, p.canopy);
    poly(ctx, TITAN_WING, p.wing);
    if (missiles) {
      poly(ctx, [10, 11, -10, 11, -12, 13.5, 10, 13.5], '#e8ecef');
      poly(ctx, [2, 15, -18, 15, -20, 17.5, 2, 17.5], '#e8ecef');
    }
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-44, -6, 4.5, 5);
    ctx.fillRect(-44, 1.5, 4.5, 5);
  },
};

// ---- NX-4 Phantom: faceted stealth wedge, sawtooth wing, slit exhaust -------
const PHANTOM_BODY: Poly = [38, 1, 18, -5, -6, -8, -30, -6, -36, -2, -36, 4, -24, 6, 0, 6, 22, 3];
const PHANTOM_BELLY: Poly = [38, 1, 22, 3, 0, 6, -24, 6, -36, 4, -36, 1.5, 0, 2];
const PHANTOM_CANOPY: Poly = [16, -4.5, 8, -8.6, -2, -8.6, -6, -7];
const PHANTOM_FIN: Poly = [-17, -7, -28, -17, -34, -17, -32, -5];
const PHANTOM_WING: Poly = [10, 2, -12, 11, -18, 9, -24, 11, -27, 8, -14, 2];
const PHANTOM_EDGE: Poly = [32, 0, -22, -3.4, -22, -2.4, 32, 0.9];

const phantom: Airframe = {
  nozzleX: -36,
  nozzleHalf: 1.8,
  length: 76,
  draw(ctx, p, missiles) {
    poly(ctx, PHANTOM_FIN, p.bodyDark);
    poly(ctx, PHANTOM_BODY, p.bodyDark);
    poly(ctx, PHANTOM_BELLY, p.nozzle);
    poly(ctx, PHANTOM_EDGE, p.accent);
    poly(ctx, PHANTOM_CANOPY, p.canopy);
    poly(ctx, PHANTOM_WING, p.wing);
    // Internal weapons bay: no external missiles break the silhouette.
    void missiles;
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-39, -1.8, 3, 3.6);
  },
};

// ---- XE-1 Nova: experimental airframe with a glowing energy core --------------
const NOVA_BODY: Poly = [36, 0, 26, -5, 10, -7, -8, -7, -24, -5, -32, -2, -32, 3, -22, 6, -6, 7, 12, 6, 26, 4];
const NOVA_BELLY: Poly = [36, 0, 26, 4, 12, 6, -6, 7, -22, 6, -32, 3, -32, 1, 0, 2];
const NOVA_CANOPY: Poly = [20, -5, 12, -10, 2, -10, -2, -7];
const NOVA_FIN: Poly = [-12, -7, -18, -18, -26, -18, -28, -4];
const NOVA_WING: Poly = [6, 3, -20, 13, -28, 13, -22, 3];
const NOVA_RAIL: Poly = [28, -1.6, -12, -3.6, -12, -2.3, 28, -0.2];
const NOVA_CANARD: Poly = [24, -2, 17, -6.5, 14, -6.5, 17, -2];

const nova: Airframe = {
  nozzleX: -32,
  nozzleHalf: 2.8,
  length: 72,
  draw(ctx, p, missiles) {
    poly(ctx, NOVA_FIN, p.body);
    poly(ctx, NOVA_BODY, p.body);
    poly(ctx, NOVA_BELLY, p.bodyDark);
    poly(ctx, NOVA_RAIL, p.accent);
    poly(ctx, NOVA_CANOPY, p.canopy);
    poly(ctx, NOVA_CANARD, p.bodyDark);
    poly(ctx, NOVA_WING, p.wing);
    // Energy core.
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(-7, 1.5, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.flameCore;
    ctx.beginPath();
    ctx.arc(-7, 1.5, 1.5, 0, Math.PI * 2);
    ctx.fill();
    if (missiles) poly(ctx, [4, 9, -12, 9, -13, 10.8, 4, 10.8], '#e8ecef');
    ctx.fillStyle = p.nozzle;
    ctx.fillRect(-35, -2.8, 3.5, 5.6);
  },
};

const AIRFRAMES: Record<AircraftArtId, Airframe> = { viper, scythe, swift, titan, phantom, nova };

export interface DrawOptions {
  /** -1..1 visual roll; the sign keeps the canopy on top. */
  roll: number;
  /** 0..1 white hit flash. */
  flash: number;
  missiles: boolean;
  /** 0..1 fraction of health lost, for scorch marks. */
  damage: number;
}

/** Draw an aircraft in local space. The caller has translated/rotated to the aircraft. */
export function drawAirframe(
  ctx: CanvasRenderingContext2D, art: AircraftArtId, pal: ArtPalette, o: DrawOptions,
): void {
  const f = AIRFRAMES[art];
  ctx.save();
  // Never collapse to a zero-thickness line mid-roll.
  const r = o.roll >= 0 ? Math.max(0.16, o.roll) : Math.min(-0.16, o.roll);
  ctx.scale(1, r);
  ctx.lineWidth = 0.9;
  ctx.lineJoin = 'round';
  outline = pal.outline;
  f.draw(ctx, pal, o.missiles);
  if (o.damage > 0.25) {
    ctx.globalAlpha = Math.min(0.75, (o.damage - 0.25) * 1.3);
    ctx.fillStyle = '#1a1512';
    ctx.beginPath();
    ctx.ellipse(-6, -2, 6, 2.5, 0.2, 0, Math.PI * 2);
    ctx.ellipse(12, 1, 4, 2, -0.3, 0, Math.PI * 2);
    if (o.damage > 0.6) ctx.ellipse(-22, 0, 5, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (o.flash > 0) {
    ctx.globalAlpha = o.flash;
    outline = '';
    f.draw(ctx, PALETTES.flash, o.missiles);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Engine exhaust plume, drawn additively behind the airframe. */
export function drawExhaust(
  ctx: CanvasRenderingContext2D, art: AircraftArtId, pal: ArtPalette,
  throttle: number, boost: boolean, time: number, sputter: boolean,
): void {
  const f = AIRFRAMES[art];
  const flicker = 0.85 + Math.sin(time * 61) * 0.08 + Math.sin(time * 37.7) * 0.07;
  if (sputter && Math.sin(time * 23) > 0.55) return; // damaged engine cuts out briefly
  const len = (8 + throttle * 18 + (boost ? 40 : 0)) * flicker;
  const w = f.nozzleHalf * (boost ? 1.35 : 1);
  const x0 = f.nozzleX - 3.5;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createLinearGradient(x0, 0, x0 - len, 0);
  g.addColorStop(0, pal.flameCore);
  g.addColorStop(0.25, pal.flameGlow);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x0, -w);
  ctx.quadraticCurveTo(x0 - len * 0.4, -w * 1.1, x0 - len, 0);
  ctx.quadraticCurveTo(x0 - len * 0.4, w * 1.1, x0, w);
  ctx.closePath();
  ctx.fill();
  if (boost) {
    // Shock diamonds sell the afterburner.
    ctx.fillStyle = pal.flameCore;
    ctx.globalAlpha = 0.55 * flicker;
    for (let i = 1; i <= 3; i++) {
      const cx = x0 - i * len * 0.2;
      const s = w * (1 - i * 0.22);
      ctx.beginPath();
      ctx.moveTo(cx + s, 0);
      ctx.lineTo(cx, -s * 0.7);
      ctx.lineTo(cx - s, 0);
      ctx.lineTo(cx, s * 0.7);
      ctx.fill();
    }
  }
  ctx.restore();
}

export function airframeLength(art: AircraftArtId): number {
  return AIRFRAMES[art].length;
}
