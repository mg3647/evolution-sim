import { describe, expect, it } from 'vitest';
import {
  brainCost,
  compileBrain,
  enabledLinks,
  founderBrain,
  hasLoop,
  idleOutputs,
  Innovations,
  INPUT_COUNT,
  INPUT_LABELS,
  Input,
  mutateBrain,
  OUTPUT_COUNT,
  OUTPUT_LABELS,
  Output,
  think,
  type Brain,
} from './brain';
import { defaultConfig, type SimConfig } from './config';
import { Rng } from './rng';

const config = defaultConfig;
const FIXED = INPUT_COUNT + OUTPUT_COUNT;

/** A config where exactly one kind of structural mutation always happens. */
function only(overrides: Partial<SimConfig>): SimConfig {
  return {
    ...config,
    weightChangeChance: 0,
    weightResetChance: 0,
    addLinkChance: 0,
    addNeuronChance: 0,
    toggleLinkChance: 0,
    tauChangeChance: 0,
    plasticityChangeChance: 0,
    ...overrides,
  };
}

function output(brain: Brain, index: number): number {
  return brain.activation[INPUT_COUNT + index]!;
}

describe('labels', () => {
  it('names every input and output', () => {
    expect(INPUT_LABELS).toHaveLength(INPUT_COUNT);
    expect(OUTPUT_LABELS).toHaveLength(OUTPUT_COUNT);
    expect(INPUT_LABELS[Input.Bias]).toBe('Bias');
    expect(OUTPUT_LABELS[Output.Thrust]).toBe('Thrust');
  });
});

describe('Innovations', () => {
  it('gives the same id to the same link and new ids to new links', () => {
    const innovations = new Innovations();
    const a = innovations.linkId(0, 15);
    expect(innovations.linkId(0, 15)).toBe(a);
    expect(innovations.linkId(1, 15)).not.toBe(a);
  });

  it('gives the same neuron for splitting the same link, numbered after the fixed neurons', () => {
    const innovations = new Innovations();
    const node = innovations.splitNode(7);
    expect(node).toBe(FIXED);
    expect(innovations.splitNode(7)).toBe(node);
    expect(innovations.splitNode(8)).toBe(FIXED + 1);
  });
});

describe('founderBrain', () => {
  it('has only input-to-output links and no hidden neurons', () => {
    const brain = founderBrain(new Rng('f'), new Innovations(), config);
    expect(brain.hiddenIds).toEqual([]);
    expect(brain.links.length).toBeGreaterThan(0);
    expect(brain.links.length).toBeLessThanOrEqual(config.founderLinks);
    for (const link of brain.links) {
      expect(link.from).toBeLessThan(INPUT_COUNT);
      expect(link.to).toBeGreaterThanOrEqual(INPUT_COUNT);
      expect(link.to).toBeLessThan(FIXED);
    }
  });
});

