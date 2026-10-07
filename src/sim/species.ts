import type { SimConfig } from './config';
import type { Creatures } from './creatures';
import type { Lineage, LineageNode } from './lineage';

/**
 * Groups creatures into species by ancestry and difference together: a
 * species is a branch of the family tree that split off long enough ago and
 * whose living members have, on average, become clearly different in body or
 * diet from the group they split from. Relatives therefore stay together,
 * and plant-eaters and meat-eaters end up apart.
 */

/**
 * Wiring is compared through a fixed number of bins: each link's innovation
 * id picks a bin, which counts the links in it (per member) and sums their
 * weights. That keeps a group's wiring a small fixed-size summary that can
 * be added and subtracted along the family tree like the gene averages.
 */
const WIRING_BINS = 128;
/** Weights differ by up to this much between two groups before the difference counts fully. */
const WEIGHT_SCALE = 4;

function binOf(innovation: number): number {
  return Math.imul(innovation, 2654435761) >>> 25;
}

/** A difference of this much in a gene's average counts as 1 toward the threshold. */
const SIZE_SCALE = 0.2;
const SPEED_SCALE = 0.2;
const SENSOR_SCALE = 0.35;
const DIET_SCALE = 0.15;
const FUR_SCALE = 0.25;
const DEFENSE_SCALE = 0.25;

export interface SpeciesRecord {
  id: number;
  /** Tick at which the species was first recognised. */
  bornTick: number;
  /** Members at the last classification. */
  count: number;
}

export interface SpeciesState {
  nextId: number;
  species: SpeciesRecord[];
}

export function createSpeciesState(): SpeciesState {
  return { nextId: 1, species: [] };
}

/** Sums over the living creatures in a branch. Sizes, speeds and ranges are summed as logs. */
interface Tally {
  count: number;
  size: number;
  speed: number;
  sensor: number;
  diet: number;
  fur: number;
  defense: number;
  /** Links per bin summed over members, and the sum of their weights. */
  links: Float32Array;
  weights: Float32Array;
}

function emptyTally(): Tally {
  return {
    count: 0,
    size: 0,
    speed: 0,
    sensor: 0,
    diet: 0,
    fur: 0,
    defense: 0,
    links: new Float32Array(WIRING_BINS),
    weights: new Float32Array(WIRING_BINS),
  };
}

function cloneTally(from: Tally): Tally {
  return { ...from, links: from.links.slice(), weights: from.weights.slice() };
}

/**
 * How different two groups' wiring is, from 0 (the same links) to about 1
 * (no links in common): the share of links, per member, that one group has
 * and the other lacks, plus how far the weights of the shared ones differ.
 */
function wiringDifference(a: Tally, b: Tally): number {
  let apart = 0;
  let either = 0;
  let weight = 0;
  let shared = 0;
  for (let bin = 0; bin < WIRING_BINS; bin++) {
    const fa = a.links[bin]! / a.count;
    const fb = b.links[bin]! / b.count;
    apart += Math.abs(fa - fb);
    either += Math.max(fa, fb);
    const common = Math.min(fa, fb);
    if (common > 0) {
      weight += common * Math.abs(a.weights[bin]! / a.links[bin]! - b.weights[bin]! / b.links[bin]!);
      shared += common;
    }
  }
  const missing = either > 0 ? apart / either : 0;
  const stronger = shared > 0 ? Math.min(1, weight / shared / WEIGHT_SCALE) : 0;
  return missing + stronger;
}

function add(into: Tally, from: Tally, sign = 1): void {
  for (let bin = 0; bin < WIRING_BINS; bin++) {
    into.links[bin]! += sign * from.links[bin]!;
    into.weights[bin]! += sign * from.weights[bin]!;
  }
  into.count += sign * from.count;
  into.size += sign * from.size;
  into.speed += sign * from.speed;
  into.sensor += sign * from.sensor;
  into.diet += sign * from.diet;
  into.fur += sign * from.fur;
  into.defense += sign * from.defense;
}

/** How different the average members of two groups are: 1 or more is a clear difference. */
function difference(a: Tally, b: Tally, config: SimConfig): number {
  const wiring = config.speciesBrainScale > 0 ? wiringDifference(a, b) / config.speciesBrainScale : 0;
  return (
    wiring +
    Math.abs(a.size / a.count - b.size / b.count) / SIZE_SCALE +
    Math.abs(a.speed / a.count - b.speed / b.count) / SPEED_SCALE +
    Math.abs(a.sensor / a.count - b.sensor / b.count) / SENSOR_SCALE +
    Math.abs(a.diet / a.count - b.diet / b.count) / DIET_SCALE +
    Math.abs(a.fur / a.count - b.fur / b.count) / FUR_SCALE +
    Math.abs(a.defense / a.count - b.defense / b.count) / DEFENSE_SCALE
  );
}

