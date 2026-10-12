import { describe, expect, it } from 'vitest';
import { compileBrain } from './brain';
import { defaultConfig } from './config';
import { createCreatures, removeCreature, spawnCreature, type Creatures } from './creatures';
import type { Genes } from './genome';
import { Lineage } from './lineage';
import { classifySpecies, createSpeciesState } from './species';
import { INPUT_COUNT } from './brain';
import { createWorld, step } from './world';

// Fixed settings, so these tests do not move when the defaults are retuned.
const config = { ...defaultConfig, speciesThreshold: 1, speciesMinAge: 1000, speciesMinMembers: 3 };
const NOW = 5000;
const baseGenes: Genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.1, hue: 0.5, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 };

/** A population and its family tree, built by hand. */
function setup() {
  const c = createCreatures(64);
  const lineage = new Lineage();
  /** Add a living creature born to `parentId` (0 for none) at `tick`. Returns its id. */
  const born = (parentId: number, tick: number, genes: Partial<Genes> = {}): number => {
    const i = spawnCreature(c, {
      x: 0,
      y: 0,
      heading: 0,
      energy: 1,
      genes: { ...baseGenes, ...genes },
      brain: compileBrain([], []),
      species: parentId === 0 ? 0 : speciesOf(c, parentId),
    });
    lineage.born(c.id[i]!, parentId, tick, 0.5);
    return c.id[i]!;
  };
  /** Add `count` children of `parentId`. */
  const family = (parentId: number, tick: number, count: number, genes: Partial<Genes> = {}) =>
    Array.from({ length: count }, () => born(parentId, tick, genes));
  const state = createSpeciesState();
  const classify = (tick = NOW) => classifySpecies(state, c, lineage, tick, config);
  return { c, lineage, born, family, state, classify };
}

function speciesOf(c: Creatures, id: number): number {
  for (let i = 0; i < c.count; i++) if (c.id[i] === id) return c.species[i]!;
  return 0;
}

function speciesSet(c: Creatures, ids: number[]): Set<number> {
  return new Set(ids.map((id) => speciesOf(c, id)));
}

describe('classifySpecies', () => {
  it('keeps unrelated but alike founders in one species', () => {
    const { c, born, state, classify } = setup();
    const ids = [born(0, 0), born(0, 0, { size: 1.03 }), born(0, 0, { diet: 0.12 }), born(0, 0)];
    classify();
    expect(state.species).toHaveLength(1);
    expect(state.species[0]!.count).toBe(4);
    expect(speciesSet(c, ids).size).toBe(1);
  });

  it('splits off an old branch whose members have become different', () => {
    const { c, born, family, state, classify } = setup();
    const founder = born(0, 0);
    const grazers = family(founder, 100, 4);
    const hunterRoot = born(founder, 200, { diet: 0.9, size: 1.5 });
    const hunters = family(hunterRoot, 300, 4, { diet: 0.9, size: 1.5 });
    classify();
    expect(state.species).toHaveLength(2);
    expect(speciesSet(c, grazers).size).toBe(1);
    expect(speciesSet(c, [hunterRoot, ...hunters]).size).toBe(1);
    expect(speciesOf(c, hunters[0]!)).not.toBe(speciesOf(c, grazers[0]!));
    // The founder stays with the group the hunters left.
    expect(speciesOf(c, founder)).toBe(speciesOf(c, grazers[0]!));
  });

  it('does not split a branch that is different but too recent', () => {
    const { born, family, state, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 4);
    const hunterRoot = born(founder, NOW - 200, { diet: 0.9 });
    family(hunterRoot, NOW - 100, 4, { diet: 0.9 });
    classify();
    expect(state.species).toHaveLength(1);
  });

  it('does not split a branch that is old but still alike', () => {
    const { born, family, state, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 4);
    const cousinRoot = born(founder, 200, { size: 1.02 });
    family(cousinRoot, 300, 4, { size: 1.02 });
    classify();
    expect(state.species).toHaveLength(1);
  });

  it('does not split off a branch with too few members, or leave too few behind', () => {
    const { born, family, state, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 6);
    born(founder, 200, { diet: 0.9 });
    classify();
    expect(state.species).toHaveLength(1);

    const small = setup();
    const root = small.born(0, 0);
    const hunterRoot = small.born(root, 200, { diet: 0.9 });
    small.family(hunterRoot, 300, 6, { diet: 0.9 });
    small.classify();
    expect(small.state.species).toHaveLength(1);
  });

  it('can split a species out of a species', () => {
    const { c, born, family, state, classify } = setup();
    const founder = born(0, 0);
    const grazers = family(founder, 100, 5);
    const hunterRoot = born(founder, 200, { diet: 0.9 });
    const hunters = family(hunterRoot, 300, 5, { diet: 0.9 });
    const giantRoot = born(hunterRoot, 400, { diet: 0.9, size: 2.5 });
    const giants = family(giantRoot, 500, 5, { diet: 0.9, size: 2.5 });
    classify();
    expect(state.species).toHaveLength(3);
    const ids = [speciesOf(c, grazers[0]!), speciesOf(c, hunters[0]!), speciesOf(c, giants[0]!)];
    expect(new Set(ids).size).toBe(3);
  });

  it('keeps species ids and birth ticks stable from one grouping to the next', () => {
    const { c, born, family, state, classify } = setup();
    const founder = born(0, 0);
    const grazers = family(founder, 100, 4);
    const hunterRoot = born(founder, 200, { diet: 0.9 });
    const hunters = family(hunterRoot, 300, 4, { diet: 0.9 });
    classify(NOW);
    const before = [speciesOf(c, grazers[0]!), speciesOf(c, hunters[0]!)];
    const bornTicks = state.species.map((s) => s.bornTick);
    classify(NOW + 300);
    expect([speciesOf(c, grazers[0]!), speciesOf(c, hunters[0]!)]).toEqual(before);
    expect(state.species.map((s) => s.bornTick)).toEqual(bornTicks);
  });

  it('keeps a species id when the ancestor at the base of its branch is pruned away', () => {
    const { c, lineage, born, family, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 4);
    const hunterRoot = born(founder, 200, { diet: 0.9 });
    const hunters = family(hunterRoot, 300, 4, { diet: 0.9 });
    classify(NOW);
    const before = speciesOf(c, hunters[0]!);
    // The branch's base dies; the tree keeps it only as a fork, with no creature behind it.
    for (let i = 0; i < c.count; i++) {
      if (c.id[i] === hunterRoot) {
        lineage.died(hunterRoot, NOW + 10);
        removeCreature(c, i);
        break;
      }
    }
    classify(NOW + 300);
    expect(speciesOf(c, hunters[0]!)).toBe(before);
  });

  it('drops a species when its members are gone', () => {
    const { c, lineage, born, family, state, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 4);
    const hunterRoot = born(founder, 200, { diet: 0.9 });
    const hunters = [hunterRoot, ...family(hunterRoot, 300, 4, { diet: 0.9 })];
    classify(NOW);
    expect(state.species).toHaveLength(2);
    for (const id of hunters) {
      for (let i = 0; i < c.count; i++) {
        if (c.id[i] === id) {
          lineage.died(id, NOW + 10);
          removeCreature(c, i);
          break;
        }
      }
    }
    classify(NOW + 300);
    expect(state.species).toHaveLength(1);
  });

  it('labels the family tree with the same species as the creatures', () => {
    const { c, lineage, born, family, classify } = setup();
    const founder = born(0, 0);
    family(founder, 100, 4);
    const hunterRoot = born(founder, 200, { diet: 0.9 });
    family(hunterRoot, 300, 4, { diet: 0.9 });
    classify();
    for (let i = 0; i < c.count; i++) expect(lineage.get(c.id[i]!)!.species).toBe(c.species[i]);
  });

  it('handles an empty world', () => {
    const { state, classify } = setup();
    classify();
    expect(state.species).toEqual([]);
  });
});

