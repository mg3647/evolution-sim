import { describe, expect, it } from 'vitest';
import { compileBrain, crossoverBrain, Input, INPUT_COUNT, Output, type LinkGene } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { expectedEnergy } from './ledger';
import { crossGenes, founderGenes, maxEnergyFor, type Genes } from './genome';
import { mateDistance } from './mating';
import { Rng } from './rng';
import { createWorld, step, totalEnergy, type World } from './world';

const link = (innovation: number, from: number, to: number, weight: number, extra: Partial<LinkGene> = {}): LinkGene => ({
  innovation,
  from,
  to,
  weight,
  enabled: true,
  plasticity: 0,
  ...extra,
});

const HIDDEN = INPUT_COUNT + 12;

describe('crossing brains', () => {
  it('gives the child a subset of one parent’s links, in that parent’s structure', () => {
    const a = compileBrain([link(1, 0, INPUT_COUNT, 1), link(2, 1, INPUT_COUNT, 1)], []);
    const b = compileBrain([link(1, 0, INPUT_COUNT, -1), link(3, 2, INPUT_COUNT, 1)], []);
    const donors = new Set<string>();
    for (let k = 0; k < 60; k++) {
      const child = crossoverBrain(a, b, new Rng(`cross${k}`));
      const ids = child.links.map((l) => l.innovation).sort();
      donors.add(ids.join(','));
      expect(ids.length).toBe(2);
      // The shared link comes whole from one parent or the other.
      const shared = child.links.find((l) => l.innovation === 1)!;
      expect([1, -1]).toContain(shared.weight);
    }
    // Either parent can be the donor: one has links 1 and 2, the other 1 and 3.
    expect([...donors].sort()).toEqual(['1,2', '1,3']);
  });

  it('keeps the donor’s hidden neurons and their time constants', () => {
    const a = compileBrain(
      [link(1, 0, HIDDEN, 1), link(2, HIDDEN, INPUT_COUNT, 1)],
      [HIDDEN],
      [7],
    );
    const b = compileBrain([link(1, 0, INPUT_COUNT, 1)], []);
    let sawHidden = false;
    for (let k = 0; k < 40; k++) {
      const child = crossoverBrain(a, b, new Rng(`hidden${k}`));
      if (child.hiddenIds.length > 0) {
        sawHidden = true;
        expect(child.hiddenIds).toEqual([HIDDEN]);
        expect(child.hiddenTau).toEqual([7]);
        // Every link's ends exist in the child.
        for (const l of child.links) {
          for (const end of [l.from, l.to]) expect(end < INPUT_COUNT + 12 || child.hiddenIds.includes(end)).toBe(true);
        }
      } else {
        expect(child.hiddenTau).toEqual([]);
      }
    }
    expect(sawHidden).toBe(true);
  });

  it('keeps a weight and its learning rate together', () => {
    const a = compileBrain([link(1, 0, INPUT_COUNT, 1, { plasticity: 0.01 })], []);
    const b = compileBrain([link(1, 0, INPUT_COUNT, 2, { plasticity: 0.04 })], []);
    for (let k = 0; k < 30; k++) {
      const l = crossoverBrain(a, b, new Rng(`pair${k}`)).links[0]!;
      expect([`1/0.01`, `2/0.04`]).toContain(`${l.weight}/${l.plasticity}`);
    }
  });

  it('switches a link off three times in four if either parent had it off', () => {
    const on = compileBrain([link(1, 0, INPUT_COUNT, 1)], []);
    const off = compileBrain([link(1, 0, INPUT_COUNT, 1, { enabled: false })], []);
    let disabled = 0;
    const trials = 2000;
    for (let k = 0; k < trials; k++) {
      if (!crossoverBrain(on, off, new Rng(`off${k}`)).links[0]!.enabled) disabled++;
    }
    expect(disabled / trials).toBeGreaterThan(0.7);
    expect(disabled / trials).toBeLessThan(0.8);
    // On in both stays on.
    expect(crossoverBrain(on, on, new Rng('on')).links[0]!.enabled).toBe(true);
  });

  it('does not change its parents', () => {
    const a = compileBrain([link(1, 0, INPUT_COUNT, 1)], []);
    const b = compileBrain([link(1, 0, INPUT_COUNT, -1, { enabled: false })], []);
    crossoverBrain(a, b, new Rng('pure'));
    expect(a.links[0]!.enabled).toBe(true);
    expect(b.links[0]!.weight).toBe(-1);
  });
});

