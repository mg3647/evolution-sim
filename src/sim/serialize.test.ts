import { describe, expect, it } from 'vitest';
import { defaultConfig, type SimConfig } from './config';
import { expectedEnergy } from './ledger';
import { compileBrain } from './brain';
import { loadWorld, OLDEST_LOADABLE_VERSION, SAVE_VERSION, saveWorld, type SavedWorld } from './serialize';
import { createWorld, hashWorld, step, totalEnergy, triggerWorldEvent, type World } from './world';

const smallConfig: SimConfig = {
  ...defaultConfig,
  worldWidth: 800,
  worldHeight: 800,
  initialCreatures: 80,
  minPopulation: 5,
  randomEvents: true,
  randomEventInterval: 150,
  fertilityDriftPeriod: 900,
  speciesInterval: 100,
};

function run(world: World, ticks: number): World {
  for (let i = 0; i < ticks; i++) step(world);
  return world;
}

/** Save, pass through JSON text as a file would, and load. */
function roundTrip(world: World): World {
  return loadWorld(JSON.parse(JSON.stringify(saveWorld(world))) as SavedWorld);
}

describe('save and load', () => {
  it('restores a world to exactly the same state', () => {
    const world = run(createWorld(smallConfig), 700);
    const copy = roundTrip(world);
    expect(hashWorld(copy)).toBe(hashWorld(world));
    expect(copy.tick).toBe(world.tick);
    expect(copy.creatures.count).toBe(world.creatures.count);
    expect(copy.deaths).toEqual(world.deaths);
    expect(copy.environment.log).toEqual(world.environment.log);
    expect(totalEnergy(copy)).toBeCloseTo(expectedEnergy(copy.ledger), 6);
  });

  it('continues exactly as the original would have, through events, births and drift', () => {
    const world = run(createWorld(smallConfig), 600);
    triggerWorldEvent(world, 'plague');
    triggerWorldEvent(world, 'wall');
    triggerWorldEvent(world, 'drought');
    run(world, 50);
    const copy = roundTrip(world);
    run(world, 1500);
    run(copy, 1500);
    expect(hashWorld(copy)).toBe(hashWorld(world));
    expect(copy.births).toBe(world.births);
    expect(copy.species.species.map((s) => s.id)).toEqual(world.species.species.map((s) => s.id));
    expect(copy.lineage.save()).toEqual(world.lineage.save());
    expect(Array.from(copy.history.population.subarray(0, copy.history.count))).toEqual(
      Array.from(world.history.population.subarray(0, world.history.count)),
    );
  });

  it('does not share anything with the world it was saved from', () => {
    const world = run(createWorld(smallConfig), 300);
    const before = hashWorld(world);
    const copy = loadWorld(saveWorld(world));
    run(copy, 200);
    expect(hashWorld(world)).toBe(before);
  });

  it('produces data that survives being written as text', () => {
    const saved = saveWorld(run(createWorld(smallConfig), 200));
    const text = JSON.stringify(saved);
    expect(text).not.toContain('null');
    expect(JSON.parse(text)).toEqual(saved);
  });

  it('keeps slow neurons through a save', () => {
    const world = createWorld(smallConfig);
    const brain = world.creatures.brain[0]!;
    world.creatures.brain[0] = compileBrain(brain.links, [999], [7]);
    const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
    expect(copy.creatures.brain[0]!.hiddenTau).toEqual([7]);
  });

  it('keeps what a brain has learned through a save', () => {
    const world = createWorld(smallConfig);
    const brain = world.creatures.brain[0]!;
    const links = brain.links.map((link) => ({ ...link, plasticity: 0.05 }));
    const learner = compileBrain(links, []);
    learner.linkWeight[0] = 1.234;
    world.creatures.brain[0] = learner;
    const copy = loadWorld(JSON.parse(JSON.stringify(saveWorld(world))));
    expect(copy.creatures.brain[0]!.linkWeight[0]).toBeCloseTo(1.234, 5);
    expect(copy.creatures.brain[0]!.links[0]!.weight).toBe(links[0]!.weight);
    expect(hashWorld(copy)).toBe(hashWorld(world));
  });

  it('opens a save from before time constants, with every neuron answering at once', () => {
    const saved = JSON.parse(JSON.stringify(saveWorld(run(createWorld(smallConfig), 100)))) as SavedWorld;
    saved.version = OLDEST_LOADABLE_VERSION;
    for (const brain of saved.creatures.brains) {
      delete brain.hiddenTau;
      for (const link of brain.links) delete link.plasticity;
    }
    const { tauChangeChance: _drop, ...older } = saved.config;
    saved.config = older as SavedWorld['config'];
    const copy = loadWorld(saved);
    expect(copy.config.tauChangeChance).toBeGreaterThan(0);
    for (const brain of copy.creatures.brain.slice(0, copy.creatures.count)) {
      expect(brain.hiddenTau.every((tau) => tau === 1)).toBe(true);
      expect(brain.plasticLinks).toHaveLength(0);
    }
    run(copy, 50);
  });

  it('refuses files it cannot read', () => {
    const saved = saveWorld(createWorld(smallConfig));
    expect(() => loadWorld({ ...saved, version: SAVE_VERSION + 1 })).toThrow(/save version/);
    expect(() => loadWorld({} as SavedWorld)).toThrow(/not a saved world/);
    expect(() => loadWorld(null as unknown as SavedWorld)).toThrow(/not a saved world/);
    const damaged = { ...saved, field: { ...saved.field, energy: saved.field.energy.slice(1) } };
    expect(() => loadWorld(damaged)).toThrow(/damaged/);
  });
});
