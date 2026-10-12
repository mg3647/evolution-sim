/**
 * Colours for species, picked to stay apart for colour-blind viewers (after
 * Okabe & Ito, and Tol, lightened for the dark map). With more species alive
 * than colours, the species name tells them apart.
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
  0xdddddd, // pale grey
];
/** The colour of the smaller species lumped together, and of creatures not yet grouped. */
export const OTHER_SPECIES_COLOR = 0x5a6672;

/** Palette slot of each species seen so far. A species keeps its colour for life. */
const assigned = new Map<number, number>();

/**
 * Give each newly seen species the colour fewest living species have, taking
 * the largest first, so the biggest species alive rarely share a colour.
 * `living` is the living species' ids, largest first.
 */
export function assignSpeciesColors(living: readonly number[]): void {
  if (living.every((id) => assigned.has(id))) return;
  const used = new Array<number>(SPECIES_PALETTE.length).fill(0);
  for (const id of living) {
    const slot = assigned.get(id);
    if (slot !== undefined) used[slot]!++;
  }
  for (const id of living) {
    if (id <= 0 || assigned.has(id)) continue;
    // Least used; ties go to the slot the id would have had, so results stay varied.
    let best = id % SPECIES_PALETTE.length;
    for (let k = 0; k < SPECIES_PALETTE.length; k++) if (used[k]! < used[best]!) best = k;
    assigned.set(id, best);
    used[best]!++;
  }
}

/** Forget every assignment, for a new or loaded world whose ids mean other species. */
export function resetSpeciesColors(): void {
  assigned.clear();
}

/** The colour a species is drawn in everywhere, as 0xRRGGBB. */
export function speciesRgb(id: number): number {
  if (id <= 0) return OTHER_SPECIES_COLOR;
  return SPECIES_PALETTE[assigned.get(id) ?? id % SPECIES_PALETTE.length]!;
}
