/**
 * Measures for the long-run script about local adaptation and inheritance:
 * where each creature was born, whether creatures born in a biome do better
 * there than newcomers, and how much a child behaves like its parent.
 * Script-only: nothing here changes the world.
 */
import { BIOME_COUNT } from '../src/sim/biomes';
import { compileBrain, INPUT_COUNT, Output, OUTPUT_COUNT, think, type Brain } from '../src/sim/brain';
import { climateCostFor } from '../src/sim/genome';
import { cellIndexAt } from '../src/sim/plants';
import { Rng } from '../src/sim/rng';
import type { createWorld } from '../src/sim/world';

type World = ReturnType<typeof createWorld>;

/** Ticks between parent-child resemblance probes. */
const PROBE_EVERY = 25;
/** Input patterns each pair of brains is shown, and ticks each is held for. */
const PROBE_INPUTS = 8;
const PROBE_STEPS = 20;
/** Outputs that act as on/off switches, with the level each switches on at, from world.ts. */
const ON = 1e-9;
const SWITCHES: [number, number][] = [
  [Output.Attack, ON],
  [Output.Call, ON],
  [Output.Emit, ON],
  [Output.Give, ON],
  [Output.Hold, ON],
  [Output.Eat, -0.5],
  [Output.Mate, 0],
  [Output.Reproduce, 0],
];
/** Biome indices, from BIOME_LABELS. */
const DESERT = 3;
const TUNDRA = 4;

export interface LocalitySummary {
  /** Share of the living standing in the biome they were born in. */
  residency: number;
  /** Share of the variance in fur, and in size, explained by birth biome (eta squared). */
  furByBirth: number;
  sizeByBirth: number;
  /** Mean fur of those born in tundra and in desert. */
  tundraFur: number;
  desertFur: number;
  /**
   * Births per creature-tick of creatures in the biome they were born in,
   * divided by the same for newcomers to that biome, pooled over biomes
   * weighted by newcomers' exposure. Above 1 means natives breed better at home.
   */
  homeAdvantage: number;
  /** Correlation of fur with the base temperature where a creature was born (negative: colder-born, furrier). */
  furTemperatureR: number;
  /**
   * Home-vs-away climate cost: how much more a creature's own body would pay
   * in heat and cold at another creature's birthplace than at its own, as a
   * share of what it pays at its own. 0 with no local adaptation.
   */
  climateHomeGap: number;
  /** Chance a creature stands in its birth biome if placed at random: the residency expected by area alone. */
  residencyByChance: number;
  /**
   * Mean output difference between a child and its nearer parent, its mean
   * over both parents, and between two unrelated members of one species, on the same inputs.
   */
  childParentGap: number;
  childParentsMeanGap: number;
  sameSpeciesGap: number;
  /** Share of on/off actions a child and its parent agree on, and the same for two members of one species. */
  childParentAgree: number;
  sameSpeciesAgree: number;
  probes: number;
  /** Mean inherited mutation rate of the living. */
  mutationRate: number;
}

export class Locality {
  private readonly born = new Map<number, number>();
  /** Base temperature of each creature's birthplace. */
  private readonly bornTemp = new Map<number, number>();
  private readonly rng = new Rng('locality-probe');
  private readonly homeBirths = new Float64Array(BIOME_COUNT);
  private readonly awayBirths = new Float64Array(BIOME_COUNT);
  private readonly homeExposure = new Float64Array(BIOME_COUNT);
  private readonly awayExposure = new Float64Array(BIOME_COUNT);
  private residency = 0;
  private furEta = 0;
  private sizeEta = 0;
  private tundraFur = 0;
  private tundraSamples = 0;
  private desertFur = 0;
  private desertSamples = 0;
  private samples = 0;
  private childGap = 0;
  private childMeanGap = 0;
  private speciesGap = 0;
  private childAgree = 0;
  private speciesAgree = 0;
  private probes = 0;
  private furTempR = 0;
  private climateGap = 0;
  private chanceResidency = 0;
  private mutation = 0;