describe('species in a running world', () => {
  it('gives every creature a living species, children included', () => {
    const world = createWorld({ ...defaultConfig, worldWidth: 800, worldHeight: 800, initialCreatures: 80 });
    for (let t = 0; t < 900; t++) step(world);
    const { creatures, species } = world;
    const ids = new Set(species.species.map((s) => s.id));
    expect(ids.size).toBeGreaterThan(0);
    for (let i = 0; i < creatures.count; i++) expect(creatures.species[i]).toBeGreaterThan(0);
    expect(world.history.speciesCount[world.history.count - 1]).toBe(species.species.length);
  });
});

describe('species and brain wiring', () => {
  const link = (innovation: number, weight = 1) => ({ innovation, from: 0, to: INPUT_COUNT, weight, enabled: true });

  /** Two old branches with the same bodies; the second wires its members with different links. */
  function twoBranches(weightsOfSecond: number, linksOfSecond: number[]) {
    const t = setup();
    const founder = t.born(0, 0);
    const first = t.family(founder, 100, 4);
    const secondRoot = t.born(founder, 200);
    const second = t.family(secondRoot, 300, 4);
    const wire = (ids: number[], links: number[], weight: number) => {
      for (const id of ids) {
        const i = [...Array(t.c.count).keys()].find((k) => t.c.id[k] === id)!;
        t.c.brain[i] = compileBrain(links.map((n) => link(n, weight)), []);
      }
    };
    wire([founder, ...first], [1, 2, 3, 4], 1);
    wire([secondRoot, ...second], linksOfSecond, weightsOfSecond);
    return t;
  }

  it('ignores the brain at the default of 0', () => {
    const t = twoBranches(1, [10, 11, 12, 13]);
    classifySpecies(t.state, t.c, t.lineage, NOW, { ...config, speciesBrainScale: 0 });
    expect(t.state.species).toHaveLength(1);
  });

  it('splits two branches with the same bodies but different wiring', () => {
    const t = twoBranches(1, [10, 11, 12, 13]);
    classifySpecies(t.state, t.c, t.lineage, NOW, { ...config, speciesBrainScale: 1 });
    expect(t.state.species).toHaveLength(2);
  });

  it('keeps branches together when their wiring is the same', () => {
    const t = twoBranches(1, [1, 2, 3, 4]);
    classifySpecies(t.state, t.c, t.lineage, NOW, { ...config, speciesBrainScale: 1 });
    expect(t.state.species).toHaveLength(1);
  });

  it('counts a change in the weights of shared links', () => {
    const t = twoBranches(-3, [1, 2, 3, 4]);
    classifySpecies(t.state, t.c, t.lineage, NOW, { ...config, speciesBrainScale: 0.5 });
    expect(t.state.species).toHaveLength(2);
  });
});
