import { Input, INPUT_COUNT, OUTPUT_COUNT, type Brain } from './brain';
import type { Creatures } from './creatures';

/**
 * Which senses lead to which actions, across a population: the "habits"
 * evolution has wired in. A sense leads to an action if a chain of links
 * runs from the sense's input to the action's output, directly or through
 * hidden neurons (or through other outputs, which feed back in). Chains are
 * followed up to MAX_CHAIN links long.
 *
 * A habit's effect is the sum over its chains of the product of their
 * weights: above zero, more of the sense gives more of the action; below,
 * less. It ignores the squashing at each neuron, so it reads as a direction
 * and rough strength, not an exact gain.
 */

/** Longest chain of links followed from a sense to an action. */
export const MAX_CHAIN = 3;

/** Number of sense-action pairs. A pair's index is input * OUTPUT_COUNT + output. */
export const PATHWAY_COUNT = INPUT_COUNT * OUTPUT_COUNT;

export const pathwayIndex = (input: number, output: number) => input * OUTPUT_COUNT + output;
export const pathwayInput = (pathway: number) => Math.floor(pathway / OUTPUT_COUNT);
export const pathwayOutput = (pathway: number) => pathway % OUTPUT_COUNT;

/** The sense-action pairs one brain has, with their effects. */
export interface Habits {
  /** Pathway index of each habit. */
  pathway: number[];
  /** Effect with the live weights, which learning may have moved. */
  effect: number[];
  /** Effect with the weights it was born with. */
  inborn: number[];
  /** Whether a single link runs straight from the sense to the action. */
  direct: boolean[];
  /** Whether any chain passes through a link that can learn. */
  learns: boolean[];
}

/** Scratch space for tracing, reused between brains. */
const effect = new Float64Array(PATHWAY_COUNT);
const inborn = new Float64Array(PATHWAY_COUNT);
const flags = new Uint8Array(PATHWAY_COUNT);
const FOUND = 1;
const DIRECT = 2;
const LEARNS = 4;

/** Find every sense-action pair one brain wires together. The bias input is left out: it is a constant lean, not a response. */
export function traceHabits(brain: Brain): Habits {
  const { linkFrom, linkTo, linkWeight, plasticLinks, plasticBase } = brain;
  const links = linkWeight.length;
  const born = Float64Array.from(linkWeight);
  const plastic = new Uint8Array(links);
  for (let p = 0; p < plasticLinks.length; p++) {
    born[plasticLinks[p]!] = plasticBase[p]!;
    plastic[plasticLinks[p]!] = 1;
  }
  // Links leaving each neuron.
  const outgoing = new Map<number, number[]>();
  for (let k = 0; k < links; k++) {
    const list = outgoing.get(linkFrom[k]!);
    if (list) list.push(k);
    else outgoing.set(linkFrom[k]!, [k]);
  }

  const touched: number[] = [];
  const walk = (input: number, node: number, live: number, start: number, depth: number, learns: boolean) => {
    for (const k of outgoing.get(node) ?? []) {
      const to = linkTo[k]!;
      const nextLive = live * linkWeight[k]!;
      const nextBorn = start * born[k]!;
      const nextLearns = learns || plastic[k] === 1;
      if (to >= INPUT_COUNT && to < INPUT_COUNT + OUTPUT_COUNT) {
        const pathway = pathwayIndex(input, to - INPUT_COUNT);
        if (flags[pathway] === 0) touched.push(pathway);
        flags[pathway]! |= FOUND | (depth === 1 ? DIRECT : 0) | (nextLearns ? LEARNS : 0);
        effect[pathway]! += nextLive;
        inborn[pathway]! += nextBorn;
      }
      if (depth < MAX_CHAIN && to >= INPUT_COUNT) walk(input, to, nextLive, nextBorn, depth + 1, nextLearns);
    }
  };
  for (const [from] of outgoing) {
    if (from < INPUT_COUNT && from !== Input.Bias) walk(from, from, 1, 1, 1, false);
  }

  touched.sort((a, b) => a - b);
  const habits: Habits = { pathway: touched, effect: [], inborn: [], direct: [], learns: [] };
  for (const pathway of touched) {
    habits.effect.push(effect[pathway]!);
    habits.inborn.push(inborn[pathway]!);
    habits.direct.push((flags[pathway]! & DIRECT) !== 0);
    habits.learns.push((flags[pathway]! & LEARNS) !== 0);
    effect[pathway] = 0;
    inborn[pathway] = 0;
    flags[pathway] = 0;
  }
  return habits;
}

/** How a group of creatures is wired, pair by pair. Every array has PATHWAY_COUNT entries. */
export interface PathwayStats {
  count: number;
  /** Share of members that have the habit. */
  share: Float32Array;
  /** Mean effect among the members that have it. */
  effect: Float32Array;
  /** Share of those members with a link straight from the sense to the action. */
  direct: Float32Array;
  /** Share of those members whose habit runs through a link that can learn. */
  learns: Float32Array;
  /** Mean change learning has made to the effect, among the members whose habit can learn. */
  learned: Float32Array;
}

