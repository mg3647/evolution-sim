import type { SimConfig } from './config';
import type { Rng } from './rng';

/**
 * Creature brains: small recurrent neural nets whose wiring is itself
 * inherited and mutated (NEAT-style). Input and output neurons are fixed;
 * hidden neurons and links appear and disappear through mutation.
 */

export const RAY_COUNT = 3;
/** What each vision ray reports, as offsets within the ray's block of inputs. */
export const Ray = {
  // The ground along the ray.
  Plants: 0,
  Meat: 1,
  Water: 2,
  Wall: 3,
  // The nearest creature in the ray's direction; all zero if there is none.
  /** 1 touching, 0 at the edge of sight. */
  Near: 4,
  /** How alike its colour is: 1 the same, -1 opposite. */
  Kin: 5,
  /** Above zero if it is bigger, below if smaller. */
  Bigger: 6,
  /** -1 a pure plant-eater, 1 a pure meat-eater. */
  MeatEater: 7,
  /** 1 facing straight this way, -1 facing directly away. */
  Approaching: 8,
  /** 0 healthy, 1 nearly dead or sick. */
  Hurt: 9,
  /**
   * Its actual colour, as a point on the colour wheel: Warm is 1 for red and
   * -1 for cyan; Green is 1 for yellow-green and -1 for violet.
   */
  ColourWarm: 10,
  ColourGreen: 11,
  /** Fire along the ray, stronger when nearer. */
  Fire: 12,
  /** A branch or stone lying along the ray, stronger when nearer. */
  Items: 13,
  /** A block along the ray, stronger when nearer; below zero for a heavy block. Walls read on their own input. */
  Block: 14,
  /** How brightly it is displaying (see the Display output); 0 if it is not, or if nobody is there. */
  Display: 15,
} as const;
export const INPUTS_PER_RAY = 16;

const AFTER_RAYS = RAY_COUNT * INPUTS_PER_RAY;
export const Input = {
  /** First of RAY_COUNT * INPUTS_PER_RAY ray inputs, ordered left, ahead, right. */
  Rays: 0,
  /** How near the closest creature outside the field of view is. */
  Behind: AFTER_RAYS,
  /** How many creatures are within sensing range, up to 1 for a crowd. */
  Crowding: AFTER_RAYS + 1,
  Underfoot: AFTER_RAYS + 2,
  MeatUnderfoot: AFTER_RAYS + 3,
  /** 1 while the creature is in water. */
  InWater: AFTER_RAYS + 4,
  ScentUnderfoot: AFTER_RAYS + 5,
  /** Above zero if scent is stronger to the right, below if to the left. */
  ScentSide: AFTER_RAYS + 6,
  /** How loud calls are to the left and to the right. */
  HearLeft: AFTER_RAYS + 7,
  HearRight: AFTER_RAYS + 8,
  Energy: AFTER_RAYS + 9,
  Health: AFTER_RAYS + 10,
  /** 0 when full of water, 1 when about to die of thirst. */
  Thirst: AFTER_RAYS + 11,
  Age: AFTER_RAYS + 12,
  /** How badly it has been bitten since its last turn. */
  Pain: AFTER_RAYS + 13,
  /** 1 while the creature itself is infected. */
  Sick: AFTER_RAYS + 14,
  Clock: AFTER_RAYS + 15,
  /** Sunlight relative to average: above zero in summer, below in winter. */
  Season: AFTER_RAYS + 16,
  /** 0 at midnight, 1 at noon. */
  Daylight: AFTER_RAYS + 17,
  /** How hot it is where the creature stands: -1 freezing, 1 scorching. */
  Temperature: AFTER_RAYS + 18,
  /** Above zero if it is warmer straight ahead, below if colder. */
  WarmerAhead: AFTER_RAYS + 19,
  /** What lies underfoot to pick up: 1 a stone, -1 a branch, 0 neither. */
  ItemUnderfoot: AFTER_RAYS + 20,
  /** Stored food underfoot, dropped here by some creature. */
  StoreUnderfoot: AFTER_RAYS + 21,
  /** What it is holding: 1 a stone, -1 a branch, 0 neither. */
  HoldingTool: AFTER_RAYS + 22,
  /** How much food it is holding, up to 1 for a full load. */
  HoldingFood: AFTER_RAYS + 23,
  /** 1 while it is carrying a block. */
  HoldingBlock: AFTER_RAYS + 24,
  /** Whether its energy has lately been rising (above zero) or falling (below): a smoothed reward signal. */
  EnergyTrend: AFTER_RAYS + 25,
  Bias: AFTER_RAYS + 26,
} as const;
export const INPUT_COUNT = AFTER_RAYS + 27;

