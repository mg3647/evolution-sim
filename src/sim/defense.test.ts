import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, Output } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { spawnCreature } from './creatures';
import { defenseCostFor, founderGenes, mutateGenes, upkeepFor } from './genome';
import { expectedEnergy } from './ledger';
import { Rng } from './rng';
import { createWorld, step, totalEnergy } from './world';

/** An empty, plain, still world: two creatures placed by hand are all that is in it. */
const arena: SimConfig = {
  ...defaultConfig,
  worldWidth: 400,
  worldHeight: 400,
  waterShare: 0,
  initialCreatures: 0,
  minPopulation: 0,
  reproduceThreshold: 2,
  temperatureStrength: 0,
  camouflage: 0,
  dayLength: 0,
  seasonLength: 0,
  fertilityDriftPeriod: 0,
  healRate: 0,
};

/** A brain that always bites and never moves, and one that does nothing at all. */
const biter = () =>
  compileBrain(
    [
      { innovation: 0, from: Input.Bias, to: INPUT_COUNT + Output.Attack, weight: 5, enabled: true },
      { innovation: 1, from: Input.Bias, to: INPUT_COUNT + Output.Thrust, weight: -5, enabled: true },
    ],
    [],
  );
const idler = () =>
  compileBrain([{ innovation: 1, from: Input.Bias, to: INPUT_COUNT + Output.Thrust, weight: -5, enabled: true }], []);

function duel(defense: number, overrides: Partial<SimConfig> = {}, victimSize = 1) {
  const world = createWorld({ ...arena, ...overrides });
  const genes = { size: 1, speed: 1, sensorRange: 1, diet: 1, hue: 0.9, fur: 0, defense: 0, mutationRate: 0.05 };
  const attacker = spawnCreature(world.creatures, { x: 200, y: 200, heading: 0, energy: 50, genes, brain: biter() });
  const victim = spawnCreature(world.creatures, {
    x: 200 + world.config.creatureRadius * (1 + victimSize) + 2,
    y: 200,
    heading: 0,
    energy: 50,
    genes: { ...genes, size: victimSize, diet: 0, hue: 0.4, defense },
    brain: idler(),
  });
  world.ledger.initial = totalEnergy(world);
  return { world, attacker, victim };
}

describe('the defense gene', () => {
  it('starts at none, stays between 0 and 1, and can grow', () => {
    const rng = new Rng('spines');
    let genes = founderGenes(rng, defaultConfig);
    expect(genes.defense).toBeLessThan(0.5);
    let most = 0;
    for (let k = 0; k < 2000; k++) {
      genes = mutateGenes({ ...genes, mutationRate: 0.3 }, rng, defaultConfig);
      expect(genes.defense).toBeGreaterThanOrEqual(0);
      expect(genes.defense).toBeLessThanOrEqual(1);
      most = Math.max(most, genes.defense);
    }
    expect(most).toBeGreaterThan(0.5);
  });

  it('costs energy in proportion to how strong it is', () => {
    expect(defenseCostFor(1, 0, defaultConfig)).toBe(0);
    expect(defenseCostFor(1, 1, defaultConfig)).toBeCloseTo(upkeepFor(1, defaultConfig) * defaultConfig.defenseCost, 9);
    expect(defenseCostFor(2, 0.5, defaultConfig)).toBeGreaterThan(defenseCostFor(1, 0.5, defaultConfig));
  });
});

describe('biting a defended creature', () => {
  it('hurts the biter, and gives it pain to learn from', () => {
    const { world, attacker } = duel(1);
    step(world);
    expect(world.creatures.health[attacker]).toBeCloseTo(1 - world.config.defenseDamage, 5);
    expect(world.creatures.pain[attacker]).toBeCloseTo(world.config.defenseDamage, 5);
    expect(world.defended).toBeCloseTo(world.config.defenseDamage, 5);
  });

  it('does not hurt the biter of an undefended creature', () => {
    const { world, attacker } = duel(0);
    step(world);
    expect(world.creatures.health[attacker]).toBe(1);
    expect(world.defended).toBe(0);
  });

  it('still hurts the one bitten', () => {
    const { world, victim } = duel(1);
    step(world);
    expect(world.creatures.health[victim]).toBeLessThan(1);
  });

  it('hurts a small biter more than a big one', () => {
    // The biter is size 1 in both: big next to a victim of half its size, small next to one twice its size.
    const big = duel(1, {}, 0.5);
    const small = duel(1, {}, 2);
    step(big.world);
    step(small.world);
    expect(1 - small.world.creatures.health[small.attacker]!).toBeGreaterThan(
      1 - big.world.creatures.health[big.attacker]!,
    );
  });

  it('can kill the biter, counted among the killed, with energy conserved', () => {
    const { world } = duel(1, { defenseDamage: 0.6, attackDamage: 0.05 });
    for (let k = 0; k < 5; k++) step(world);
    expect(world.deaths.killed).toBe(1);
    expect(world.creatures.count).toBe(1);
    expect(totalEnergy(world)).toBeCloseTo(expectedEnergy(world.ledger), 6);
  });

  it('does nothing when defenses are switched off or the bite does no damage', () => {
    const off = duel(1, { defenseDamage: 0 });
    step(off.world);
    expect(off.world.creatures.health[off.attacker]).toBe(1);
    const toothless = duel(1, { attackDamage: 0 });
    step(toothless.world);
    expect(toothless.world.creatures.health[toothless.attacker]).toBe(1);
  });
});