export function emptyPathwayStats(): PathwayStats {
  return {
    count: 0,
    share: new Float32Array(PATHWAY_COUNT),
    effect: new Float32Array(PATHWAY_COUNT),
    direct: new Float32Array(PATHWAY_COUNT),
    learns: new Float32Array(PATHWAY_COUNT),
    learned: new Float32Array(PATHWAY_COUNT),
  };
}

/** Summarise the habits of the creatures at `indices`, given every creature's habits by index. */
export function pathwayStats(habits: readonly Habits[], indices: readonly number[]): PathwayStats {
  const stats = emptyPathwayStats();
  const learnedCount = new Float32Array(PATHWAY_COUNT);
  stats.count = indices.length;
  for (const i of indices) {
    const h = habits[i]!;
    for (let k = 0; k < h.pathway.length; k++) {
      const pathway = h.pathway[k]!;
      stats.share[pathway]!++;
      stats.effect[pathway]! += h.effect[k]!;
      if (h.direct[k]) stats.direct[pathway]!++;
      if (h.learns[k]) {
        stats.learns[pathway]!++;
        stats.learned[pathway]! += h.effect[k]! - h.inborn[k]!;
        learnedCount[pathway]!++;
      }
    }
  }
  for (let pathway = 0; pathway < PATHWAY_COUNT; pathway++) {
    const carriers = stats.share[pathway]!;
    if (carriers === 0) continue;
    stats.effect[pathway]! /= carriers;
    stats.direct[pathway]! /= carriers;
    stats.learns[pathway]! /= carriers;
    if (learnedCount[pathway]! > 0) stats.learned[pathway]! /= learnedCount[pathway]!;
    stats.share[pathway] = carriers / indices.length;
  }
  return stats;
}

/**
 * How the share of the whole population with each habit has changed over
 * the run. Holds a fixed number of samples; when full, it keeps every other
 * one and samples half as often, so it always spans the whole run. Not saved:
 * after loading, it starts again.
 */
export interface AdoptionHistory {
  /** Ticks between samples. */
  interval: number;
  ticks: number[];
  /** One PATHWAY_COUNT array of shares per sample. */
  shares: Float32Array[];
}

const ADOPTION_SAMPLES = 80;

export function createAdoptionHistory(interval = 500): AdoptionHistory {
  return { interval, ticks: [], shares: [] };
}

/** Add a sample if enough ticks have passed since the last. A tick earlier than the last (a restart or load) starts again. */
export function recordAdoption(history: AdoptionHistory, tick: number, share: Float32Array): void {
  const last = history.ticks[history.ticks.length - 1];
  if (last !== undefined && tick < last) {
    history.ticks = [];
    history.shares = [];
  } else if (last !== undefined && tick - last < history.interval) {
    return;
  }
  history.ticks.push(tick);
  history.shares.push(share.slice());
  if (history.ticks.length <= ADOPTION_SAMPLES) return;
  history.ticks = history.ticks.filter((_, k) => k % 2 === 0);
  history.shares = history.shares.filter((_, k) => k % 2 === 0);
  history.interval *= 2;
}

/**
 * A difference between two groups of adults in how many young they have,
 * compared within each species and then pooled, so a habit is not credited
 * just for being common in a species that happens to be thriving.
 */
export interface BreedingSplit {
  /** Young per 1,000 ticks lived in each group, as pooled over the species where both groups have members. */
  withRate: number;
  withoutRate: number;
  withCount: number;
  withoutCount: number;
  /**
   * How sure the difference is: the gap in means over its standard error.
   * Beyond 2 either way, chance alone would rarely give a gap this big.
   */
  z: number;
}

export interface BreedingLinks {
  /** Creatures old enough to count, and the age they had to reach. */
  adults: number;
  minAge: number;
  /** Mean young per 1,000 ticks lived among them. */
  meanRate: number;
  /** For each habit carried by enough adults (and lacked by enough), carriers against the rest. */
  habits: (BreedingSplit & { pathway: number })[];
  /** For each trait, the upper half of adults against the lower half. */
  traits: (BreedingSplit & { trait: TraitName; median: number })[];
}

export const TRAITS = [
  'size',
  'speed',
  'sensorRange',
  'diet',
  'fur',
  'defense',
  'mutationRate',
  'links',
  'hiddenNeurons',
  'learningLinks',
] as const;
export type TraitName = (typeof TRAITS)[number];

/** Fewest adults on each side for a split to be shown. */
const MIN_SIDE = 8;
/** Fewest adults on each side within a species for that species to count. */
const MIN_STRATUM_SIDE = 2;

/**
 * Compare the adults for which `inGroup` holds with the rest, within each
 * stratum (species, numbered from 0), pooling the strata by how much each
 * can tell (n1 n2 / (n1 + n2), the usual weight for a difference in means).
 */