export const Output = {
  Turn: 0,
  Thrust: 1,
  Reproduce: 2,
  Attack: 3,
  Emit: 4,
  Call: 5,
  Give: 6,
  Hold: 7,
  /** At or above zero it is willing to mate with a willing creature in reach. */
  Mate: 8,
  /** Scales and signs how fast its links learn: 0 leaves learning as it is, 1 triples it, -1 reverses it. */
  Learn: 9,
  /** Below -0.5 it does not eat; at or above, it eats what is underfoot as before. */
  Eat: 10,
  /** Above zero it shows a bright signal to others, at a cost in energy. */
  Display: 11,
} as const;
export const OUTPUT_COUNT = 12;

/** Neuron ids below this are inputs and outputs; hidden neurons come after. */
const FIXED_NODES = INPUT_COUNT + OUTPUT_COUNT;

/** Learning never pushes a weight's size past this. */
const MAX_LIVE_WEIGHT = 4;

const RAY_NAMES = ['left', 'ahead', 'right'];
export const INPUT_LABELS: string[] = [
  ...RAY_NAMES.flatMap((ray) => [
    `Plants ${ray}`,
    `Meat ${ray}`,
    `Water ${ray}`,
    `Wall ${ray}`,
    `Creature ${ray}`,
    `Kin ${ray}`,
    `Bigger ${ray}`,
    `Meat-eater ${ray}`,
    `Coming ${ray}`,
    `Hurt ${ray}`,
    `Red or cyan ${ray}`,
    `Green or violet ${ray}`,
    `Fire ${ray}`,
    `Branch or stone ${ray}`,
    `Block ${ray}`,
    `Display ${ray}`,
  ]),
  'Creature behind',
  'Crowding',
  'Plants underfoot',
  'Meat underfoot',
  'In water',
  'Scent underfoot',
  'Scent to the right',
  'Calls on the left',
  'Calls on the right',
  'Energy',
  'Health',
  'Thirst',
  'Age',
  'Pain',
  'Sick',
  'Clock',
  'Season',
  'Daylight',
  'Temperature',
  'Warmer ahead',
  'Stone or branch underfoot',
  'Stored food underfoot',
  'Holding stone or branch',
  'Holding food',
  'Holding a block',
  'Energy trend',
  'Bias',
];
export const OUTPUT_LABELS: string[] = [
  'Turn',
  'Thrust',
  'Reproduce',
  'Attack',
  'Emit scent',
  'Call',
  'Give',
  'Hold',
  'Mate',
  'Learn',
  'Eat',
  'Display',
];

export interface LinkGene {
  /** Id shared by every link between the same two neurons, across all brains. */
  innovation: number;
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
  /**
   * How fast the live weight follows the two neurons' activity during life
   * (Hebbian learning). 0 keeps the weight fixed. Absent in older saves.
   */
  plasticity?: number;
}

export interface Brain {
  links: LinkGene[];
  /** Ids of the hidden neurons, ascending. */
  hiddenIds: number[];
  /**
   * Time constant of each hidden neuron, in ticks, in the same order as `hiddenIds`.
   * 1 follows its input at once; larger values change slowly and hold a state.
   */
  hiddenTau: number[];

  // Compiled form of the enabled links, indexing into `activation`.
  linkFrom: Uint16Array;
  linkTo: Uint16Array;
  linkWeight: Float32Array;
  /** Current output of every neuron: inputs, then outputs, then hidden. */
  activation: Float32Array;
  sum: Float32Array;
  /** Indices into the compiled links of those that can learn, and how fast each does. Empty for most brains. */
  plasticLinks: Uint16Array;
  plasticRate: Float32Array;
  /** The inherited weight of each of those links, which the live weight is pulled back toward. */
  plasticBase: Float32Array;
  /** Share of the way each neuron moves toward its new value per tick: 1 / time constant. */
  rate: Float32Array;
}

/**
 * Hands out ids for new links and neurons so the same structural mutation
 * gets the same id wherever it happens. One per world.
 */
