import {
  breedingLinks,
  pathwayInput,
  pathwayOutput,
  pathwayStats,
  traceHabits,
  type AdoptionHistory,
  type BreedingSplit,
} from './associations';
import { INPUT_LABELS, OUTPUT_LABELS } from './brain';
import { defaultConfig, type SimConfig } from './config';
import { cellIndexAt } from './plants';
import { SAVE_VERSION } from './serialize';
import { HISTORY_SERIES } from './stats';
import type { World } from './world';

/**
 * A run report: a compact, self-describing summary of one run, written to be
 * read later by people and by analysis scripts. It holds enough to reproduce
 * the run (settings, seed, code version), to tell whether the run was left
 * alone (interventions, reseeding), the whole time series, how species came
 * and went, and where the population ended up.
 */
export const REPORT_VERSION = 3;

/** Most points kept per series; longer histories are thinned evenly. */
const MAX_POINTS = 200;
/** Species kept in the species table, largest peak first. */
const MAX_SPECIES = 40;
/** Most interventions listed; the totals by kind are always complete. */
const MAX_INTERVENTIONS = 300;
/** Habits listed in each of the wiring lists. */
const MAX_HABITS = 20;

/** Something done to a running world by hand, which makes the run less of a clean experiment. */
export interface Intervention {
  tick: number;
  kind: string;
  detail?: string;
  /** Times it was repeated in quick succession (a drag with a tool counts once per move). */
  count?: number;
}

/** What a person adds to a report. */
export interface ReportNotes {
  /** What the run was meant to test, in a line. */
  question: string;
  /** Anything noticed while watching. */
  notes: string;
}

export interface ReportMeta extends ReportNotes {
  /** Code version the run came from (a commit), or 'dev'. */
  appVersion: string;
  /** ISO time the report was made. */
  createdAt: string;
}

export interface Spread {
  mean: number;
  p10: number;
  p50: number;
  p90: number;
}

/** One sense-action habit in a report; see associations.ts. */
export interface ReportHabit {
  /** "Plants ahead → Thrust". */
  habit: string;
  input: string;
  output: string;
  /** Share of the population with it now. */
  share: number;
  /** Mean effect among those with it: above 0 the sense drives the action up. */
  effect?: number;
  /** Share of the population with it at the first adoption sample. */
  startShare?: number;
}

/** Young per 1,000 ticks lived, with and without a habit or trait; `standsOut` once the number of comparisons is allowed for. */
export interface ReportBreeding {
  withRate: number;
  withoutRate: number;
  withCount: number;
  withoutCount: number;
  z: number;
  standsOut: boolean;
}

export interface RunReport {
  reportVersion: number;
  saveVersion: number;
  appVersion: string;
  createdAt: string;
  question: string;
  notes: string;
  run: {
    seed: string;
    tick: number;
    population: number;
    /** Creatures put back into a world that had died out. Above 0, later results are partly the reseeding. */
    reseeded: number;
    /** Settings that differ from the defaults, for a quick read. */
    changedSettings: Record<string, unknown>;
    /** Same for every run with the same settings apart from the seed, so repeats group together. */
    configKey: string;
    config: SimConfig;
    randomEvents: boolean;
  };
  /** True when nothing was done by hand and nothing was reseeded: the run is a fair sample of its settings. */
  clean: boolean;
  interventions: { total: number; byKind: Record<string, number>; list: Intervention[] };
  headline: Record<string, number | null>;
  series: { interval: number; points: number; names: string[]; data: number[][] };
  species: {
    id: number;
    firstSeenTick: number;
    lastSeenTick: number;
    peak: number;
    final: number;
  }[];
  events: { tick: number; text: string }[];
  final: {
    traits: Record<string, Spread>;
    generation: { mean: number; max: number };
    biomes: { biome: number; land: number; count: number }[];
    dietBins: number[];
    totals: Record<string, number>;
  };
  /**
   * Which senses the population's brains link to which actions, how that
   * changed over the run, and which habits and traits go with having young.
   */
  wiring: {
    /** The most common habits now. */
    common: ReportHabit[];
    /** Habits whose share grew or shrank most since the first adoption sample (none without an adoption history). */
    spread: ReportHabit[];
    faded: ReportHabit[];
    breeding: {
      adults: number;
      minAge: number;
      meanRate: number;
      /** Traits: the upper half of adults against the lower half. */
      traits: (ReportBreeding & { trait: string; median: number })[];
      /** Habits compared: the number of comparisons the habits that stand out were picked from. */
      habitsTested: number;
      /** Habits whose difference stands out after allowing for the number of comparisons (Benjamini-Hochberg), strongest first. */
      habits: (ReportBreeding & { habit: string })[];
    };
  };
}