  constructor(private readonly world: World) {
    const c = world.creatures;
    for (let i = 0; i < c.count; i++) this.record(i);
  }

  private record(i: number): number {
    const { plants, config, creatures: c } = this.world;
    const cell = cellIndexAt(plants, c.x[i]!, c.y[i]!);
    const biome = plants.biome[cell]!;
    this.born.set(c.id[i]!, biome);
    this.bornTemp.set(c.id[i]!, config.temperatureStrength * (plants.temperature[cell]! + config.climateShift));
    return biome;
  }

  private biomeOf(i: number): number {
    const c = this.world.creatures;
    return this.world.plants.biome[cellIndexAt(this.world.plants, c.x[i]!, c.y[i]!)]!;
  }

  /** Call after every step: records newborns, and counts births by whether the parent is at home. */
  afterStep(tick: number, measuring: boolean): void {
    const c = this.world.creatures;
    // A newborn has not yet acted, so its age is still zero; newborns are last.
    for (let i = c.count - 1; i >= 0 && c.age[i] === 0; i--) {
      const here = this.record(i);
      const parent = c.parentId[i]!;
      if (parent === 0 || !measuring) continue;
      // A child is placed beside its parent, so the parent is in the same biome.
      const parentBorn = this.born.get(parent);
      if (parentBorn === undefined) continue;
      if (parentBorn === here) this.homeBirths[here]!++;
      else this.awayBirths[here]!++;
      if (tick % PROBE_EVERY === 0) this.probe(i, parent, c.otherParentId[i]!);
    }
  }

  /** Call once per sample, `ticks` apart. */
  sample(ticks: number): void {
    const c = this.world.creatures;
    const count = new Float64Array(BIOME_COUNT);
    const fur = new Float64Array(BIOME_COUNT);
    const size = new Float64Array(BIOME_COUNT);
    let furAll = 0;
    let sizeAll = 0;
    let furSq = 0;
    let sizeSq = 0;
    let home = 0;
    let known = 0;
    let temp = 0;
    let tempSq = 0;
    let furTemp = 0;
    let costHome = 0;
    let costAway = 0;
    let mutation = 0;
    const config = this.world.config;
    for (let i = 0; i < c.count; i++) {
      const born = this.born.get(c.id[i]!);
      const t = this.bornTemp.get(c.id[i]!);
      if (born === undefined || t === undefined) continue;
      // Another creature's birthplace, as the "away" site for this one's body.
      const other = this.bornTemp.get(c.id[this.rng.int(0, c.count)]!) ?? t;
      costHome += climateCostFor(t, c.size[i]!, c.fur[i]!, config);
      costAway += climateCostFor(other, c.size[i]!, c.fur[i]!, config);
      temp += t;
      tempSq += t * t;
      furTemp += c.fur[i]! * t;
      mutation += c.mutationRate[i]!;
      const here = this.biomeOf(i);
      known++;
      if (born === here) {
        home++;
        this.homeExposure[here]! += ticks;
      } else {
        this.awayExposure[here]! += ticks;
      }
      count[born]!++;
      fur[born]! += c.fur[i]!;
      size[born]! += c.size[i]!;
      furAll += c.fur[i]!;
      sizeAll += c.size[i]!;
      furSq += c.fur[i]! ** 2;
      sizeSq += c.size[i]! ** 2;
    }
    if (known < 2) return;
    const eta = (sums: Float64Array, total: number, squares: number) => {
      const mean = total / known;
      const totalVar = squares - known * mean * mean;
      let between = 0;
      for (let b = 0; b < BIOME_COUNT; b++) {
        if (count[b]! > 0) between += count[b]! * (sums[b]! / count[b]! - mean) ** 2;
      }
      return totalVar > 1e-12 ? between / totalVar : 0;
    };
    this.samples++;
    this.residency += home / known;
    const covariance = furTemp / known - (furAll / known) * (temp / known);
    const furVar = furSq / known - (furAll / known) ** 2;
    const tempVar = tempSq / known - (temp / known) ** 2;
    this.furTempR += furVar > 1e-12 && tempVar > 1e-12 ? covariance / Math.sqrt(furVar * tempVar) : 0;
    this.climateGap += costHome > 0 ? (costAway - costHome) / costHome : 0;
    this.mutation += mutation / known;
    // By area alone: the chance a creature born in a biome stands in that biome, weighted by where creatures are born.
    const land = new Float64Array(BIOME_COUNT);
    let landTotal = 0;
    for (let cell = 0; cell < this.world.plants.biome.length; cell++) {
      if (this.world.plants.water[cell] === 1) continue;
      land[this.world.plants.biome[cell]!]!++;
      landTotal++;
    }
    let chance = 0;
    for (let b = 0; b < BIOME_COUNT; b++) chance += (count[b]! / known) * (land[b]! / Math.max(1, landTotal));
    this.chanceResidency += chance;
    this.furEta += eta(fur, furAll, furSq);
    this.sizeEta += eta(size, sizeAll, sizeSq);
    if (count[TUNDRA]! > 0) {
      this.tundraFur += fur[TUNDRA]! / count[TUNDRA]!;
      this.tundraSamples++;
    }
    if (count[DESERT]! > 0) {
      this.desertFur += fur[DESERT]! / count[DESERT]!;
      this.desertSamples++;
    }
    // Forget the dead, so the map stays the size of the population.
    if (this.born.size > 4 * c.count + 1000) {
      const living = new Set<number>();
      for (let i = 0; i < c.count; i++) living.add(c.id[i]!);
      for (const id of this.born.keys()) {
        if (living.has(id)) continue;
        this.born.delete(id);
        this.bornTemp.delete(id);
      }
    }
  }