function split(rates: number[], strata: Uint32Array, strataCount: number, inGroup: (k: number) => boolean): BreedingSplit | null {
  // Count, sum and sum of squares for each stratum and side.
  const n = new Float64Array(strataCount * 2);
  const sum = new Float64Array(strataCount * 2);
  const squares = new Float64Array(strataCount * 2);
  let n1 = 0;
  let n2 = 0;
  for (let k = 0; k < rates.length; k++) {
    const side = inGroup(k) ? 0 : 1;
    if (side === 0) n1++;
    else n2++;
    const at = strata[k]! * 2 + side;
    const r = rates[k]!;
    n[at]!++;
    sum[at]! += r;
    squares[at]! += r * r;
  }
  if (n1 < MIN_SIDE || n2 < MIN_SIDE) return null;
  let weights = 0;
  let with_ = 0;
  let without = 0;
  let variance = 0;
  for (let stratum = 0; stratum < strataCount; stratum++) {
    const a = stratum * 2;
    const b = a + 1;
    if (n[a]! < MIN_STRATUM_SIDE || n[b]! < MIN_STRATUM_SIDE) continue;
    const ma = sum[a]! / n[a]!;
    const mb = sum[b]! / n[b]!;
    const va = Math.max(0, squares[a]! / n[a]! - ma * ma) / (n[a]! - 1);
    const vb = Math.max(0, squares[b]! / n[b]! - mb * mb) / (n[b]! - 1);
    const w = (n[a]! * n[b]!) / (n[a]! + n[b]!);
    weights += w;
    with_ += w * ma;
    without += w * mb;
    variance += w * w * (va / n[a]! + vb / n[b]!);
  }
  if (weights === 0) return null;
  const withRate = with_ / weights;
  const withoutRate = without / weights;
  const error = Math.sqrt(variance) / weights;
  return { withRate, withoutRate, withCount: n1, withoutCount: n2, z: error > 0 ? (withRate - withoutRate) / error : 0 };
}

function traitValue(c: Creatures, i: number, trait: TraitName): number {
  const brain = c.brain[i]!;
  switch (trait) {
    case 'links':
      return brain.linkWeight.length;
    case 'hiddenNeurons':
      return brain.hiddenIds.length;
    case 'learningLinks':
      return brain.plasticLinks.length;
    default:
      return c[trait][i]!;
  }
}

/**
 * Which habits and traits go with having young. Only creatures at least
 * `minAge` old count, and each is scored by its young per 1,000 ticks lived,
 * so old creatures are not favoured just for having had longer. Each
 * comparison is made within species (see split). These are associations
 * among the living, not proof of cause: a habit can ride along with another
 * that matters.
 */
export function breedingLinks(c: Creatures, habits: readonly Habits[], minAge: number): BreedingLinks {
  const adults: number[] = [];
  for (let i = 0; i < c.count; i++) if (c.age[i]! >= minAge) adults.push(i);
  const rates = adults.map((i) => (1000 * c.children[i]!) / Math.max(1, c.age[i]!));
  const meanRate = rates.length > 0 ? rates.reduce((a, b) => a + b, 0) / rates.length : 0;
  const speciesIndex = new Map<number, number>();
  const strata = Uint32Array.from(adults, (i) => {
    const species = c.species[i]!;
    let index = speciesIndex.get(species);
    if (index === undefined) {
      index = speciesIndex.size;
      speciesIndex.set(species, index);
    }
    return index;
  });
  const compare = (inGroup: (k: number) => boolean) => split(rates, strata, speciesIndex.size, inGroup);

  // The adults carrying each habit, by their place in `adults`.
  const carriers = new Map<number, number[]>();
  adults.forEach((i, k) => {
    for (const pathway of habits[i]!.pathway) {
      const list = carriers.get(pathway);
      if (list) list.push(k);
      else carriers.set(pathway, [k]);
    }
  });
  const result: BreedingLinks = { adults: adults.length, minAge, meanRate, habits: [], traits: [] };
  const has = new Uint8Array(adults.length);
  for (const [pathway, list] of [...carriers].sort((a, b) => a[0] - b[0])) {
    if (list.length < MIN_SIDE || adults.length - list.length < MIN_SIDE) continue;
    for (const k of list) has[k] = 1;
    const s = compare((k) => has[k] === 1);
    for (const k of list) has[k] = 0;
    if (s) result.habits.push({ pathway, ...s });
  }
  for (const trait of TRAITS) {
    const values = adults.map((i) => traitValue(c, i, trait));
    const sorted = [...values].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)] ?? 0;
    // With many equal values, the upper half takes those at the median when it would otherwise be too small.
    const above = values.filter((v) => v > median).length;
    const s = above >= MIN_SIDE ? compare((k) => values[k]! > median) : compare((k) => values[k]! >= median);
    if (s) result.traits.push({ trait, median, ...s });
  }
  return result;
}