export class Innovations {
  private links = new Map<string, number>();
  private splits = new Map<number, number>();
  private nextLink = 0;
  private nextNode = FIXED_NODES;

  linkId(from: number, to: number): number {
    const key = `${from}>${to}`;
    let id = this.links.get(key);
    if (id === undefined) {
      id = this.nextLink++;
      this.links.set(key, id);
    }
    return id;
  }

  /** Id of the neuron created by splitting the link with this innovation id. */
  splitNode(linkInnovation: number): number {
    let id = this.splits.get(linkInnovation);
    if (id === undefined) {
      id = this.nextNode++;
      this.splits.set(linkInnovation, id);
    }
    return id;
  }

  /** Counters, for hashing world state. */
  counts(): [number, number] {
    return [this.nextLink, this.nextNode];
  }

  /** Everything needed to rebuild this registry, as plain data. */
  save(): InnovationsData {
    return {
      links: [...this.links],
      splits: [...this.splits],
      nextLink: this.nextLink,
      nextNode: this.nextNode,
    };
  }

  static load(data: InnovationsData): Innovations {
    const innovations = new Innovations();
    innovations.links = new Map(data.links);
    innovations.splits = new Map(data.splits);
    innovations.nextLink = data.nextLink;
    innovations.nextNode = data.nextNode;
    return innovations;
  }
}

export interface InnovationsData {
  links: [string, number][];
  splits: [number, number][];
  nextLink: number;
  nextNode: number;
}

/**
 * Build a brain from its genes, with activations at zero. The fast arrays are
 * derived from the genes, so call this after any change to links or neurons.
 */
export function compileBrain(links: LinkGene[], hiddenIds: number[], hiddenTau?: number[]): Brain {
  return compile(links, hiddenIds, hiddenTau ?? hiddenIds.map(() => 1));
}

function compile(links: LinkGene[], hiddenIds: number[], hiddenTau: number[]): Brain {
  const indexOf = (id: number) => (id < FIXED_NODES ? id : FIXED_NODES + hiddenIds.indexOf(id));
  const enabled = links.filter((link) => link.enabled);
  const linkFrom = new Uint16Array(enabled.length);
  const linkTo = new Uint16Array(enabled.length);
  const linkWeight = new Float32Array(enabled.length);
  enabled.forEach((link, k) => {
    linkFrom[k] = indexOf(link.from);
    linkTo[k] = indexOf(link.to);
    linkWeight[k] = link.weight;
  });
  const plastic: number[] = [];
  const plasticRates: number[] = [];
  const plasticBases: number[] = [];
  enabled.forEach((link, k) => {
    if ((link.plasticity ?? 0) > 0) {
      plastic.push(k);
      plasticRates.push(link.plasticity!);
      plasticBases.push(link.weight);
    }
  });
  const nodes = FIXED_NODES + hiddenIds.length;
  // Inputs and outputs answer at once; only hidden neurons can be slow.
  const rate = new Float32Array(nodes).fill(1);
  hiddenTau.forEach((tau, k) => {
    rate[FIXED_NODES + k] = 1 / tau;
  });
  return {
    links,
    hiddenIds,
    hiddenTau,
    linkFrom,
    linkTo,
    linkWeight,
    activation: new Float32Array(nodes),
    sum: new Float32Array(nodes),
    plasticLinks: Uint16Array.from(plastic),
    plasticRate: Float32Array.from(plasticRates),
    plasticBase: Float32Array.from(plasticBases),
    rate,
  };
}

function randomWeight(rng: Rng): number {
  return rng.gaussian();
}

/** Brain for a creature with no parent: a few random input-to-output links. */
export function founderBrain(rng: Rng, innovations: Innovations, config: SimConfig): Brain {
  const links: LinkGene[] = [];
  for (let k = 0; k < config.founderLinks; k++) {
    addLink(links, rng.int(0, INPUT_COUNT), INPUT_COUNT + rng.int(0, OUTPUT_COUNT), rng, innovations);
  }
  return compile(links, [], []);
}

/** Add a link, or re-enable it if the brain already has one between these neurons. */
function addLink(links: LinkGene[], from: number, to: number, rng: Rng, innovations: Innovations, scale = 1): void {
  const existing = links.find((link) => link.from === from && link.to === to);
  if (existing) {
    existing.enabled = true;
    return;
  }
  links.push({
    innovation: innovations.linkId(from, to),
    from,
    to,
    weight: randomWeight(rng) * scale,
    enabled: true,
    plasticity: 0,
  });
}

