/**
 * Colours for species, picked to stay apart for colour-blind viewers (after
 * Okabe & Ito, and Tol, lightened for the dark map). Neighbouring entries
 * differ most, since new species usually split from the one before. With more
 * species alive than colours, the species name tells them apart.
 */
export const SPECIES_PALETTE = [
  0xe69f00, // orange
  0x56b4e9, // sky blue
  0xf0e442, // yellow
  0xcc79a7, // pink
  0x1fc08f, // bluish green
  0xf26b21, // vermilion
  0x9d8cff, // violet
  0xbbcc33, // pear
  0x3b8fe0, // blue
  0xdddddd, // pale grey
];
/** The colour of the smaller species lumped together, and of creatures not yet grouped. */
export const OTHER_SPECIES_COLOR = 0x5a6672;

/** The colour a species is drawn in everywhere, as 0xRRGGBB. */
export function speciesRgb(id: number): number {
  return id <= 0 ? OTHER_SPECIES_COLOR : SPECIES_PALETTE[id % SPECIES_PALETTE.length]!;
}