  /**
   * Show the child's and its parents' brains the same inputs (senses recorded
   * from the parent and from random living creatures), and the same for two
   * random members of the parent's species, and record how far their outputs
   * differ. Brains are rebuilt from their genes, so anything learned in life
   * is left out and the world's brains are untouched.
   */
  private probe(child: number, parentId: number, otherParentId: number): void {
    const c = this.world.creatures;
    const parents: number[] = [];
    const kin: number[] = [];
    for (let i = 0; i < c.count; i++) {
      if (c.id[i] === parentId || (otherParentId !== 0 && c.id[i] === otherParentId)) parents.push(i);
    }
    if (parents.length === 0 || c.count < 3) return;
    const species = c.species[parents[0]!]!;
    for (let i = 0; i < c.count; i++) if (c.species[i] === species && i !== child) kin.push(i);
    if (kin.length < 2) return;
    const inputs: Float32Array[] = [c.brain[parents[0]!]!.activation.slice(0, INPUT_COUNT)];
    while (inputs.length < PROBE_INPUTS) {
      inputs.push(c.brain[this.rng.int(0, c.count)]!.activation.slice(0, INPUT_COUNT));
    }
    const childOut = outputs(c.brain[child]!, inputs);
    const gaps = parents.map((p) => compare(childOut, outputs(c.brain[p]!, inputs)));
    const nearer = gaps.reduce((best, g) => (g.gap < best.gap ? g : best));
    const a = kin[this.rng.int(0, kin.length)]!;
    let b = kin[this.rng.int(0, kin.length - 1)]!;
    if (b === a) b = kin[kin.length - 1]!;
    const pair = compare(outputs(c.brain[a]!, inputs), outputs(c.brain[b]!, inputs));
    this.childGap += nearer.gap;
    this.childMeanGap += gaps.reduce((sum, g) => sum + g.gap, 0) / gaps.length;
    this.childAgree += nearer.agree;
    this.speciesGap += pair.gap;
    this.speciesAgree += pair.agree;
    this.probes++;
  }