describe('crossing genes', () => {
  const base = founderGenes(new Rng('g'), defaultConfig);
  it('takes each gene whole from one parent, and averages the mutation rate', () => {
    const a: Genes = { ...base, size: 1, speed: 1, mutationRate: 0.1 };
    const b: Genes = { ...base, size: 2, speed: 2, mutationRate: 0.3 };
    const seen = new Set<string>();
    for (let k = 0; k < 40; k++) {
      const c = crossGenes(a, b, new Rng(`genes${k}`));
      expect([1, 2]).toContain(c.size);
      expect([1, 2]).toContain(c.speed);
      expect(c.mutationRate).toBeCloseTo(0.2, 6);
      seen.add(`${c.size}${c.speed}`);
    }
    // Size and speed are inherited independently.
    expect(seen.size).toBe(4);
  });
});

describe('how alike two creatures are', () => {
  const genes = founderGenes(new Rng('d'), defaultConfig);
  const brain = compileBrain([link(1, 0, INPUT_COUNT, 1), link(2, 1, INPUT_COUNT, 1)], []);
  it('is zero for a creature and itself, and grows with body and wiring differences', () => {
    expect(mateDistance(genes, brain, genes, brain)).toBe(0);
    const bigger = { ...genes, size: genes.size * 2 };
    expect(mateDistance(genes, brain, bigger, brain)).toBeGreaterThan(1);
    const other = compileBrain([link(3, 2, INPUT_COUNT, 1), link(4, 3, INPUT_COUNT, 1)], []);
    expect(mateDistance(genes, brain, genes, other)).toBeCloseTo(1, 6);
    const heavier = compileBrain([link(1, 0, INPUT_COUNT, 3), link(2, 1, INPUT_COUNT, 1)], []);
    expect(mateDistance(genes, brain, genes, heavier)).toBeGreaterThan(0);
    expect(mateDistance(genes, brain, genes, heavier)).toBeLessThan(1);
  });
});

/** A world of two fully fed, grown creatures standing side by side. */
function pairWorld(overrides: Partial<SimConfig>): World {
  const world = createWorld({
    ...defaultConfig,
    worldWidth: 400,
    worldHeight: 400,
    initialCreatures: 2,
    minPopulation: 0,
    plantCapacity: 0,
    reproduceThreshold: 0.5,
    minReproduceAge: 0,
    randomEvents: false,
    ...overrides,
  });
  const { creatures: c } = world;
  c.x[0] = 200;
  c.y[0] = 200;
  c.x[1] = 208;
  c.y[1] = 200;
  for (let i = 0; i < 2; i++) {
    c.energy[i] = maxEnergyFor(c.size[i]!, world.config);
    c.heading[i] = 0;
    c.brain[i] = compileBrain([], []);
  }
  return world;
}

