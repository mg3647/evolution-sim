import { describe, expect, it } from 'vitest';
import {
  breedingLinks,
  markStandouts,
  twoSidedP,
  type BreedingSplit,
  createAdoptionHistory,
  pathwayIndex,
  pathwayStats,
  recordAdoption,
  traceHabits,
  PATHWAY_COUNT,
} from './associations';
import { compileBrain, Input, INPUT_COUNT, Output, type LinkGene } from './brain';
import { createCreatures, spawnCreature } from './creatures';

const TURN = INPUT_COUNT + Output.Turn;
const THRUST = INPUT_COUNT + Output.Thrust;
const ATTACK = INPUT_COUNT + Output.Attack;
const HIDDEN = 1000;
const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.1, hue: 0.5, fur: 0, defense: 0, investment: 0.5, readiness: 0.8, mutationRate: 0.05 };

function link(from: number, to: number, weight: number, plasticity = 0, enabled = true): LinkGene {
  return { innovation: from * 10000 + to, from, to, weight, enabled, plasticity };
}

describe('traceHabits', () => {
  it('finds direct links and chains through hidden neurons, multiplying weights along a chain', () => {
    const brain = compileBrain(
      [link(Input.Energy, THRUST, 2), link(Input.Pain, HIDDEN, 2), link(HIDDEN, ATTACK, -1.5), link(Input.Bias, TURN, 1)],
      [HIDDEN],
    );
    const habits = traceHabits(brain);
    const thrust = habits.pathway.indexOf(pathwayIndex(Input.Energy, Output.Thrust));
    const attack = habits.pathway.indexOf(pathwayIndex(Input.Pain, Output.Attack));
    expect(habits.effect[thrust]).toBe(2);
    expect(habits.direct[thrust]).toBe(true);
    expect(habits.effect[attack]).toBe(-3);
    expect(habits.direct[attack]).toBe(false);
    // The bias is a lean, not a response.
    expect(habits.pathway).not.toContain(pathwayIndex(Input.Bias, Output.Turn));
    expect(habits.pathway).toHaveLength(2);
  });

  it('ignores disabled links and reports what learning has changed', () => {
    const brain = compileBrain([link(Input.Energy, THRUST, 1, 0.1), link(Input.Pain, ATTACK, 1, 0, false)], []);
    brain.linkWeight[0] = 1.5;
    const habits = traceHabits(brain);
    expect(habits.pathway).toEqual([pathwayIndex(Input.Energy, Output.Thrust)]);
    expect(habits.learns[0]).toBe(true);
    expect(habits.effect[0]).toBe(1.5);
    expect(habits.inborn[0]).toBe(1);
  });

  it('stops following a loop after a few links', () => {
    const brain = compileBrain([link(Input.Energy, HIDDEN, 1), link(HIDDEN, HIDDEN, 1), link(HIDDEN, THRUST, 1)], [HIDDEN]);
    const habits = traceHabits(brain);
    // Chains of 2 and 3 links reach Thrust; the loop is not followed forever.
    expect(habits.effect).toEqual([2]);
  });
});

describe('pathwayStats', () => {
  it('reports share, mean effect, and how many carriers learn', () => {
    const brains = [
      compileBrain([link(Input.Energy, THRUST, 2)], []),
      compileBrain([link(Input.Energy, THRUST, 4, 0.2)], []),
      compileBrain([], []),
      compileBrain([link(Input.Pain, ATTACK, 1)], []),
    ];
    brains[1]!.linkWeight[0] = 5;
    const stats = pathwayStats(brains.map(traceHabits), [0, 1, 2]);
    const p = pathwayIndex(Input.Energy, Output.Thrust);
    expect(stats.count).toBe(3);
    expect(stats.share[p]).toBeCloseTo(2 / 3);
    expect(stats.effect[p]).toBeCloseTo(3.5);
    expect(stats.learns[p]).toBeCloseTo(0.5);
    expect(stats.learned[p]).toBeCloseTo(1);
    expect(stats.share[pathwayIndex(Input.Pain, Output.Attack)]).toBe(0);
  });
});

describe('recordAdoption', () => {
  it('samples at the interval, thins when full, and starts again when time goes back', () => {
    const history = createAdoptionHistory(10);
    const share = new Float32Array(PATHWAY_COUNT);
    recordAdoption(history, 0, share);
    recordAdoption(history, 5, share);
    expect(history.ticks).toEqual([0]);
    for (let tick = 10; tick <= 800; tick += 10) recordAdoption(history, tick, share);
    expect(history.ticks.length).toBeLessThanOrEqual(80);
    expect(history.interval).toBe(20);
    expect(history.ticks[0]).toBe(0);
    recordAdoption(history, 3, share);
    expect(history.ticks).toEqual([3]);
  });
});