/**
 * A mutated copy of a brain for a child. Weights shift a little; rarely a
 * link is added, a link is switched on or off, or a link is split in two by
 * a new neuron. Activations start at zero.
 */
export function mutateBrain(
  parent: Brain,
  mutationRate: number,
  rng: Rng,
  innovations: Innovations,
  config: SimConfig,
): Brain {
  const links = parent.links.map((link) => ({ ...link }));
  const hiddenIds = parent.hiddenIds.slice();
  const hiddenTau = parent.hiddenTau.slice();

  for (const link of links) {
    if (rng.chance(config.weightResetChance)) link.weight = randomWeight(rng);
    else if (rng.chance(config.weightChangeChance)) {
      link.weight += rng.gaussian() * mutationRate * config.weightChangeScale;
    }
  }

  if (rng.chance(config.addLinkChance) && links.length < config.maxLinks) {
    // Any neuron can feed any non-input neuron, including itself: loops give memory.
    const sources = FIXED_NODES + hiddenIds.length;
    const targets = OUTPUT_COUNT + hiddenIds.length;
    const pick = (index: number) => (index < FIXED_NODES ? index : hiddenIds[index - FIXED_NODES]!);
    addLink(links, pick(rng.int(0, sources)), pick(INPUT_COUNT + rng.int(0, targets)), rng, innovations, config.newLinkWeightScale);
  }

  if (rng.chance(config.toggleLinkChance) && links.length > 0) {
    const link = rng.pick(links);
    link.enabled = !link.enabled;
  }

  if (
    rng.chance(config.addNeuronChance) &&
    hiddenIds.length < config.maxHiddenNeurons &&
    links.length + 2 <= config.maxLinks
  ) {
    const enabled = links.filter((link) => link.enabled);
    if (enabled.length > 0) {
      const split = rng.pick(enabled);
      const node = innovations.splitNode(split.innovation);
      if (!hiddenIds.includes(node)) {
        // The new neuron sits in the middle of the old link, which is switched off.
        split.enabled = false;
        // Ids stay ascending, with each neuron's time constant beside it. A new neuron answers at once.
        let at = hiddenIds.findIndex((id) => id > node);
        if (at < 0) at = hiddenIds.length;
        hiddenIds.splice(at, 0, node);
        hiddenTau.splice(at, 0, 1);
        links.push(
          { innovation: innovations.linkId(split.from, node), from: split.from, to: node, weight: 1, enabled: true, plasticity: 0 },
          { innovation: innovations.linkId(node, split.to), from: node, to: split.to, weight: split.weight, enabled: true, plasticity: split.plasticity ?? 0 },
        );
      }
    }
  }

  for (const link of links) {
    if (rng.chance(config.plasticityChangeChance)) {
      const shifted = (link.plasticity ?? 0) + rng.gaussian() * config.plasticityChangeScale;
      link.plasticity = Math.fround(Math.min(config.maxPlasticity, Math.max(0, shifted)));
    }
  }

  for (let k = 0; k < hiddenTau.length; k++) {
    if (rng.chance(config.tauChangeChance)) {
      const tau = hiddenTau[k]! * Math.exp(rng.gaussian() * config.tauChangeScale);
      hiddenTau[k] = Math.fround(Math.min(config.maxNeuronTau, Math.max(1, tau)));
    }
  }

  return compile(links, hiddenIds, hiddenTau);
}

/** Chance that a link switched off in either parent is switched off in the child (NEAT's 75%). */
const INHERIT_DISABLED = 0.75;

/**
 * The brain of a child of two, before mutation, after NEAT's crossover. One
 * parent, chosen at random, gives the structure: all its links and hidden
 * neurons, as NEAT takes unmatched genes from the fitter parent (here nobody
 * is fitter, so nobody is favoured). A link both parents have, found by its
 * innovation id, comes whole (weight and learning rate together) from either
 * at random, and stays switched off with probability 0.75 if either parent
 * had it off. The child's links are therefore a subset of the donor's, so
 * the caps on links and neurons hold without trimming.
 */
