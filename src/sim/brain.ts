import type { SimConfig } from './config';
import type { Rng } from './rng';

/**
 * Creature brains: small recurrent neural nets whose wiring is itself
 * inherited and mutated (NEAT-style). Input and output neurons are fixed;
 * hidden neurons and links appear and disappear through mutation.
 */

export const RAY_COUNT = 3;
/**
 * Per vision ray: plant cover, meat, scent, wall, then for the nearest
 * creature its nearness, colour match, relative size and whether it is sick.
 */
export const INPUTS_PER_RAY = 8;

export const Input = {
  /** First of RAY_COUNT * INPUTS_PER_RAY ray inputs, ordered left, ahead, right. */
  Rays: 0,
  Underfoot: RAY_COUNT * INPUTS_PER_RAY,
  MeatUnderfoot: RAY_COUNT * INPUTS_PER_RAY + 1,
  ScentUnderfoot: RAY_COUNT * INPUTS_PER_RAY + 2,
  Energy: RAY_COUNT * INPUTS_PER_RAY + 3,
  Health: RAY_COUNT * INPUTS_PER_RAY + 4,
  Age: RAY_COUNT * INPUTS_PER_RAY + 5,
  Clock: RAY_COUNT * INPUTS_PER_RAY + 6,
  /** Sunlight relative to average: above zero in summer, below in winter. */
  Season: RAY_COUNT * INPUTS_PER_RAY + 7,
  /** 1 while the creature itself is infected. */
  Sick: RAY_COUNT * INPUTS_PER_RAY + 8,
  Bias: RAY_COUNT * INPUTS_PER_RAY + 9,
} as const;
export const INPUT_COUNT = RAY_COUNT * INPUTS_PER_RAY + 10;

export const Output = { Turn: 0, Thrust: 1, Reproduce: 2, Attack: 3, Emit: 4 } as const;
export const OUTPUT_COUNT = 5;

/** Neuron ids below this are inputs and outputs; hidden neurons come after. */
const FIXED_NODES = INPUT_COUNT + OUTPUT_COUNT;

const RAY_NAMES = ['left', 'ahead', 'right'];
export const INPUT_LABELS: string[] = [
  ...RAY_NAMES.flatMap((ray) => [
    `Plants ${ray}`,
    `Meat ${ray}`,
    `Scent ${ray}`,
    `Wall ${ray}`,
    `Creature ${ray}`,
    `Kin ${ray}`,
    `Bigger ${ray}`,
    `Sick ${ray}`,
  ]),
  'Plants underfoot',
  'Meat underfoot',
  'Scent underfoot',
  'Energy',
  'Health',
  'Age',
  'Clock',
  'Season',
  'Sick',
  'Bias',
];
export const OUTPUT_LABELS: string[] = ['Turn', 'Thrust', 'Reproduce', 'Attack', 'Emit scent'];

export interface LinkGene {
  /** Id shared by every link between the same two neurons, across all brains. */
  innovation: number;
  from: number;
  to: number;
  weight: number;
  enabled: boolean;
}

export interface Brain {
  links: LinkGene[];
  /** Ids of the hidden neurons, ascending. */
  hiddenIds: number[];

  // Compiled form of the enabled links, indexing into `activation`.
  linkFrom: Uint16Array;
  linkTo: Uint16Array;
  linkWeight: Float32Array;
  /** Current output of every neuron: inputs, then outputs, then hidden. */
  activation: Float32Array;
  sum: Float32Array;
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
export function compileBrain(links: LinkGene[], hiddenIds: number[]): Brain {
  return compile(links, hiddenIds);
}

function compile(links: LinkGene[], hiddenIds: number[]): Brain {
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
  const nodes = FIXED_NODES + hiddenIds.length;
  return {
    links,
    hiddenIds,
    linkFrom,
    linkTo,
    linkWeight,
    activation: new Float32Array(nodes),
    sum: new Float32Array(nodes),
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
  return compile(links, []);
}

/** Add a link, or re-enable it if the brain already has one between these neurons. */
function addLink(links: LinkGene[], from: number, to: number, rng: Rng, innovations: Innovations): void {
  const existing = links.find((link) => link.from === from && link.to === to);
  if (existing) {
    existing.enabled = true;
    return;
  }
  links.push({
    innovation: innovations.linkId(from, to),
    from,
    to,
    weight: randomWeight(rng),
    enabled: true,
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
    addLink(links, pick(rng.int(0, sources)), pick(INPUT_COUNT + rng.int(0, targets)), rng, innovations);
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
        hiddenIds.push(node);
        hiddenIds.sort((a, b) => a - b);
        links.push(
          { innovation: innovations.linkId(split.from, node), from: split.from, to: node, weight: 1, enabled: true },
          { innovation: innovations.linkId(node, split.to), from: node, to: split.to, weight: split.weight, enabled: true },
        );
      }
    }
  }

  return compile(links, hiddenIds);
}

/**
 * Run the brain for one tick. The caller writes the inputs into
 * `activation[0..INPUT_COUNT)` first and reads the outputs from
 * `activation[INPUT_COUNT..)` after. Every neuron reads the values from the
 * previous tick, so a signal crosses one link per tick.
 */
export function think(brain: Brain): void {
  const { activation, sum, linkFrom, linkTo, linkWeight } = brain;
  for (let n = INPUT_COUNT; n < sum.length; n++) sum[n] = 0;
  for (let k = 0; k < linkWeight.length; k++) {
    sum[linkTo[k]!]! += activation[linkFrom[k]!]! * linkWeight[k]!;
  }
  for (let n = INPUT_COUNT; n < sum.length; n++) activation[n] = Math.tanh(sum[n]!);
}

/** Number of links that are switched on. */
export function enabledLinks(brain: Brain): number {
  return brain.linkWeight.length;
}

/** Energy the brain costs per tick. */
export function brainCost(brain: Brain, config: SimConfig): number {
  return brain.hiddenIds.length * config.brainNeuronCost + enabledLinks(brain) * config.brainLinkCost;
}
