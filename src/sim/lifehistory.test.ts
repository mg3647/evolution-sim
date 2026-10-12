import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, Output } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { spawnCreature } from './creatures';
import { bodyEnergyFor, crossGenes, founderGenes, maxEnergyFor, mutateGenes, type Genes } from './genome';
import { Rng } from './rng';
import { createWorld, step } from './world';

/** An empty, plain, still world with no food: creatures placed by hand are all that is in it. */
const arena: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  initialCreatures: 0,
  minPopulation: 0,
  minReproduceAge: 0,
  temperatureStrength: 0,
  camouflage: 0,
  dayLength: 0,
  seasonLength: 0,
  fertilityDriftPeriod: 0,
  attackDamage: 0,
};

/** Stands still and always wants a child. */
const breeder = () =>
  compileBrain(
    [
      { innovation: 0, from: Input.Bias, to: INPUT_COUNT + Output.Reproduce, weight: 5, enabled: true },
      { innovation: 1, from: Input.Bias, to: INPUT_COUNT + Output.Thrust, weight: -5, enabled: true },
    ],
    [],
  );

const base: Genes = { size: 1, speed: 1, sensorRange: 1, diet: 0, hue: 0.5, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 };

function lone(genes: Partial<Genes>, energy: number) {
  const world = createWorld(arena);
  const i = spawnCreature(world.creatures, { x: 200, y: 200, heading: 0, energy, genes: { ...base, ...genes }, brain: breeder() });
  return { world, id: world.creatures.id[i]! };
}

describe('the life-history genes', () => {
  it('start at the settings and stay within their limits', () => {
    const rng = new Rng('life');
    const config = { ...defaultConfig, initialMutationRate: 0.5 };
    let genes = founderGenes(rng, config);
    expect(Math.abs(genes.investment - config.offspringShare)).toBeLessThan(0.5);
    for (let k = 0; k < 2000; k++) {
      genes = mutateGenes(genes, rng, config);
      expect(genes.investment).toBeGreaterThanOrEqual(Math.fround(config.minInvestment));
      expect(genes.investment).toBeLessThanOrEqual(Math.fround(config.maxInvestment));
      expect(genes.readiness).toBeGreaterThanOrEqual(Math.fround(config.minReadiness));
      expect(genes.readiness).toBeLessThanOrEqual(Math.fround(config.maxReadiness));
    }
  });

  it('come whole from one parent or the other', () => {
    const rng = new Rng('cross');
    const a = { ...base, investment: 0.2, readiness: 0.4 };
    const b = { ...base, investment: 0.8, readiness: 0.9 };
    const seen = new Set<number>();
    for (let k = 0; k < 50; k++) {
      const child = crossGenes(a, b, rng);
      expect([0.2, 0.8]).toContain(child.investment);
      expect([0.4, 0.9]).toContain(child.readiness);
      seen.add(child.investment);
    }
    expect(seen.size).toBe(2);
  });

  it('stay at the settings when switched off, using the same random numbers', () => {
    const off = { ...defaultConfig, lifeHistoryMutates: false };
    const a = new Rng('same');
    const b = new Rng('same');
    const parent = { ...base, investment: 0.3, readiness: 0.5 };
    for (let k = 0; k < 20; k++) {
      const fixed = mutateGenes(parent, a, off);
      const free = mutateGenes(parent, b, defaultConfig);
      expect(fixed.investment).toBe(Math.fround(off.offspringShare));
      expect(fixed.readiness).toBe(Math.fround(off.reproduceThreshold));
      expect(fixed.size).toBe(free.size);
    }
  });

  it('let a creature breed once it is as full as its own readiness', () => {
    const full = maxEnergyFor(1, arena);
    // Half full: ready at 0.4, not at 0.8. It gives most of what it has, so the gift can build a body.
    expect(step1(lone({ readiness: 0.4, investment: 0.9 }, 0.5 * full)).births).toBe(1);
    expect(step1(lone({ readiness: 0.8, investment: 0.9 }, 0.5 * full)).births).toBe(0);
  });

  it('hand each child the parent’s own share of its energy', () => {
    const full = maxEnergyFor(1, arena);
    const childStart = (investment: number) => {
      const { world, id } = lone({ investment, readiness: 0.5 }, 0.9 * full);
      step(world);
      const c = world.creatures;
      expect(world.births).toBe(1);
      for (let i = 0; i < c.count; i++) if (c.id[i] !== id) return c.energy[i]!;
      return NaN;
    };
    const small = childStart(0.4);
    const big = childStart(0.8);
    expect(big).toBeGreaterThan(small + 20);
    // What is given, less the heat lost, builds the body; the rest is the child's store.
    // (The parent pays this tick's upkeep first, so it gives a little less than this.)
    const given = 0.8 * 0.9 * full;
    const expected = given * (1 - arena.birthCost) - bodyEnergyFor(1, arena);
    expect(big).toBeLessThanOrEqual(expected);
    expect(big).toBeGreaterThan(expected - 2);
  });

  it('count a gift too small to build a body, and no child comes of it', () => {
    const full = maxEnergyFor(1, arena);
    const { world } = lone({ investment: 0.1, readiness: 0.5 }, 0.6 * full);
    step(world);
    expect(world.births).toBe(0);
    expect(world.lifeHistory.tooSmall).toBe(1);
  });

  it('can hold off all births with a readiness setting above full', () => {
    const world = createWorld({ ...defaultConfig, worldWidth: 800, worldHeight: 800, initialCreatures: 60, reproduceThreshold: 2 });
    for (let t = 0; t < 600; t++) step(world);
    expect(world.births).toBe(0);
  });
});

function step1({ world }: { world: ReturnType<typeof createWorld> }) {
  step(world);
  return world;
}
