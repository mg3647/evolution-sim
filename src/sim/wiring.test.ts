import { describe, expect, it } from 'vitest';
import { compileBrain } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { createCreatures, spawnCreature } from './creatures';
import { loadWorld, saveWorld } from './serialize';
import { createWiringTally, markFounding, sampleWiring } from './wiring';
import { createWorld, hashWorld, step } from './world';

const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0, fur: 0, defense: 0, mutationRate: 0.1 };
const WINDOW = 600;
const link = (innovation: number) => ({ innovation, from: 0, to: 80, weight: 1, enabled: true });

function population(brains: number[][], shadows: number[][]) {
  const c = createCreatures(16);
  brains.forEach((ids, k) => {
    spawnCreature(c, {
      x: 0,
      y: 0,
      heading: 0,
      energy: 1,
      genes,
      brain: compileBrain(ids.map(link), []),
      shadow: shadows[k],
    });
  });
  return c;
}

describe('evolutionary activity', () => {
  it('gives one unit of activity per sample to every link someone carries', () => {
    const tally = createWiringTally();
    const c = population([[1, 2], [2, 3]], [[1], [1]]);
    const first = sampleWiring(tally, c, 0, WINDOW);
    expect(first.live).toBe(3);
    expect(first.shadowLive).toBe(1);
    sampleWiring(tally, c, 30, WINDOW);
    expect(tally.real.get(2)).toBe(2);
    expect(tally.shadow.get(1)).toBe(2);
    expect(tally.real.get(9)).toBeUndefined();
  });

  it('compares how many links first seen long ago are still carried, real against shadow', () => {
    const tally = createWiringTally();
    // The first sample holds the founders. Then one new real link and one new shadow link appear.
    sampleWiring(tally, population([[1]], [[1]]), 0, WINDOW);
    let stats = sampleWiring(tally, population([[1, 2], [1, 3]], [[1, 8], [1]]), 30, WINDOW);
    expect(stats.survival).toBe(0);
    // Too young to judge until WINDOW ticks have passed.
    stats = sampleWiring(tally, population([[1, 2], [1, 3]], [[1, 8], [1]]), 30 + WINDOW - 1, WINDOW);
    expect(stats.survival).toBe(0);
    // Link 2 and 3 both survive; the shadow's link 8 is lost at the end.
    stats = sampleWiring(tally, population([[1, 2], [1, 3]], [[1], [1]]), 30 + WINDOW, WINDOW);
    expect(stats.survival).toBe(1);
    expect(stats.shadowSurvival).toBe(0);
  });

  it('judges links after the same number of ticks however far apart the samples are', () => {
    const judged = (spacing: number) => {
      const tally = createWiringTally();
      sampleWiring(tally, population([[1]], [[1]]), 0, WINDOW);
      let stats = sampleWiring(tally, population([[1, 2]], [[1]]), spacing, WINDOW);
      for (let tick = 2 * spacing; tick <= spacing + WINDOW; tick += spacing) stats = sampleWiring(tally, population([[1, 2]], [[1]]), tick, WINDOW);
      return { stats, samples: tally.samples };
    };
    const close = judged(30);
    const apart = judged(60);
    expect(close.stats.survival).toBe(1);
    expect(apart.stats.survival).toBe(1);
    expect(apart.samples).toBeLessThan(close.samples);
  });
});

describe('reseeded founders', () => {
  it('do not count as new wiring, really or in the shadow', () => {
    const tally = createWiringTally();
    sampleWiring(tally, population([[1]], [[1]]), 0, WINDOW);
    // A founder brings in link 5 from outside; a mutation makes link 6.
    markFounding(tally, { links: [link(1), link(5)] });
    let stats = sampleWiring(tally, population([[1, 5, 6]], [[1, 5, 6]]), 30, WINDOW);
    stats = sampleWiring(tally, population([[1]], [[1]]), 30 + WINDOW, WINDOW);
    // Only link 6 is judged, and it was lost on both sides.
    expect(tally.realFirst.get(5)).toBe(0);
    expect(stats.survival).toBe(0);
    expect(stats.shadowSurvival).toBe(0);
    stats = sampleWiring(tally, population([[1, 6]], [[1, 6]]), 31 + WINDOW, WINDOW);
    expect(stats.survival).toBe(1);
  });
});

describe('neutral shadow in a world', () => {
  const small: SimConfig = {
    ...defaultConfig,
    worldWidth: 800,
    worldHeight: 800,
    initialCreatures: 80,
    seed: 'shadow',
  };

  it('gives every creature a shadow, newborns copying a random creature plus their own new links', () => {
    const world = createWorld(small);
    for (let t = 0; t < 600; t++) step(world);
    expect(world.creatures.shadow).toHaveLength(world.creatures.count);
    expect(world.births).toBeGreaterThan(0);
    for (let i = 0; i < world.creatures.count; i++) {
      const shadow = world.creatures.shadow[i]!;
      expect(new Set(shadow).size).toBe(shadow.length);
    }
    expect(world.wiring.real.size).toBeGreaterThan(0);
    expect(world.wiring.shadow.size).toBeGreaterThan(0);
  });

  it('copies newborns\' shadows only from creatures old enough to breed', () => {
    const world = createWorld(small);
    const { creatures, config } = world;
    let checked = 0;
    for (let t = 0; t < 600; t++) {
      // Shadows of the creatures old enough to donate, before this tick's births.
      const donors = [];
      for (let i = 0; i < creatures.count; i++) if (creatures.age[i]! >= config.minReproduceAge) donors.push(creatures.shadow[i]!.join(','));
      const known = new Set(creatures.id.slice(0, creatures.count));
      step(world);
      for (let i = 0; i < creatures.count; i++) {
        if (known.has(creatures.id[i]!) || creatures.parentId[i] === 0) continue;
        const shadow = creatures.shadow[i]!.join(',');
        expect(donors.some((d) => shadow === d || shadow.startsWith(`${d},`))).toBe(true);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(10);
  });

  it('is saved and loaded, so a loaded world continues exactly as the original', () => {
    const world = createWorld(small);
    for (let t = 0; t < 400; t++) step(world);
    const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
    expect(copy.wiring.real).toEqual(world.wiring.real);
    expect(copy.creatures.shadow.slice(0, copy.creatures.count)).toEqual(world.creatures.shadow.slice(0, world.creatures.count));
    for (let t = 0; t < 200; t++) {
      step(world);
      step(copy);
    }
    expect(hashWorld(copy)).toBe(hashWorld(world));
  });
});
