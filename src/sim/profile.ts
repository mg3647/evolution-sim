import { INPUT_COUNT, OUTPUT_COUNT } from './brain';
import type { Creatures } from './creatures';

/**
 * Summaries of how a group of creatures' brains are wired, for comparing
 * groups: which links most members share, and how strong they are.
 */

/** Neuron number that stands for "any hidden neuron" in a profile. */
export const HIDDEN_NODE = INPUT_COUNT + OUTPUT_COUNT;

export interface ProfileLink {
  /** Neuron numbers: inputs first, then outputs, then HIDDEN_NODE for any hidden neuron. */
  from: number;
  to: number;
  /** Share of the group's members that have this link switched on. */
  share: number;
  /** Mean weight of the link among the members that have it. */
  weight: number;
}

export interface BrainProfile {
  /** Number of creatures in the group. */
  count: number;
  meanLinks: number;
  meanHidden: number;
  /** Links at least `minShare` of members have, most common first. */
  links: ProfileLink[];
  /** Per input, the share of members whose brain has any link leading out of it. */
  inputUse: number[];
}

/**
 * Profile the brains of the creatures at `indices`. Hidden neurons differ
 * from brain to brain, so they are pooled: a link into any hidden neuron
 * counts as a link to "hidden", and likewise out of one.
 */
export function brainProfile(c: Creatures, indices: readonly number[], minShare = 0.1): BrainProfile {
  const nodes = HIDDEN_NODE + 1;
  const members = new Uint32Array(nodes * nodes);
  const weights = new Float64Array(nodes * nodes);
  /** Marks the links already counted for the current member, by its position + 1. */
  const seen = new Uint32Array(nodes * nodes);
  let linkTotal = 0;
  let hiddenTotal = 0;
  const inputMembers = new Uint32Array(INPUT_COUNT);
  /** Marks the inputs already counted for the current member, by its position + 1. */
  const inputSeen = new Uint32Array(INPUT_COUNT);

  indices.forEach((i, position) => {
    const brain = c.brain[i]!;
    linkTotal += brain.linkWeight.length;
    hiddenTotal += brain.hiddenIds.length;
    for (let k = 0; k < brain.linkWeight.length; k++) {
      const from = Math.min(brain.linkFrom[k]!, HIDDEN_NODE);
      const to = Math.min(brain.linkTo[k]!, HIDDEN_NODE);
      const key = from * nodes + to;
      if (from < INPUT_COUNT && inputSeen[from] !== position + 1) {
        inputSeen[from] = position + 1;
        inputMembers[from]!++;
      }
      weights[key]! += brain.linkWeight[k]!;
      if (seen[key] !== position + 1) {
        seen[key] = position + 1;
        members[key]!++;
      }
    }
  });

  const count = indices.length;
  const links: ProfileLink[] = [];
  for (let key = 0; key < members.length; key++) {
    if (members[key] === 0 || members[key]! / count < minShare) continue;
    links.push({
      from: Math.floor(key / nodes),
      to: key % nodes,
      share: members[key]! / count,
      weight: weights[key]! / members[key]!,
    });
  }
  links.sort((a, b) => b.share - a.share || a.from - b.from || a.to - b.to);
  return {
    count,
    meanLinks: count > 0 ? linkTotal / count : 0,
    meanHidden: count > 0 ? hiddenTotal / count : 0,
    links,
    inputUse: Array.from(inputMembers, (members) => (count > 0 ? members / count : 0)),
  };
}