describe('mating in the world', () => {
  it('gives a child of two parents, in a world where only mating breeds', () => {
    const world = pairWorld({ reproductionMode: 2 });
    const { creatures: c } = world;
    const ids = [c.id[0]!, c.id[1]!];
    // The creatures were handed their energy, so only changes since now are accounted for.
    const energyBefore = totalEnergy(world) - expectedEnergy(world.ledger);
    step(world);
    expect(world.mating.sexual).toBe(1);
    expect(world.births).toBe(1);
    const child = c.count - 1;
    expect([c.parentId[child], c.otherParentId[child]].sort()).toEqual(ids.slice().sort());
    expect(c.generation[child]).toBe(1);
    expect(totalEnergy(world) - expectedEnergy(world.ledger)).toBeCloseTo(energyBefore, 6);
  });

  it('does not mate in a world that breeds alone, and the Mate output is ignored there', () => {
    const world = pairWorld({ reproductionMode: 0 });
    step(world);
    expect(world.mating.sexual).toBe(0);
    // Each is willing to breed alone (Reproduce unwired reads as on).
    expect(world.births).toBe(2);
  });

  it('does not breed alone when only mating is allowed and no mate is near', () => {
    const world = pairWorld({ reproductionMode: 2 });
    world.creatures.x[1] = 300;
    step(world);
    expect(world.births).toBe(0);
  });

  it('keeps a creature that wants a mate waiting for one, even if it could breed alone', () => {
    const world = pairWorld({ reproductionMode: 1 });
    world.creatures.x[1] = 300;
    step(world);
    expect(world.mating.sexual).toBe(0);
    expect(world.births).toBe(0);
    // A creature that does not want a mate breeds alone in the same world.
    const away = pairWorld({ reproductionMode: 1 });
    away.creatures.x[1] = 300;
    for (let i = 0; i < 2; i++) away.creatures.brain[i] = compileBrain([link(0, Input.Bias, INPUT_COUNT + Output.Mate, -3)], []);
    step(away);
    expect(away.births).toBe(2);
  });

  it('mates only within the mating reach', () => {
    const near = pairWorld({ reproductionMode: 2, mateReach: 20 });
    near.creatures.x[1] = 230;
    step(near);
    expect(near.births).toBe(0);
    const far = pairWorld({ reproductionMode: 2, mateReach: 40 });
    far.creatures.x[1] = 230;
    step(far);
    expect(far.mating.sexual).toBe(1);
  });

  it('lets a creature refuse: Mate switched off means no mating', () => {
    const world = pairWorld({ reproductionMode: 2 });
    world.creatures.brain[1] = compileBrain(
      [link(0, Input.Bias, INPUT_COUNT + Output.Mate, -3)],
      [],
    );
    step(world);
    expect(world.births).toBe(0);
  });

  it('keeps unlike creatures apart when the world sets a limit', () => {
    const world = pairWorld({ reproductionMode: 2, mateBarrier: 1 });
    world.creatures.diet[1] = 1;
    world.creatures.diet[0] = 0;
    step(world);
    expect(world.births).toBe(0);
    const open = pairWorld({ reproductionMode: 2, mateBarrier: 1 });
    for (const key of ['size', 'speed', 'sensorRange', 'diet', 'fur', 'defense'] as const) {
      open.creatures[key][1] = open.creatures[key][0]!;
    }
    step(open);
    expect(open.mating.sexual).toBe(1);
  });

  it('counts a mating between parent and child as kin', () => {
    const world = pairWorld({ reproductionMode: 2 });
    const { creatures: c } = world;
    c.parentId[1] = c.id[0]!;
    step(world);
    expect(world.mating.kin).toBe(1);
  });

  it('runs on, repeatably, in a crowd', () => {
    const run = () => {
      const world = createWorld({
        ...defaultConfig,
        worldWidth: 400,
        worldHeight: 400,
        initialCreatures: 150,
        minPopulation: 5,
        reproductionMode: 1,
        seed: 'mix',
      });
      for (let i = 0; i < 2500; i++) step(world);
      return world;
    };
    const one = run();
    const two = run();
    expect(one.mating.sexual).toBe(two.mating.sexual);
    expect(one.births).toBe(two.births);
    expect(one.mating.sexual).toBeGreaterThan(0);
    expect(totalEnergy(one)).toBeCloseTo(expectedEnergy(one.ledger), 4);
    for (let i = 0; i < one.creatures.count; i++) {
      const brain = one.creatures.brain[i]!;
      expect(brain.links.length).toBeLessThanOrEqual(one.config.maxLinks);
      expect(brain.hiddenIds.length).toBeLessThanOrEqual(one.config.maxHiddenNeurons);
    }
  });
});

