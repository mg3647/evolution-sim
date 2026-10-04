import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { biteFor, founderGenes, maxEnergyFor, mutateGenes, tickCostFor, type Genes } from './genome';
import { Rng } from './rng';

const config = defaultConfig;
const base: Genes = { size: 1, speed: 1, sensorRange: 1, hue: 0.5, mutationRate: 0.1 };

describe('mutateGenes', () => {
  it('is repeatable for a seed and leaves the parent untouched', () => {
    const parent = { ...base };
    expect(mutateGenes(parent, new Rng('m'), config)).toEqual(mutateGenes(parent, new Rng('m'), config));
    expect(parent).toEqual(base);
  });

  it('makes small changes centred on the parent', () => {
    const rng = new Rng('spread');
    let sizeLog = 0;
    const n = 4000;
    for (let i = 0; i < n; i++) {
      const child = mutateGenes(base, rng, config);
      expect(Math.abs(Math.log(child.size))).toBeLessThan(0.1 * 6);
      sizeLog += Math.log(child.size);
    }
    expect(sizeLog / n).toBeCloseTo(0, 1);
  });

  it('keeps every gene inside its limits over many generations', () => {
    const rng = new Rng('limits');
    let genes: Genes = { ...base, mutationRate: config.maxMutationRate };
    for (let i = 0; i < 5000; i++) {
      genes = mutateGenes(genes, rng, config);
      expect(genes.size).toBeGreaterThanOrEqual(config.minSize);
      expect(genes.size).toBeLessThanOrEqual(config.maxSize);
      expect(genes.speed).toBeGreaterThanOrEqual(config.minSpeed);
      expect(genes.speed).toBeLessThanOrEqual(config.maxSpeed);
      expect(genes.sensorRange).toBeGreaterThanOrEqual(config.minSensorRange);
      expect(genes.sensorRange).toBeLessThanOrEqual(config.maxSensorRange);
      expect(genes.hue).toBeGreaterThanOrEqual(0);
      expect(genes.hue).toBeLessThan(1);
      expect(genes.mutationRate).toBeGreaterThanOrEqual(config.minMutationRate);
      expect(genes.mutationRate).toBeLessThanOrEqual(config.maxMutationRate);
    }
  });

  it('gives founders near-average traits and varied colours', () => {
    const rng = new Rng('founders');
    const hues = new Set<number>();
    for (let i = 0; i < 50; i++) {
      const genes = founderGenes(rng, config);
      expect(genes.size).toBeGreaterThan(0.5);
      expect(genes.size).toBeLessThan(2);
      hues.add(Math.floor(genes.hue * 10));
    }
    expect(hues.size).toBeGreaterThan(5);
  });
});

describe('trait costs', () => {
  it('matches the base config values at size 1 and speed 1', () => {
    expect(maxEnergyFor(1, config)).toBe(config.creatureMaxEnergy);
    expect(biteFor(1, config)).toBe(config.biteSize);
    expect(tickCostFor(1, 1, 1, config)).toBeCloseTo(
      config.upkeepCost + config.moveCost * config.creatureSpeed,
      12,
    );
  });

  it('charges more for bigger and for faster bodies', () => {
    expect(tickCostFor(2, 1, 1, config)).toBeGreaterThan(tickCostFor(1, 1, 1, config));
    expect(tickCostFor(1, 2, 1, config)).toBeGreaterThan(tickCostFor(1, 1, 1, config));
  });

  it('charges nothing for movement at zero thrust, and more per distance for a faster body', () => {
    expect(tickCostFor(1, 3, 0, config)).toBe(tickCostFor(1, 1, 0, config));
    // Same distance covered: speed 2 at half thrust against speed 1 at full thrust.
    expect(tickCostFor(1, 2, 0.5, config)).toBeGreaterThan(tickCostFor(1, 1, 1, config));
  });

  it('makes upkeep per unit of bite fall as size grows', () => {
    const upkeepOnly = { ...config, moveCost: 0 };
    const perBite = (size: number) => tickCostFor(size, 1, 1, upkeepOnly) / biteFor(size, upkeepOnly);
    expect(perBite(2)).toBeLessThan(perBite(1));
  });
});
