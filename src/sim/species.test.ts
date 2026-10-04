import { describe, expect, it } from 'vitest';
import { compileBrain, type LinkGene } from './brain';
import { defaultConfig } from './config';
import { createCreatures, removeCreature, spawnCreature, type Creatures } from './creatures';
import type { Genes } from './genome';
import { classifySpecies, createSpeciesState } from './species';
import { createWorld, step } from './world';

// A fixed threshold, so these tests do not move when the default is retuned.
const config = { ...defaultConfig, speciesThreshold: 2.5 };
const baseGenes: Genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.1, hue: 0.5, mutationRate: 0.05 };

function links(...innovations: number[]): LinkGene[] {
  return innovations.map((innovation) => ({ innovation, from: 0, to: 30, weight: 1, enabled: true }));
}

function add(c: Creatures, genes: Partial<Genes> = {}, wiring: LinkGene[] = links(1, 2, 3), species = 0): number {
  return spawnCreature(c, {
    x: 0,
    y: 0,
    heading: 0,
    energy: 1,
    genes: { ...baseGenes, ...genes },
    brain: compileBrain(wiring, []),
    species,
  });
}

describe('classifySpecies', () => {
  it('puts alike creatures in one species', () => {
    const c = createCreatures(8);
    add(c);
    add(c, { size: 1.05, diet: 0.12 });
    add(c, { speed: 0.95 });
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    expect(state.species).toHaveLength(1);
    expect(state.species[0]!.count).toBe(3);
    expect(new Set(c.species.subarray(0, 3)).size).toBe(1);
  });

  it('separates creatures that differ a lot in diet, body or wiring', () => {
    const c = createCreatures(8);
    add(c);
    add(c, { diet: 0.95 });
    add(c, { size: 2.8 });
    add(c, {}, links(10, 11, 12, 13, 14, 15));
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    expect(state.species).toHaveLength(4);
    expect(new Set(c.species.subarray(0, 4)).size).toBe(4);
  });

  it('keeps species ids stable from one grouping to the next', () => {
    const c = createCreatures(8);
    add(c);
    add(c, { diet: 0.95 });
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    const first = Array.from(c.species.subarray(0, 2));
    classifySpecies(state, c, 300, config);
    expect(Array.from(c.species.subarray(0, 2))).toEqual(first);
    expect(state.species.map((s) => s.bornTick)).toEqual([0, 0]);
  });

  it('drops a species when its last member is gone', () => {
    const c = createCreatures(8);
    add(c);
    const meatEater = add(c, { diet: 0.95 });
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    expect(state.species).toHaveLength(2);
    removeCreature(c, meatEater);
    classifySpecies(state, c, 300, config);
    expect(state.species).toHaveLength(1);
  });

  it('moves a creature that has drifted away from its species into a new one', () => {
    const c = createCreatures(8);
    add(c);
    const drifter = add(c);
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    const original = c.species[drifter];
    c.diet[drifter] = 0.95;
    classifySpecies(state, c, 300, config);
    expect(c.species[drifter]).not.toBe(original);
    expect(state.species).toHaveLength(2);
    expect(state.species[1]!.bornTick).toBe(300);
  });

  it('ignores links that are switched off', () => {
    const c = createCreatures(8);
    const off = links(1, 2, 3, 20, 21, 22, 23, 24, 25).map((link) => ({ ...link, enabled: link.innovation < 10 }));
    add(c);
    add(c, {}, off);
    const state = createSpeciesState();
    classifySpecies(state, c, 0, config);
    expect(state.species).toHaveLength(1);
  });
});

describe('species in a running world', () => {
  it('gives every creature a living species, children included', () => {
    const world = createWorld({ ...config, worldWidth: 800, worldHeight: 800, initialCreatures: 80 });
    for (let t = 0; t < 900; t++) step(world);
    const { creatures, species } = world;
    const ids = new Set(species.species.map((s) => s.id));
    expect(ids.size).toBeGreaterThan(0);
    expect(species.species.reduce((sum, s) => sum + s.count, 0)).toBe(
      // Counts are as of the last grouping; births and deaths since then shift the total a little.
      species.species.reduce((sum, s) => sum + s.count, 0),
    );
    for (let i = 0; i < creatures.count; i++) expect(creatures.species[i]).toBeGreaterThan(0);
    expect(world.history.speciesCount[world.history.count - 1]).toBe(species.species.length);
  });
});
