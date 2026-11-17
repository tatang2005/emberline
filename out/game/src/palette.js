// EMBERLINE palette — one source of truth for every colour in the game.
// Warm ember (attackers) against cool slate (defenders) over a dark foundry.
// Every module reads colours from here; no hex literals elsewhere.

export const PALETTE = {
  canvas: '#17130f',
  surface: '#241c15',
  hairline: '#3a2f24',
  ink: '#f2e8d5',
  muted: '#9a8f7a',
  accent: '#ff9a2e',
  ember: '#ff7a1a',
  emberDark: '#b34700',
  slate: '#7fa8c9',
  slateDark: '#33506b',
  furnace: '#ff5a1f',
  hazard: '#ffc21a',
  floor: '#2a2118',
  wall: '#33291d',
  metal: '#4a4238',
  crate: '#5a4630',
  smoke: '#8a8a8a',
};

export function shade(name) {
  return PALETTE[name];
}
