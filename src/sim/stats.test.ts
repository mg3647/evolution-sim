import { describe, expect, it } from 'vitest';
import { createHistory, recordSample, type Sample } from './stats';

function sample(tick: number): Sample {
  return {
    tick,
    population: tick * 2,
    plantFill: 0.5,
    meanSize: 1,
    meanSpeed: 1,
    meanSensorRange: 1,
    meanDiet: 0.2,
    meanFur: 0,
    meanDefense: 0,
    toolHolders: 0,
    foodHolders: 0,
    meatEaters: 0,
    speciesCount: 1,
    meanLinks: 4,
    meanNeurons: 0,
    parentSize: 1,
    parentSpeed: 1,
    parentSensorRange: 1,
    parentDiet: 0.2,
    diversity: 0.1,
    spreadSize: 0,
    spreadSpeed: 0,
    spreadSensorRange: 0,
    spreadDiet: 0,
    spreadFur: 0,
    spreadDefense: 0,
    deathsStarved: 0,
    deathsOldAge: 0,
    deathsKilled: 0,
    deathsTemperature: 0,
    deathsThirst: 0,
    deathsOther: 0,
    flowPlantsToPlantEaters: 0,
    flowPlantsToMeatEaters: 0,
    flowMeatToPlantEaters: 0,
    flowMeatToMeatEaters: 0,
    lifespan: 0,
    firstBirthAge: 0,
    offspring: 0,
    generationLength: 0,
    shareResting: 0,
    shareForaging: 0,
    shareChasing: 0,
    shareFleeing: 0,
    blockMoveRate: 0,
    longestBuiltLine: 0,
    builtBlocks: 0,
    shelteredShare: 0,
    blockHolders: 0,
    meanPlasticity: 0,
    plasticLinkShare: 0,
    meanTau: 1,
    slowNeuronShare: 0,
  };
}

describe('history', () => {
  it('records samples in order', () => {
    const history = createHistory(10, 8);
    for (let t = 0; t < 30; t += 10) recordSample(history, sample(t));
    expect(history.count).toBe(3);
    expect(Array.from(history.tick.subarray(0, 3))).toEqual([0, 10, 20]);
    expect(Array.from(history.population.subarray(0, 3))).toEqual([0, 20, 40]);
    expect(history.version).toBe(3);
  });

  it('halves its resolution when full, keeping the whole time span', () => {
    const history = createHistory(10, 4);
    for (let t = 0; t <= 40; t += 10) recordSample(history, sample(t));
    expect(history.interval).toBe(20);
    expect(history.count).toBe(3);
    expect(Array.from(history.tick.subarray(0, 3))).toEqual([0, 20, 40]);
    expect(Array.from(history.population.subarray(0, 3))).toEqual([0, 40, 80]);
  });

  it('never exceeds its capacity over a long run', () => {
    const history = createHistory(1, 16);
    let tick = 0;
    for (let i = 0; i < 5000; i++) {
      if (tick % history.interval === 0) recordSample(history, sample(tick));
      tick++;
    }
    expect(history.count).toBeLessThanOrEqual(16);
    expect(history.tick[0]).toBe(0);
    for (let i = 1; i < history.count; i++) {
      expect(history.tick[i]!).toBeGreaterThan(history.tick[i - 1]!);
    }
  });
});