interface Group {
  /** Living members not yet split off into a sub-branch's species. */
  tally: Tally;
  members: number[];
  nodes: LineageNode[];
}

/**
 * Assign every creature, and every node of the family tree, to a species.
 * A species keeps its id from one call to the next as long as most of its
 * members were in it before.
 */
export function classifySpecies(
  state: SpeciesState,
  c: Creatures,
  lineage: Lineage,
  tick: number,
  config: SimConfig,
): void {
  const indexOf = new Map<number, number>();
  for (let i = 0; i < c.count; i++) indexOf.set(c.id[i]!, i);

  // Tally the living members of every branch, children before parents.
  const tallies = new Map<number, Tally>();
  const roots: LineageNode[] = [];
  for (const node of lineage.all()) if (node.parentId === 0) roots.push(node);
  roots.sort((a, b) => a.id - b.id);

  const order: LineageNode[] = [];
  const pending = roots.slice().reverse();
  while (pending.length > 0) {
    const node = pending.pop()!;
    order.push(node);
    for (let k = node.children.length - 1; k >= 0; k--) pending.push(lineage.get(node.children[k]!)!);
  }
  for (let k = order.length - 1; k >= 0; k--) {
    const node = order[k]!;
    const tally = emptyTally();
    const i = indexOf.get(node.id);
    if (i !== undefined) {
      tally.count = 1;
      tally.size = Math.log(c.size[i]!);
      tally.speed = Math.log(c.speed[i]!);
      tally.sensor = Math.log(c.sensorRange[i]!);
      tally.diet = c.diet[i]!;
      tally.fur = c.fur[i]!;
      tally.defense = c.defense[i]!;
      if (config.speciesBrainScale > 0) {
        const brain = c.brain[i]!;
        for (let k = 0; k < brain.links.length; k++) {
          const link = brain.links[k]!;
          if (!link.enabled) continue;
          const bin = binOf(link.innovation);
          tally.links[bin]!++;
          tally.weights[bin]! += link.weight;
        }
      }
    }
    for (const child of node.children) add(tally, tallies.get(child)!);
    tallies.set(node.id, tally);
  }

  // Walk down from the trunk, splitting off each branch that qualifies.
  const trunk: Group = { tally: emptyTally(), members: [], nodes: [] };
  for (const root of roots) add(trunk.tally, tallies.get(root.id)!);
  const groups: Group[] = [trunk];
  const walk: [LineageNode, Group][] = roots
    .slice()
    .reverse()
    .map((root) => [root, trunk]);
  while (walk.length > 0) {
    const [node, parentGroup] = walk.pop()!;
    const branch = tallies.get(node.id)!;
    let group = parentGroup;
    const rest = parentGroup.tally.count - branch.count;
    if (
      tick - node.birthTick >= config.speciesMinAge &&
      branch.count >= config.speciesMinMembers &&
      rest >= config.speciesMinMembers
    ) {
      const others = cloneTally(parentGroup.tally);
      add(others, branch, -1);
      if (difference(branch, others, config) >= config.speciesThreshold) {
        parentGroup.tally = others;
        group = { tally: cloneTally(branch), members: [], nodes: [] };
        groups.push(group);
      }
    }
    group.nodes.push(node);
    const i = indexOf.get(node.id);
    if (i !== undefined) group.members.push(i);
    for (let k = node.children.length - 1; k >= 0; k--) walk.push([lineage.get(node.children[k]!)!, group]);
  }

  // Largest groups choose first: each keeps the id most of its members already had.
  const known = new Map(state.species.map((record) => [record.id, record]));
  const taken = new Set<number>();
  const records: SpeciesRecord[] = [];
  const live = groups.filter((group) => group.members.length > 0);
  live.sort((a, b) => b.members.length - a.members.length);
  for (const group of live) {
    const votes = new Map<number, number>();
    for (const i of group.members) {
      const previous = c.species[i]!;
      if (previous !== 0) votes.set(previous, (votes.get(previous) ?? 0) + 1);
    }
    let id = 0;
    let most = 0;
    for (const [candidate, count] of votes) {
      if (!taken.has(candidate) && (count > most || (count === most && candidate < id))) {
        id = candidate;
        most = count;
      }
    }
    if (id === 0) id = state.nextId++;
    taken.add(id);
    records.push({ id, bornTick: known.get(id)?.bornTick ?? tick, count: group.members.length });
    for (const i of group.members) c.species[i] = id;
    for (const node of group.nodes) node.species = id;
  }
  state.species = records;
}