describe('breedingLinks', () => {
  it('compares young per tick lived between carriers and the rest, among adults only', () => {
    const c = createCreatures(64);
    const withHabit = compileBrain([link(Input.Energy, THRUST, 1)], []);
    const without = compileBrain([], []);
    for (let k = 0; k < 40; k++) {
      const carrier = k % 2 === 0;
      const i = spawnCreature(c, {
        x: 0,
        y: 0,
        heading: 0,
        energy: 1,
        genes: { ...genes, size: carrier ? 1.5 : 0.8 },
        brain: carrier ? withHabit : without,
      });
      c.age[i] = 1000;
      // Carriers had 3 or 4 young, the rest 0 or 1.
      c.children[i] = carrier ? 3 + (k % 4 === 0 ? 1 : 0) : k % 3 === 0 ? 1 : 0;
    }
    // A young creature with many children is left out.
    const young = spawnCreature(c, { x: 0, y: 0, heading: 0, energy: 1, genes, brain: without });
    c.age[young] = 10;
    c.children[young] = 50;

    const habits = Array.from({ length: c.count }, (_, i) => traceHabits(c.brain[i]!));
    const result = breedingLinks(c, habits, 100);
    expect(result.adults).toBe(40);
    const habit = result.habits.find((h) => h.pathway === pathwayIndex(Input.Energy, Output.Thrust))!;
    expect(habit.withCount).toBe(20);
    expect(habit.withRate).toBeGreaterThan(habit.withoutRate);
    expect(habit.z).toBeGreaterThan(2);
    const size = result.traits.find((t) => t.trait === 'size')!;
    expect(size.withRate).toBeGreaterThan(size.withoutRate);
    // Nobody can learn, so there is no upper half to compare.
    expect(result.traits.find((t) => t.trait === 'learningLinks')).toBeUndefined();
  });

  it('compares within species, so a habit common in a thriving species gets no credit for it', () => {
    const c = createCreatures(128);
    const withHabit = compileBrain([link(Input.Energy, THRUST, 1)], []);
    const without = compileBrain([], []);
    for (let k = 0; k < 80; k++) {
      const thriving = k < 40;
      // Most of the thriving species has the habit, few of the other; within each, it makes no difference.
      const carrier = thriving ? k % 4 !== 0 : k % 4 === 0;
      const i = spawnCreature(c, { x: 0, y: 0, heading: 0, energy: 1, genes, brain: carrier ? withHabit : without });
      c.species[i] = thriving ? 1 : 2;
      c.age[i] = 1000;
      c.children[i] = (thriving ? 4 : 1) + (k % 2);
    }
    const habits = Array.from({ length: c.count }, (_, i) => traceHabits(c.brain[i]!));
    const habit = breedingLinks(c, habits, 100).habits[0]!;
    expect(Math.abs(habit.z)).toBeLessThan(1);
    expect(habit.withRate).toBeCloseTo(habit.withoutRate, 1);
  });
});

describe('allowing for many comparisons', () => {
  const split = (z: number): BreedingSplit => ({ withRate: 1, withoutRate: 1, withCount: 10, withoutCount: 10, z, standsOut: false });

  it('gives the usual two-sided chances', () => {
    expect(twoSidedP(0)).toBeCloseTo(1, 6);
    expect(twoSidedP(1.96)).toBeCloseTo(0.05, 3);
    expect(twoSidedP(-2.576)).toBeCloseTo(0.01, 3);
  });

  it('keeps a strong difference but drops one that is only clear on its own among many', () => {
    const splits = [split(6), split(-2.2), ...Array.from({ length: 998 }, () => split(0.3))];
    markStandouts(splits);
    expect(splits[0]!.standsOut).toBe(true);
    // z = 2.2 passes the single-test bar, but not with a thousand tests.
    expect(splits[1]!.standsOut).toBe(false);
    expect(splits.filter((s) => s.standsOut)).toHaveLength(1);
  });

  it('keeps every difference up to the largest rank that passes', () => {
    // By rank, p is 0.001 (bar 0.017), 0.030 (bar 0.033) and 0.50 (bar 0.05): the first two pass.
    const splits = [split(0.67), split(3.29), split(2.17)];
    markStandouts(splits);
    expect(splits.map((s) => s.standsOut)).toEqual([false, true, true]);
  });
});
