import type { Creatures } from './creatures';

/**
 * Samples of world statistics over time, for charts. Holds a fixed number of
 * samples: when full, it keeps every other one and samples half as often, so
 * it always spans the whole run.
 */
export interface History {
  /** Ticks between samples. Doubles each time the history fills up. */
  interval: number;
  count: number;
  /** Increases whenever the contents change. */
  version: number;
  tick: Float64Array;
  population: Float32Array;
  /** Plant energy as a fraction of the fully grown world. */
  plantFill: Float32Array;
  meanSize: Float32Array;
  meanSpeed: Float32Array;
  meanSensorRange: Float32Array;
  meanDiet: Float32Array;
  meanFur: Float32Array;
  /** Creatures whose diet gene is above one half. */
  meatEaters: Float32Array;
  speciesCount: Float32Array;
  /** Mean number of enabled links and of hidden neurons per brain. */
  meanLinks: Float32Array;
  meanNeurons: Float32Array;
  /** Mean genes of the creatures that had young since the last sample, weighted by births. */
  parentSize: Float32Array;
  parentSpeed: Float32Array;
  parentSensorRange: Float32Array;
  parentDiet: Float32Array;
  /** How varied the body genes are: the mean of their standard deviations. */
  diversity: Float32Array;
}

/** Names of every series, in a fixed order. */
export const HISTORY_SERIES = [
  'tick',
  'population',
  'plantFill',
  'meanSize',
  'meanSpeed',
  'meanSensorRange',
  'meanDiet',
  'meanFur',
  'meatEaters',
  'speciesCount',
  'meanLinks',
  'meanNeurons',
  'parentSize',
  'parentSpeed',
  'parentSensorRange',
  'parentDiet',
  'diversity',
] as const;

export interface Sample {
  tick: number;
  population: number;
  plantFill: number;
  meanSize: number;
  meanSpeed: number;
  meanSensorRange: number;
  meanDiet: number;
  meanFur: number;
  meatEaters: number;
  speciesCount: number;
  meanLinks: number;
  meanNeurons: number;
  parentSize: number;
  parentSpeed: number;
  parentSensorRange: number;
  parentDiet: number;
  diversity: number;
}

export function createHistory(interval: number, capacity: number): History {
  return {
    interval,
    count: 0,
    version: 0,
    tick: new Float64Array(capacity),
    population: new Float32Array(capacity),
    plantFill: new Float32Array(capacity),
    meanSize: new Float32Array(capacity),
    meanSpeed: new Float32Array(capacity),
    meanSensorRange: new Float32Array(capacity),
    meanDiet: new Float32Array(capacity),
    meanFur: new Float32Array(capacity),
    meatEaters: new Float32Array(capacity),
    speciesCount: new Float32Array(capacity),
    meanLinks: new Float32Array(capacity),
    meanNeurons: new Float32Array(capacity),
    parentSize: new Float32Array(capacity),
    parentSpeed: new Float32Array(capacity),
    parentSensorRange: new Float32Array(capacity),
    parentDiet: new Float32Array(capacity),
    diversity: new Float32Array(capacity),
  };
}

export function recordSample(history: History, sample: Sample): void {
  if (history.count === history.tick.length) {
    const kept = Math.ceil(history.count / 2);
    for (const name of HISTORY_SERIES) {
      const series = history[name];
      for (let i = 0; i < kept; i++) series[i] = series[i * 2]!;
    }
    history.count = kept;
    history.interval *= 2;
  }
  const i = history.count++;
  for (const name of HISTORY_SERIES) history[name][i] = sample[name];
  history.version++;
}

/** Mean of a gene across living creatures, or 0 when there are none. */
export function meanOf(values: Float32Array, creatures: Creatures): number {
  if (creatures.count === 0) return 0;
  let total = 0;
  for (let i = 0; i < creatures.count; i++) total += values[i]!;
  return total / creatures.count;
}

/** Standard deviation of a gene across living creatures, or 0 when there are none. */
export function spreadOf(values: Float32Array, creatures: Creatures): number {
  if (creatures.count === 0) return 0;
  const mean = meanOf(values, creatures);
  let total = 0;
  for (let i = 0; i < creatures.count; i++) total += (values[i]! - mean) ** 2;
  return Math.sqrt(total / creatures.count);
}