  summary(): LocalitySummary {
    let home = 0;
    let awayWeighted = 0;
    let weight = 0;
    // Each biome's home rate is compared with its own newcomers' rate, weighted by newcomers' exposure.
    for (let b = 0; b < BIOME_COUNT; b++) {
      if (this.homeExposure[b]! <= 0 || this.awayExposure[b]! <= 0 || this.awayBirths[b]! <= 0) continue;
      const w = this.awayExposure[b]!;
      home += (this.homeBirths[b]! / this.homeExposure[b]!) * w;
      awayWeighted += (this.awayBirths[b]! / this.awayExposure[b]!) * w;
      weight += w;
    }
    const n = Math.max(1, this.samples);
    return {
      residency: this.residency / n,
      furByBirth: this.furEta / n,
      sizeByBirth: this.sizeEta / n,
      tundraFur: this.tundraFur / Math.max(1, this.tundraSamples),
      desertFur: this.desertFur / Math.max(1, this.desertSamples),
      homeAdvantage: weight > 0 && awayWeighted > 0 ? home / awayWeighted : 0,
      furTemperatureR: this.furTempR / n,
      climateHomeGap: this.climateGap / n,
      residencyByChance: this.chanceResidency / n,
      childParentGap: this.childGap / Math.max(1, this.probes),
      childParentsMeanGap: this.childMeanGap / Math.max(1, this.probes),
      sameSpeciesGap: this.speciesGap / Math.max(1, this.probes),
      childParentAgree: this.childAgree / Math.max(1, this.probes),
      sameSpeciesAgree: this.speciesAgree / Math.max(1, this.probes),
      probes: this.probes,
      mutationRate: this.mutation / n,
    };
  }
}

/** A brain's outputs after each input has been held for a while, starting from rest. */
function outputs(brain: Brain, inputs: Float32Array[]): Float32Array[] {
  const copy = compileBrain(brain.links, brain.hiddenIds, brain.hiddenTau);
  return inputs.map((input) => {
    copy.activation.fill(0);
    copy.activation.set(input);
    for (let s = 0; s < PROBE_STEPS; s++) think(copy);
    return copy.activation.slice(INPUT_COUNT, INPUT_COUNT + OUTPUT_COUNT);
  });
}

/** Mean absolute output difference, and the share of on/off actions that agree. */
function compare(first: Float32Array[], second: Float32Array[]): { gap: number; agree: number } {
  let total = 0;
  let agree = 0;
  for (let k = 0; k < first.length; k++) {
    for (let o = 0; o < OUTPUT_COUNT; o++) total += Math.abs(first[k]![o]! - second[k]![o]!);
    for (const [o, on] of SWITCHES) if (first[k]![o]! >= on === second[k]![o]! >= on) agree++;
  }
  return { gap: total / (first.length * OUTPUT_COUNT), agree: agree / (first.length * SWITCHES.length) };
}

/**
 * Hidden neurons per brain, and how many of them matter: a neuron counts if
 * taking it out (with its links) changes the brain's outputs on real senses.
 * Measured on up to `limit` random living creatures.
 */
export function functionalHidden(world: World, limit = 200): { hidden: number; functional: number } {
  const c = world.creatures;
  const rng = new Rng('locality-hidden');
  const picks = Math.min(limit, c.count);
  let hidden = 0;
  let functional = 0;
  for (let n = 0; n < picks; n++) {
    const brain = c.brain[rng.int(0, c.count)]!;
    hidden += brain.hiddenIds.length;
    if (brain.hiddenIds.length === 0) continue;
    const inputs: Float32Array[] = [];
    while (inputs.length < PROBE_INPUTS) inputs.push(c.brain[rng.int(0, c.count)]!.activation.slice(0, INPUT_COUNT));
    const base = outputs(brain, inputs);
    brain.hiddenIds.forEach((id, k) => {
      const without = compileBrain(
        brain.links.filter((link) => link.from !== id && link.to !== id),
        brain.hiddenIds.filter((other) => other !== id),
        brain.hiddenTau.filter((_, j) => j !== k),
      );
      if (compare(base, outputs(without, inputs)).gap > 0.01) functional++;
    });
  }
  return { hidden: hidden / Math.max(1, picks), functional: functional / Math.max(1, picks) };
}