/** A short stable key for a set of settings, ignoring the seed. */
export function configKey(config: SimConfig): string {
  const copy = { ...config } as unknown as Record<string, unknown>;
  delete copy.seed;
  const text = JSON.stringify(Object.keys(copy).sort().map((key) => [key, copy[key]]));
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Round to four significant figures, which keeps the file small without losing a trend. */
function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value === 0 ? 0 : Number(value.toPrecision(4));
}

function spread(values: number[]): Spread {
  if (values.length === 0) return { mean: 0, p10: 0, p50: 0, p90: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;
  const mean = sorted.reduce((a, b) => a + b, 0) / sorted.length;
  return { mean: round(mean), p10: round(at(0.1)), p50: round(at(0.5)), p90: round(at(0.9)) };
}

/** Indices of `count` samples thinned evenly down to at most MAX_POINTS, always keeping the last. */
function thinned(count: number): number[] {
  if (count <= MAX_POINTS) return Array.from({ length: count }, (_, k) => k);
  const picked: number[] = [];
  for (let k = 0; k < MAX_POINTS; k++) picked.push(Math.round((k * (count - 1)) / (MAX_POINTS - 1)));
  return picked;
}

function mean(values: ArrayLike<number>, from: number, to: number): number {
  let sum = 0;
  for (let k = from; k < to; k++) sum += values[k]!;
  return to > from ? sum / (to - from) : 0;
}

/** Slope of a series per 10,000 ticks over its second half, by least squares. */
function trendPer10k(ticks: ArrayLike<number>, values: ArrayLike<number>, from: number, to: number): number | null {
  const n = to - from;
  if (n < 5) return null;
  const mx = mean(ticks, from, to);
  const my = mean(values, from, to);
  let num = 0;
  let den = 0;
  for (let k = from; k < to; k++) {
    num += (ticks[k]! - mx) * (values[k]! - my);
    den += (ticks[k]! - mx) ** 2;
  }
  return den > 0 ? round((num / den) * 10000) : null;
}

function habitName(pathway: number): string {
  return `${INPUT_LABELS[pathwayInput(pathway)]} → ${OUTPUT_LABELS[pathwayOutput(pathway)]}`;
}

function rounded(split: BreedingSplit): ReportBreeding {
  return {
    withRate: round(split.withRate),
    withoutRate: round(split.withoutRate),
    withCount: split.withCount,
    withoutCount: split.withoutCount,
    z: round(split.z),
    standsOut: split.standsOut,
  };
}

/** The wiring part of a report. */
function wiringReport(world: World, adoption: AdoptionHistory | undefined): RunReport['wiring'] {
  const { creatures: c, history: h } = world;
  const habits = Array.from({ length: c.count }, (_, i) => traceHabits(c.brain[i]!));
  const stats = pathwayStats(habits, Array.from({ length: c.count }, (_, i) => i));
  const habit = (pathway: number): ReportHabit => ({
    habit: habitName(pathway),
    input: INPUT_LABELS[pathwayInput(pathway)]!,
    output: OUTPUT_LABELS[pathwayOutput(pathway)]!,
    share: round(stats.share[pathway]!),
  });
  const all = Array.from(stats.share.keys());
  const common = all
    .filter((p) => stats.share[p]! > 0)
    .sort((a, b) => stats.share[b]! - stats.share[a]! || a - b)
    .slice(0, MAX_HABITS)
    .map((p) => ({ ...habit(p), effect: round(stats.effect[p]!) }));
  const start = adoption?.shares[0];
  const moved = start
    ? all
        .map((p) => ({ p, change: stats.share[p]! - start[p]! }))
        .filter((m) => Math.abs(m.change) >= 0.02)
    : [];
  const withStart = (p: number) => ({ ...habit(p), startShare: round(start![p]!) });
  const spread = moved
    .filter((m) => m.change > 0)
    .sort((a, b) => b.change - a.change)
    .slice(0, MAX_HABITS)
    .map((m) => withStart(m.p));
  const faded = moved
    .filter((m) => m.change < 0)
    .sort((a, b) => a.change - b.change)
    .slice(0, MAX_HABITS)
    .map((m) => withStart(m.p));

  const firstBirth = h.count > 0 ? h.firstBirthAge[h.count - 1]! : 0;
  const breeding = breedingLinks(c, habits, Math.max(world.config.minReproduceAge, Math.round(firstBirth)));
  return {
    common,
    spread,
    faded,
    breeding: {
      adults: breeding.adults,
      minAge: breeding.minAge,
      meanRate: round(breeding.meanRate),
      traits: breeding.traits.map((t) => ({ trait: t.trait, median: round(t.median), ...rounded(t) })),
      habitsTested: breeding.habits.length,
      habits: breeding.habits
        .filter((b) => b.standsOut)
        .sort((a, b) => Math.abs(b.z) - Math.abs(a.z))
        .slice(0, MAX_HABITS)
        .map((b) => ({ habit: habitName(b.pathway), ...rounded(b) })),
    },
  };
}

/**
 * Build a report of a world. `adoption`, if given, is how the population's
 * habits changed over the run, for the wiring part.
 */
export function buildReport(
  world: World,
  interventions: Intervention[],
  meta: ReportMeta,
  adoption?: AdoptionHistory,
): RunReport {
  const { config, creatures: c, history: h } = world;
  const n = h.count;

  const changedSettings: Record<string, unknown> = {};
  for (const key of Object.keys(defaultConfig) as (keyof SimConfig)[]) {
    if (config[key] !== defaultConfig[key]) changedSettings[key] = config[key];
  }

  const byKind: Record<string, number> = {};
  for (const item of interventions) byKind[item.kind] = (byKind[item.kind] ?? 0) + (item.count ?? 1);

  // Time series, thinned, as columns in a fixed order.
  const picked = thinned(n);
  const names: string[] = [];
  const data: number[][] = [];
  for (const name of HISTORY_SERIES) {
    const column = (h as unknown as Record<string, ArrayLike<number>>)[name];
    if (!column) continue;
    names.push(name);
    data.push(picked.map((k) => (name === 'tick' ? column[k]! : round(column[k]!))));
  }

  // Species: first and last sample each was seen, its biggest size, and its size now.
  const species: RunReport['species'] = [];
  for (const [id, counts] of h.species) {
    let first = -1;
    let last = -1;
    let peak = 0;
    for (let k = 0; k < n; k++) {
      const members = counts[k] ?? 0;
      if (members > 0) {
        if (first < 0) first = k;
        last = k;
        if (members > peak) peak = members;
      }
    }
    if (first < 0) continue;
    species.push({
      id,
      firstSeenTick: h.tick[first]!,
      lastSeenTick: h.tick[last]!,
      peak,
      final: last === n - 1 ? (counts[last] ?? 0) : 0,
    });
  }
  species.sort((a, b) => b.peak - a.peak);

  // Headline numbers: the few that say what kind of run this was.
  const pop = h.population;
  let peakPopulation = 0;
  let minPopulation = Infinity;
  let meatTick: number | null = null;
  for (let k = 0; k < n; k++) {
    peakPopulation = Math.max(peakPopulation, pop[k]!);
    minPopulation = Math.min(minPopulation, pop[k]!);
    if (meatTick === null && pop[k]! > 0 && h.meatEaters[k]! / pop[k]! > 0.1) meatTick = h.tick[k]!;
  }
  const half = Math.floor(n / 2);
  const lastQuarter = Math.floor((n * 3) / 4);
  const headline: Record<string, number | null> = {
    ticks: world.tick,
    peakPopulation: round(peakPopulation),
    minPopulation: n > 0 ? round(minPopulation) : null,
    meanPopulationLastQuarter: n > 0 ? round(mean(pop, lastQuarter, n)) : null,
    speciesAtEnd: n > 0 ? h.speciesCount[n - 1]! : null,
    speciesEverSeen: species.length,
    firstTickWithTenPercentMeatEaters: meatTick,
    meanLifespanLastQuarter: n > 0 ? round(mean(h.lifespan, lastQuarter, n)) : null,
    maxGeneration: 0,
    // How fast each trait was still moving in the second half of the run: 0 means settled.
    sizeTrendPer10k: trendPer10k(h.tick, h.meanSize, half, n),
    speedTrendPer10k: trendPer10k(h.tick, h.meanSpeed, half, n),
    dietTrendPer10k: trendPer10k(h.tick, h.meanDiet, half, n),
    sensorTrendPer10k: trendPer10k(h.tick, h.meanSensorRange, half, n),
    // Brain links that stayed versus their neutral copies: above 1 means selection kept them.
    wiringActivityRatioEnd:
      n > 0 && h.wiringShadowActivity[n - 1]! > 0 ? round(h.wiringActivity[n - 1]! / h.wiringShadowActivity[n - 1]!) : null,
  };

  const column = (array: ArrayLike<number>): number[] => Array.from({ length: c.count }, (_, i) => array[i]!);
  const generations = column(c.generation);
  const maxGeneration = generations.reduce((a, b) => Math.max(a, b), 0);
  headline.maxGeneration = maxGeneration;

  const land = new Map<number, number>();
  const { plants: p } = world;
  let landCells = 0;
  for (let cell = 0; cell < p.biome.length; cell++) {
    if (p.water[cell] !== 0) continue;
    land.set(p.biome[cell]!, (land.get(p.biome[cell]!) ?? 0) + 1);
    landCells++;
  }
  const inBiome = new Map<number, number>();
  for (let i = 0; i < c.count; i++) {
    const cell = cellIndexAt(p, c.x[i]!, c.y[i]!);
    inBiome.set(p.biome[cell]!, (inBiome.get(p.biome[cell]!) ?? 0) + 1);
  }
  const biomes = [...new Set([...land.keys(), ...inBiome.keys()])]
    .sort((a, b) => a - b)
    .map((biome) => ({ biome, land: round((land.get(biome) ?? 0) / Math.max(1, landCells)), count: inBiome.get(biome) ?? 0 }));

  const dietBins = new Array<number>(10).fill(0);
  for (let i = 0; i < c.count; i++) dietBins[Math.min(9, Math.floor(c.diet[i]! * 10))]!++;

  const list = interventions.slice(0, MAX_INTERVENTIONS);
  return {
    reportVersion: REPORT_VERSION,
    saveVersion: SAVE_VERSION,
    appVersion: meta.appVersion,
    createdAt: meta.createdAt,
    question: meta.question,
    notes: meta.notes,
    run: {
      seed: config.seed,
      tick: world.tick,
      population: c.count,
      reseeded: world.reseeded,
      changedSettings,
      configKey: configKey(config),
      config: { ...config },
      randomEvents: world.environment.randomEvents,
    },
    clean: interventions.length === 0 && world.reseeded === 0,
    interventions: { total: interventions.length, byKind, list },
    headline,
    series: { interval: h.interval, points: picked.length, names, data },
    species: species.slice(0, MAX_SPECIES),
    events: world.environment.log.map((entry) => ({ ...entry })),
    final: {
      traits: {
        size: spread(column(c.size)),
        speed: spread(column(c.speed)),
        sensorRange: spread(column(c.sensorRange)),
        diet: spread(column(c.diet)),
        fur: spread(column(c.fur)),
        defense: spread(column(c.defense)),
        mutationRate: spread(column(c.mutationRate)),
        age: spread(column(c.age)),
      },
      generation: { mean: round(generations.reduce((a, b) => a + b, 0) / Math.max(1, generations.length)), max: maxGeneration },
      biomes,
      dietBins,
      totals: {
        births: world.births,
        starved: world.deaths.starved,
        oldAge: world.deaths.oldAge,
        killed: world.deaths.killed,
        disaster: world.deaths.disaster,
        thirst: world.deaths.thirst,
        temperature: world.deaths.temperature,
        sexualBirths: world.mating.sexual,
        kinBirths: world.mating.kin,
        structuralLinks: world.structural.links,
        structuralNeurons: world.structural.neurons,
        blocksPushed: world.blockTally.pushed,
        blocksSetDown: world.blockTally.setDown,
        pickups: world.carry.pickups,
        calls: world.social.calls,
        energyGiven: round(world.social.given),
        energyGivenToKin: round(world.social.givenToKin),
        fires: world.fires.started,
        cellsBurned: world.fires.cellsBurned,
      },
    },
    wiring: wiringReport(world, adoption),
  };
}

/** A file name for a report: seed, tick and the time it was made, safe to use in a path. */
export function reportFileName(report: RunReport): string {
  const seed = report.run.seed.replace(/[^\w-]+/g, '_').slice(0, 40) || 'run';
  const stamp = report.createdAt.replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
  return `${stamp}_${seed}_tick${report.run.tick}.json`;
}
