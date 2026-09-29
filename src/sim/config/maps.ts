/**
 * Map definitions. Terrain is described as a list of landmasses that are baked
 * into a heightfield (see sim/terrain.ts). Visual-only details (structures,
 * background theme) are also declared here so maps stay fully data-driven.
 */

export interface LandmassDef {
  /** Center x. */
  x: number;
  /** Total width at the waterline. */
  width: number;
  /** Peak height above sea level. */
  height: number;
  /** 0..1 — fraction of the half-width that is sloped. Low = sheer cliffs. */
  slope: number;
  /** Surface roughness amplitude. */
  rough: number;
  kind: 'island' | 'cliff' | 'stack';
}

export interface StructureDef {
  kind: 'radar' | 'lighthouse' | 'bunker' | 'antenna';
  x: number;
}

export interface SpawnPointDef {
  x: number;
  y: number;
  /** Initial heading facing, 1 = right, -1 = left. */
  facing: 1 | -1;
}

export interface MapDef {
  id: string;
  name: string;
  theme: 'azure';
  width: number;
  height: number;
  seaLevel: number;
  /** Heightfield sampling step. */
  terrainStep: number;
  landmasses: LandmassDef[];
  structures: StructureDef[];
  spawns: SpawnPointDef[];
  tips: string[];
}

export const MAPS: Record<string, MapDef> = {
  azureCoast: {
    id: 'azureCoast',
    name: 'Azure Coast',
    theme: 'azure',
    width: 9600,
    height: 2800,
    seaLevel: 2600,
    terrainStep: 16,
    landmasses: [
      // Western headland: tall cliff wall that anchors the left side of the arena.
      { x: 380, width: 1300, height: 1350, slope: 0.35, rough: 60, kind: 'cliff' },
      { x: 1750, width: 520, height: 520, slope: 0.6, rough: 30, kind: 'island' },
      { x: 2600, width: 110, height: 820, slope: 0.25, rough: 14, kind: 'stack' },
      { x: 3500, width: 1300, height: 700, slope: 0.55, rough: 45, kind: 'island' },
      { x: 4700, width: 150, height: 1050, slope: 0.3, rough: 18, kind: 'stack' },
      { x: 4930, width: 120, height: 640, slope: 0.3, rough: 14, kind: 'stack' },
      { x: 6050, width: 1500, height: 560, slope: 0.7, rough: 50, kind: 'island' },
      { x: 7300, width: 140, height: 900, slope: 0.25, rough: 16, kind: 'stack' },
      // Eastern cliffs mirror the west so neither side is "safe".
      { x: 9150, width: 1400, height: 1500, slope: 0.4, rough: 70, kind: 'cliff' },
    ],
    structures: [
      { kind: 'lighthouse', x: 1760 },
      { kind: 'radar', x: 3300 },
      { kind: 'bunker', x: 3780 },
      { kind: 'antenna', x: 5850 },
      { kind: 'radar', x: 6300 },
      { kind: 'antenna', x: 700 },
      { kind: 'radar', x: 8900 },
    ],
    spawns: [
      { x: 1500, y: 900, facing: 1 },
      { x: 2600, y: 700, facing: 1 },
      { x: 3500, y: 1200, facing: 1 },
      { x: 4800, y: 600, facing: -1 },
      { x: 6100, y: 1300, facing: -1 },
      { x: 7200, y: 700, facing: -1 },
      { x: 8200, y: 1000, facing: -1 },
      { x: 5400, y: 1600, facing: 1 },
    ],
    tips: [
      'Brake while turning to tighten your turn radius — at the cost of speed.',
      'Missiles turn slower than you. Light the afterburner and break hard as one closes in to make it overshoot.',
      'Flares break locks and pull in missiles that are already tracking you.',
      'Diving trades altitude for speed. Climbing does the opposite.',
      'Sea stacks make excellent missile shields.',
    ],
  },
};

export function getMapDef(id: string): MapDef {
  const def = MAPS[id];
  if (!def) throw new Error(`Unknown map def: ${id}`);
  return def;
}