describe('think', () => {
  it('outputs zero with no links', () => {
    const brain = founderBrain(new Rng('f'), new Innovations(), { ...config, founderLinks: 0 });
    brain.activation[Input.Bias] = 1;
    think(brain);
    for (let k = 0; k < OUTPUT_COUNT; k++) expect(output(brain, k)).toBe(0);
  });

  it('computes tanh of the weighted sum of its inputs', () => {
    const innovations = new Innovations();
    const brain = mutateBrain(
      founderBrain(new Rng('f'), innovations, { ...config, founderLinks: 0 }),
      0,
      new Rng('m'),
      innovations,
      only({}),
    );
    brain.links.push(
      { innovation: 0, from: Input.Bias, to: INPUT_COUNT + Output.Turn, weight: 0.5, enabled: true },
      { innovation: 1, from: Input.Energy, to: INPUT_COUNT + Output.Turn, weight: -2, enabled: true },
    );
    const wired = mutateBrain(brain, 0, new Rng('m'), innovations, only({}));
    wired.activation[Input.Bias] = 1;
    wired.activation[Input.Energy] = 0.25;
    think(wired);
    expect(output(wired, Output.Turn)).toBeCloseTo(Math.tanh(0.5 * 1 - 2 * 0.25), 6);
    expect(output(wired, Output.Thrust)).toBe(0);
  });

  it('keeps outputs within [-1, 1]', () => {
    const innovations = new Innovations();
    const rng = new Rng('range');
    let brain = founderBrain(rng, innovations, config);
    for (let i = 0; i < 200; i++) brain = mutateBrain(brain, 0.5, rng, innovations, config);
    for (let t = 0; t < 50; t++) {
      for (let k = 0; k < INPUT_COUNT; k++) brain.activation[k] = rng.range(-1, 1);
      think(brain);
      for (let k = INPUT_COUNT; k < brain.activation.length; k++) {
        expect(Math.abs(brain.activation[k]!)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('remembers through a self-link: output persists after the input goes away', () => {
    const innovations = new Innovations();
    const turn = INPUT_COUNT + Output.Turn;
    const base = founderBrain(new Rng('f'), innovations, { ...config, founderLinks: 0 });
    base.links.push(
      { innovation: 0, from: Input.Bias, to: turn, weight: 3, enabled: true },
      { innovation: 1, from: turn, to: turn, weight: 3, enabled: true },
    );
    const brain = mutateBrain(base, 0, new Rng('m'), innovations, only({}));
    brain.activation[Input.Bias] = 1;
    think(brain);
    brain.activation[Input.Bias] = 0;
    for (let t = 0; t < 20; t++) think(brain);
    expect(output(brain, Output.Turn)).toBeGreaterThan(0.9);
  });
});

describe('mutateBrain', () => {
  it('copies the parent without changing it', () => {
    const innovations = new Innovations();
    const parent = founderBrain(new Rng('p'), innovations, config);
    const before = JSON.stringify(parent.links);
    const child = mutateBrain(parent, 0.3, new Rng('c'), innovations, only({ weightChangeChance: 1 }));
    expect(JSON.stringify(parent.links)).toBe(before);
    expect(child.links).toHaveLength(parent.links.length);
    expect(child.links.some((link, k) => link.weight !== parent.links[k]!.weight)).toBe(true);
  });

  it('resets a weight to the spread the reset scale sets', () => {
    const innovations = new Innovations();
    const rng = new Rng('reset');
    const parent = founderBrain(rng, innovations, { ...config, founderLinks: 40 });
    const spread = (scale: number) => {
      const child = mutateBrain(parent, 0.1, new Rng('r'), innovations, only({ weightResetChance: 1, weightResetScale: scale }));
      return Math.sqrt(child.links.reduce((sum, link) => sum + link.weight ** 2, 0) / child.links.length);
    };
    expect(spread(1)).toBeGreaterThan(0.5);
    expect(spread(0.1)).toBeCloseTo(spread(1) * 0.1, 5);
  });

  it('starts the child with a blank mind', () => {
    const innovations = new Innovations();
    const parent = founderBrain(new Rng('p'), innovations, config);
    parent.activation.fill(0.5);
    const child = mutateBrain(parent, 0.1, new Rng('c'), innovations, config);
    expect(Array.from(child.activation).every((v) => v === 0)).toBe(true);
  });

  it('adds links up to the cap and never into an input', () => {
    const innovations = new Innovations();
    const rng = new Rng('links');
    const cfg = only({ addLinkChance: 1, maxLinks: 12 });
    let brain = founderBrain(rng, innovations, cfg);
    for (let i = 0; i < 300; i++) brain = mutateBrain(brain, 0.1, rng, innovations, cfg);
    expect(brain.links.length).toBe(12);
    for (const link of brain.links) expect(link.to).toBeGreaterThanOrEqual(INPUT_COUNT);
    const pairs = new Set(brain.links.map((link) => `${link.from}>${link.to}`));
    expect(pairs.size).toBe(brain.links.length);
  });

  it('splits a link with a new neuron that carries the same signal path', () => {
    const innovations = new Innovations();
    const rng = new Rng('split');
    const parent = founderBrain(rng, innovations, { ...config, founderLinks: 1 });
    const original = parent.links[0]!;
    const child = mutateBrain(parent, 0.1, rng, innovations, only({ addNeuronChance: 1 }));

    expect(child.hiddenIds).toHaveLength(1);
    const node = child.hiddenIds[0]!;
    expect(node).toBeGreaterThanOrEqual(FIXED);
    expect(child.links).toHaveLength(3);
    expect(child.links[0]!.enabled).toBe(false);
    expect(child.links.find((link) => link.to === node)).toMatchObject({ from: original.from, weight: 1 });
    expect(child.links.find((link) => link.from === node)).toMatchObject({
      to: original.to,
      weight: original.weight,
    });
    expect(enabledLinks(child)).toBe(2);
    expect(child.activation).toHaveLength(FIXED + 1);
  });

  it('respects the hidden neuron cap', () => {
    const innovations = new Innovations();
    const rng = new Rng('cap');
    const cfg = only({ addNeuronChance: 1, maxHiddenNeurons: 3 });
    let brain = founderBrain(rng, innovations, cfg);
    for (let i = 0; i < 100; i++) brain = mutateBrain(brain, 0.1, rng, innovations, cfg);
    expect(brain.hiddenIds.length).toBe(3);
    expect(brain.hiddenIds).toEqual([...brain.hiddenIds].sort((a, b) => a - b));
  });

  it('toggles a link on or off', () => {
    const innovations = new Innovations();
    const rng = new Rng('toggle');
    const parent = founderBrain(rng, innovations, { ...config, founderLinks: 1 });
    const child = mutateBrain(parent, 0.1, rng, innovations, only({ toggleLinkChance: 1 }));
    expect(child.links[0]!.enabled).toBe(false);
    expect(enabledLinks(child)).toBe(0);
    const grandchild = mutateBrain(child, 0.1, rng, innovations, only({ toggleLinkChance: 1 }));
    expect(grandchild.links[0]!.enabled).toBe(true);
  });

  it('is repeatable for a seed', () => {
    const build = () => {
      const innovations = new Innovations();
      const rng = new Rng('repeat');
      let brain = founderBrain(rng, innovations, config);
      for (let i = 0; i < 100; i++) brain = mutateBrain(brain, 0.2, rng, innovations, config);
      return JSON.stringify([brain.links, brain.hiddenIds]);
    };
    expect(build()).toBe(build());
  });
});

describe('brainCost', () => {
  it('charges per hidden neuron and per enabled link', () => {
    const innovations = new Innovations();
    const rng = new Rng('cost');
    const parent = founderBrain(rng, innovations, { ...config, founderLinks: 1 });
    expect(brainCost(parent, config)).toBeCloseTo(config.brainLinkCost, 12);
    const child = mutateBrain(parent, 0.1, rng, innovations, only({ addNeuronChance: 1 }));
    expect(brainCost(child, config)).toBeCloseTo(config.brainNeuronCost + 2 * config.brainLinkCost, 12);
  });
});

describe('slow neurons', () => {
  /** A one-input brain: input 0 feeds hidden neuron `FIXED` with weight 1, with the given time constant. */
  function relay(tau: number): Brain {
    const links = [{ innovation: 0, from: 0, to: FIXED, weight: 1, enabled: true }];
    return compileBrain(links, [FIXED], [tau]);
  }

  it('follows its input at once with a time constant of 1', () => {
    const brain = relay(1);
    brain.activation[0] = 0.5;
    think(brain);
    expect(brain.activation[FIXED]).toBe(Math.fround(Math.tanh(0.5)));
  });

  it('moves only part of the way each tick with a larger time constant, and keeps a memory', () => {
    const brain = relay(4);
    brain.activation[0] = 1;
    think(brain);
    const target = Math.tanh(1);
    expect(brain.activation[FIXED]).toBeCloseTo(target / 4, 6);
    for (let i = 0; i < 40; i++) think(brain);
    expect(brain.activation[FIXED]).toBeCloseTo(target, 3);
    // With the input gone it fades slowly instead of dropping to zero.
    brain.activation[0] = 0;
    think(brain);
    expect(brain.activation[FIXED]!).toBeGreaterThan(0.5);
  });

  it('starts every new neuron at 1 and keeps time constants beside their neurons', () => {
    const innovations = new Innovations();
    const rng = new Rng('tau');
    const cfg = only({ addNeuronChance: 1, maxHiddenNeurons: 5 });
    let brain = founderBrain(rng, innovations, cfg);
    for (let i = 0; i < 40; i++) brain = mutateBrain(brain, 0.1, rng, innovations, cfg);
    expect(brain.hiddenTau).toHaveLength(brain.hiddenIds.length);
    expect(brain.hiddenTau.every((tau) => tau === 1)).toBe(true);
  });

  it('mutates time constants within 1 and the maximum, and passes them on', () => {
    const innovations = new Innovations();
    const rng = new Rng('tau2');
    const parent = relay(5);
    const cfg = only({ tauChangeChance: 1, tauChangeScale: 2, maxNeuronTau: 8 });
    let brain = parent;
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      brain = mutateBrain(brain, 0.1, rng, innovations, cfg);
      seen.add(brain.hiddenTau[0]!);
      expect(brain.hiddenTau[0]!).toBeGreaterThanOrEqual(1);
      expect(brain.hiddenTau[0]!).toBeLessThanOrEqual(8);
    }
    expect(seen.size).toBeGreaterThan(5);
    expect(parent.hiddenTau).toEqual([5]);
  });
});

describe('the strength of new links', () => {
  it('starts links added by mutation at the configured spread, and leaves founders alone', () => {
    const innovations = new Innovations();
    const rng = new Rng('weights');
    const cfg = only({ addLinkChance: 1, newLinkWeightScale: 0.05, maxLinks: 500 });
    let brain = founderBrain(rng, innovations, cfg);
    const founderWeights = brain.links.map((link) => link.weight);
    const before = brain.links.length;
    for (let k = 0; k < 120; k++) brain = mutateBrain(brain, 0.05, rng, innovations, cfg);
    const added = brain.links.slice(before);
    expect(added.length).toBeGreaterThan(50);
    // Spread 0.05: nothing beyond five spreads.
    expect(Math.max(...added.map((link) => Math.abs(link.weight)))).toBeLessThan(0.25);
    expect(brain.links.slice(0, before).map((link) => link.weight)).toEqual(founderWeights);
  });
});

describe('learning', () => {
  /** Input 0 feeds output 0 with weight 0.5; the link learns at the given rate. */
  function learner(plasticity: number, weight = 0.5): Brain {
    const links = [{ innovation: 0, from: 0, to: INPUT_COUNT, weight, enabled: true, plasticity }];
    return compileBrain(links, []);
  }

  it('keeps a fixed weight when the learning rate is 0', () => {
    const brain = learner(0);
    brain.activation[0] = 1;
    for (let i = 0; i < 50; i++) think(brain);
    expect(brain.linkWeight[0]).toBe(0.5);
    expect(brain.plasticLinks).toHaveLength(0);
  });

  it('strengthens a link whose ends are active together, and weakens it when they disagree', () => {
    const together = learner(0.02);
    together.activation[0] = 1;
    for (let i = 0; i < 20; i++) think(together);
    expect(together.linkWeight[0]!).toBeGreaterThan(0.5);

    const apart = learner(0.02, -0.5);
    apart.activation[0] = 1;
    for (let i = 0; i < 20; i++) think(apart);
    // Input +1 and output negative: the weight moves further negative, as Hebb's rule says.
    expect(apart.linkWeight[0]!).toBeLessThan(-0.5);
  });

  it('never learns a weight past the limit, and leaves the inherited weight alone', () => {
    const brain = learner(0.05, 3.9);
    brain.activation[0] = 1;
    for (let i = 0; i < 500; i++) think(brain);
    expect(brain.linkWeight[0]!).toBeLessThanOrEqual(4);
    expect(brain.links[0]!.weight).toBe(3.9);
  });

  it('pulls a learned weight back toward the inherited one when decay is on, and settles in between', () => {
    const brain = learner(0.02);
    brain.activation[0] = 1;
    for (let i = 0; i < 400; i++) think(brain, 0.02);
    // Gain per tick is rate x input x output; the pull balances it a little above the inherited weight.
    expect(brain.linkWeight[0]!).toBeGreaterThan(0.5);
    expect(brain.linkWeight[0]!).toBeLessThan(1.5);
    // With nothing to learn from, it returns to the inherited weight.
    brain.activation[0] = 0;
    for (let i = 0; i < 1000; i++) think(brain, 0.02);
    expect(brain.linkWeight[0]!).toBeCloseTo(0.5, 2);
  });

  it('lets the Learn output speed learning up, leave it, or reverse it', () => {
    const after = (learnWeight: number | null): number => {
      const links = [
        { innovation: 0, from: 0, to: INPUT_COUNT, weight: 0.5, enabled: true, plasticity: 0.02 },
        ...(learnWeight === null
          ? []
          : [{ innovation: 1, from: Input.Bias, to: INPUT_COUNT + Output.Learn, weight: learnWeight, enabled: true, plasticity: 0 }]),
      ];
      const brain = compileBrain(links, []);
      brain.activation[0] = 1;
      brain.activation[Input.Bias] = 1;
      for (let i = 0; i < 20; i++) think(brain);
      return brain.linkWeight[0]!;
    };
    const unwired = after(null);
    expect(unwired).toBeGreaterThan(0.5);
    // Learn at zero (a link of weight 0) is the same as no Learn link at all.
    expect(after(0)).toBeCloseTo(unwired, 6);
    expect(after(4)).toBeGreaterThan(unwired);
    // Strongly negative: learning runs backwards, so the weight falls below where it started.
    expect(after(-4)).toBeLessThan(0.5);
  });

  it('settles at a moderate weight by itself, with no decay and no limit needed', () => {
    const brain = learner(0.05);
    brain.activation[0] = 1;
    for (let i = 0; i < 10000; i++) think(brain);
    // Oja's rule stops where weight x output = input, here at w x tanh(w) = 1, about 1.2.
    expect(brain.linkWeight[0]!).toBeCloseTo(1.2, 1);
    for (let i = 0; i < 1000; i++) think(brain);
    expect(brain.linkWeight[0]!).toBeCloseTo(1.2, 1);
  });

  it('keeps unlearning bounded too, and leaves only the pull back when Learn sits at -0.5', () => {
    const run = (learnBias: number, ticks: number, decay: number): Brain => {
      const links = [
        { innovation: 0, from: 0, to: INPUT_COUNT, weight: 0.5, enabled: true, plasticity: 0.05 },
        { innovation: 1, from: Input.Bias, to: INPUT_COUNT + Output.Learn, weight: learnBias, enabled: true, plasticity: 0 },
      ];
      const brain = compileBrain(links, []);
      brain.activation[0] = 1;
      brain.activation[Input.Bias] = 1;
      for (let i = 0; i < ticks; i++) think(brain, decay);
      return brain;
    };
    // Learn near -1: the weight is pushed down until the output goes quiet, not on toward the limit.
    const unlearned = run(-6, 10000, 0);
    expect(Math.abs(unlearned.linkWeight[0]!)).toBeLessThan(0.5);
    // Learn at -0.5 switches learning off, so only the pull back toward the inherited weight acts.
    const still = run(Math.atanh(-0.5), 50, 0);
    expect(still.linkWeight[0]!).toBeCloseTo(0.5, 3);
  });

  it('does not pass what was learned to the young, but does pass the learning rate', () => {
    const innovations = new Innovations();
    const rng = new Rng('baldwin');
    const parent = learner(0.03);
    parent.activation[0] = 1;
    for (let i = 0; i < 100; i++) think(parent);
    expect(parent.linkWeight[0]!).toBeGreaterThan(0.6);
    const child = mutateBrain(parent, 0.1, rng, innovations, only({}));
    expect(child.linkWeight[0]).toBe(0.5);
    expect(child.links[0]!.plasticity).toBeCloseTo(0.03, 6);
    expect(child.plasticLinks).toHaveLength(1);
  });

  it('mutates learning rates within 0 and the maximum', () => {
    const innovations = new Innovations();
    const rng = new Rng('plast');
    const cfg = only({ plasticityChangeChance: 1, plasticityChangeScale: 0.05, maxPlasticity: 0.04 });
    let brain = learner(0.02);
    const seen = new Set<number>();
    for (let i = 0; i < 200; i++) {
      brain = mutateBrain(brain, 0.1, rng, innovations, cfg);
      const rate = brain.links[0]!.plasticity!;
      seen.add(rate);
      expect(rate).toBeGreaterThanOrEqual(0);
      expect(rate).toBeLessThanOrEqual(Math.fround(0.04));
    }
    expect(seen.size).toBeGreaterThan(5);
  });
});

describe('hasLoop', () => {
  const link = (from: number, to: number, enabled = true) => ({ innovation: from * 1000 + to, from, to, weight: 1, enabled });
  const H1 = FIXED;
  const H2 = FIXED + 1;

  it('is false for a brain with no loop, however deep', () => {
    expect(hasLoop(compileBrain([link(0, INPUT_COUNT)], []))).toBe(false);
    expect(hasLoop(compileBrain([link(0, H1), link(H1, H2), link(H2, INPUT_COUNT)], [H1, H2]))).toBe(false);
  });

  it('finds a neuron feeding itself, and a longer loop', () => {
    expect(hasLoop(compileBrain([link(0, H1), link(H1, H1)], [H1]))).toBe(true);
    expect(hasLoop(compileBrain([link(0, H1), link(H1, H2), link(H2, H1)], [H1, H2]))).toBe(true);
  });

  it('ignores a loop whose link is switched off', () => {
    expect(hasLoop(compileBrain([link(0, H1), link(H1, H1, false)], [H1]))).toBe(false);
  });
});

describe('idle actions', () => {
  const learner = { plasticLinks: new Uint16Array([0]) };
  const fixed = { plasticLinks: new Uint16Array(0) };

  it('mark Mate idle when creatures breed alone, and Reproduce when they only breed with a mate', () => {
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 0 }, learner)[Output.Mate]).not.toBeNull();
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 0 }, learner)[Output.Reproduce]).toBeNull();
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 1 }, learner).every((why) => why === null)).toBe(true);
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 2 }, learner)[Output.Reproduce]).not.toBeNull();
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 2 }, learner)[Output.Mate]).toBeNull();
  });

  it('mark Learn idle for a brain with no learning links, and Call when hearing is off', () => {
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 1 }, fixed)[Output.Learn]).not.toBeNull();
    expect(idleOutputs({ ...defaultConfig, reproductionMode: 1, hearing: false }, learner)[Output.Call]).not.toBeNull();
  });
});
