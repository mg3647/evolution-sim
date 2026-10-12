import { describe, expect, it } from 'vitest';
import { speciesColor, speciesName } from './speciesColors';

describe('species names', () => {
  it('gives every species its own name, the same each time', () => {
    const names = new Set<string>();
    for (let id = 1; id <= 20000; id++) names.add(speciesName(id));
    expect(names.size).toBe(20000);
    expect(speciesName(21)).toBe(speciesName(21));
  });

  it('makes short capitalised names, and names the lumped-together group plainly', () => {
    for (let id = 1; id <= 2000; id++) {
      const name = speciesName(id);
      expect(name).toMatch(/^[A-Z][a-z]{2,10}$/);
    }
    expect(speciesName(0)).toBe('Smaller species');
  });

  it('gives neighbouring species different colours', () => {
    for (let id = 1; id < 100; id++) expect(speciesColor(id)).not.toBe(speciesColor(id + 1));
    expect(speciesColor(5)).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe('species colours', () => {
  it('gives the biggest living species different colours, and keeps each colour for life', async () => {
    const { assignSpeciesColors, resetSpeciesColors, SPECIES_PALETTE } = await import('../render/speciesPalette');
    resetSpeciesColors();
    // Ids that would all share one colour by id alone.
    const living = [9, 18, 27, 36, 45];
    assignSpeciesColors(living);
    const colours = living.map(speciesColor);
    expect(new Set(colours).size).toBe(living.length);
    assignSpeciesColors([45, 99, ...Array.from({ length: SPECIES_PALETTE.length }, (_, k) => 100 + k)]);
    expect(speciesColor(45)).toBe(colours[4]);
    resetSpeciesColors();
  });
});
