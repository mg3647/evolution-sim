import { describe, expect, it } from 'vitest';
import { compileBrain, Input, INPUT_COUNT, Output, type LinkGene } from './brain';
import { createCreatures, spawnCreature } from './creatures';
import { brainProfile, HIDDEN_NODE } from './profile';

const TURN = INPUT_COUNT + Output.Turn;
const THRUST = INPUT_COUNT + Output.Thrust;
const genes = { size: 1, speed: 1, sensorRange: 1, diet: 0.1, hue: 0.5, mutationRate: 0.05 };

function link(innovation: number, from: number, to: number, weight: number, enabled = true): LinkGene {
  return { innovation, from, to, weight, enabled };
}

function population(brains: { links: LinkGene[]; hidden?: number[] }[]) {
  const c = createCreatures(8);
  for (const brain of brains) {
    spawnCreature(c, { x: 0, y: 0, heading: 0, energy: 1, genes, brain: compileBrain(brain.links, brain.hidden ?? []) });
  }
  return c;
}

describe('brainProfile', () => {
  it('reports the share of members with each link and its mean weight among them', () => {
    const c = population([
      { links: [link(0, Input.Bias, TURN, 1), link(1, Input.Energy, THRUST, -2)] },
      { links: [link(0, Input.Bias, TURN, 3)] },
      { links: [] },
      { links: [link(0, Input.Bias, TURN, 2)] },
    ]);
    const profile = brainProfile(c, [0, 1, 2, 3]);
    expect(profile.count).toBe(4);
    expect(profile.meanLinks).toBe(1);
    expect(profile.links).toEqual([
      { from: Input.Bias, to: TURN, share: 0.75, weight: 2 },
      { from: Input.Energy, to: THRUST, share: 0.25, weight: -2 },
    ]);
  });

  it('covers only the creatures asked for', () => {
    const c = population([{ links: [link(0, Input.Bias, TURN, 1)] }, { links: [link(1, Input.Energy, THRUST, 1)] }]);
    expect(brainProfile(c, [1]).links).toEqual([{ from: Input.Energy, to: THRUST, share: 1, weight: 1 }]);
  });

  it('pools hidden neurons into one, counting each member once per pooled link', () => {
    const first = HIDDEN_NODE;
    const second = HIDDEN_NODE + 1;
    const c = population([
      {
        hidden: [first, second],
        links: [
          link(0, Input.Bias, first, 1),
          link(1, Input.Bias, second, 3),
          link(2, first, TURN, 0.5),
          link(3, first, second, 1),
        ],
      },
    ]);
    const profile = brainProfile(c, [0]);
    expect(profile.meanHidden).toBe(2);
    const find = (from: number, to: number) => profile.links.find((l) => l.from === from && l.to === to);
    // Two links into hidden neurons: one member, weights summed.
    expect(find(Input.Bias, HIDDEN_NODE)).toEqual({ from: Input.Bias, to: HIDDEN_NODE, share: 1, weight: 4 });
    expect(find(HIDDEN_NODE, TURN)!.share).toBe(1);
    expect(find(HIDDEN_NODE, HIDDEN_NODE)!.share).toBe(1);
  });

  it('ignores links that are switched off and leaves out rare ones', () => {
    const c = population([
      { links: [link(0, Input.Bias, TURN, 1, false)] },
      { links: [link(1, Input.Energy, THRUST, 1)] },
      ...Array.from({ length: 4 }, () => ({ links: [] })),
    ]);
    expect(brainProfile(c, [0, 1, 2, 3, 4, 5], 0.5).links).toEqual([]);
    expect(brainProfile(c, [0, 1, 2, 3, 4, 5], 0.1).links).toHaveLength(1);
  });

  it('handles an empty group', () => {
    const profile = brainProfile(createCreatures(4), []);
    expect(profile).toEqual({ count: 0, meanLinks: 0, meanHidden: 0, links: [] });
  });
});