export function crossoverBrain(a: Brain, b: Brain, rng: Rng): Brain {
  const [donor, other] = rng.chance(0.5) ? [a, b] : [b, a];
  const theirs = new Map(other.links.map((link) => [link.innovation, link]));
  const links = donor.links.map((link): LinkGene => {
    const match = theirs.get(link.innovation);
    if (!match) return { ...link };
    const from = rng.chance(0.5) ? link : match;
    const off = !link.enabled || !match.enabled;
    return { ...from, enabled: off ? !rng.chance(INHERIT_DISABLED) : true };
  });
  return compile(links, donor.hiddenIds.slice(), donor.hiddenTau.slice());
}

/**
 * Run the brain for one tick. The caller writes the inputs into
 * `activation[0..INPUT_COUNT)` first and reads the outputs from
 * `activation[INPUT_COUNT..)` after. Every neuron reads the values from the
 * previous tick, so a signal crosses one link per tick. A hidden neuron with
 * a time constant above 1 moves only part of the way to its new value each
 * tick, so it changes slowly and keeps a memory of what came before. `decay`
 * is the share of the gap between a learning link's live and inherited weight
 * that closes each tick.
 */
export function think(brain: Brain, decay = 0): void {
  const { activation, sum, linkFrom, linkTo, linkWeight, rate } = brain;
  for (let n = INPUT_COUNT; n < sum.length; n++) sum[n] = 0;
  for (let k = 0; k < linkWeight.length; k++) {
    sum[linkTo[k]!]! += activation[linkFrom[k]!]! * linkWeight[k]!;
  }
  for (let n = INPUT_COUNT; n < sum.length; n++) {
    const target = Math.tanh(sum[n]!);
    const r = rate[n]!;
    activation[n] = r >= 1 ? target : activation[n]! + (target - activation[n]!) * r;
  }
  // Learning: a link whose two ends are active together strengthens (or, if one
  // end is negative, weakens), scaled by the Learn output (1 + 2 x its value, so
  // an unwired Learn leaves it as it was and a negative one unlearns), and every
  // live weight is pulled back toward the weight it was born with. The live
  // weight never grows past the limit, but a weight already beyond it is left
  // alone. Children start from the genes.
  const { plasticLinks, plasticRate, plasticBase } = brain;
  if (plasticLinks.length === 0) return;
  const modulation = 1 + 2 * activation[INPUT_COUNT + Output.Learn]!;
  for (let p = 0; p < plasticLinks.length; p++) {
    const k = plasticLinks[p]!;
    const old = linkWeight[k]!;
    const next =
      old +
      modulation * plasticRate[p]! * activation[linkFrom[k]!]! * activation[linkTo[k]!]! -
      decay * (old - plasticBase[p]!);
    linkWeight[k] = Math.abs(next) > MAX_LIVE_WEIGHT && Math.abs(next) > Math.abs(old) ? old : next;
  }
}

/**
 * Whether the enabled links contain a loop (including a neuron feeding
 * itself). Only a brain with a loop can carry anything over from one tick
 * to the next beyond a slow neuron's own lag.
 */
export function hasLoop(brain: Brain): boolean {
  const nodes = brain.activation.length;
  const outgoing: number[][] = Array.from({ length: nodes }, () => []);
  for (let k = 0; k < brain.linkFrom.length; k++) {
    // Inputs are set from outside, so a link into one cannot exist; start from links between other neurons.
    if (brain.linkFrom[k]! >= INPUT_COUNT) outgoing[brain.linkFrom[k]!]!.push(brain.linkTo[k]!);
  }
  // Depth-first search: 0 unvisited, 1 on the current path, 2 finished.
  const state = new Uint8Array(nodes);
  const visit = (n: number): boolean => {
    state[n] = 1;
    for (const next of outgoing[n]!) {
      if (state[next] === 1) return true;
      if (state[next] === 0 && visit(next)) return true;
    }
    state[n] = 2;
    return false;
  };
  for (let n = INPUT_COUNT; n < nodes; n++) if (state[n] === 0 && visit(n)) return true;
  return false;
}

/** Number of links that are switched on. */
export function enabledLinks(brain: Brain): number {
  return brain.linkWeight.length;
}

/** Energy the brain costs per tick. */
export function brainCost(brain: Brain, config: SimConfig): number {
  return brain.hiddenIds.length * config.brainNeuronCost + enabledLinks(brain) * config.brainLinkCost;
}
