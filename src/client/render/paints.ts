import { PALETTES, type ArtPalette } from './aircraftArt';

/**
 * Cosmetic paint schemes for the player's aircraft (bought with credits in the
 * hangar). Purely visual: they never change stats.
 */
export interface PaintDef {
  id: string;
  name: string;
  cost: number;
  palette: ArtPalette;
}

const base = PALETTES.blue;

export const PAINTS: PaintDef[] = [
  { id: 'standard', name: 'Fleet Standard', cost: 0, palette: base },
  {
    id: 'arctic', name: 'Arctic', cost: 400,
    palette: { ...base, body: '#f4f8fb', bodyDark: '#a9b8c6', wing: '#dde6ee', accent: '#7fd4ff', canopy: '#1d3550' },
  },
  {
    id: 'crimson', name: 'Crimson Lance', cost: 600,
    palette: { ...base, body: '#d9dde2', bodyDark: '#7d8590', wing: '#c3c9d0', accent: '#ff3b4e', canopyHi: '#ffb3bb', flameGlow: '#ff6a7a' },
  },
  {
    id: 'jade', name: 'Jade Wing', cost: 600,
    palette: { ...base, body: '#cfe0d6', bodyDark: '#6f8a7c', wing: '#b4cabd', accent: '#35e39a', canopyHi: '#b3ffe0', flameGlow: '#3be0a0' },
  },
  {
    id: 'midnight', name: 'Midnight', cost: 900,
    palette: { ...base, body: '#3a4250', bodyDark: '#1f252f', wing: '#2e3541', accent: '#5fe3ff', canopy: '#0b1622', nozzle: '#15191f' },
  },
  {
    id: 'solar', name: 'Solar Ace', cost: 1500,
    palette: { ...base, body: '#efe6cf', bodyDark: '#a08c5c', wing: '#d9ccab', accent: '#ffb321', canopyHi: '#ffe19a', flameCore: '#fffbe8', flameGlow: '#ffb84a' },
  },
];

export function paintPalette(id: string | undefined): ArtPalette {
  return PAINTS.find((p) => p.id === id)?.palette ?? base;
}
