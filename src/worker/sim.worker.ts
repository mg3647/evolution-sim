import { enabledLinks, INPUT_COUNT, OUTPUT_COUNT } from '../sim/brain';
import type { SimConfig } from '../sim/config';
import { maxEnergyFor } from '../sim/genome';
import { RESTART_KEYS } from '../sim/presets';
import { wrappedDelta } from '../sim/geometry';
import { loadWorld, saveWorld, type SavedWorld } from '../sim/serialize';
import { applyTool, clearWorldWalls, triggerWorldEvent, type World } from '../sim/world';
import {
  CREATURE_STRIDE,
  type FromWorker,
  type HistoryData,
  type Inspection,
  type Snapshot,
  type SpeciesView,
  type ToWorker,
  type TreeData,
} from './protocol';
import { SimRunner } from './runner';

/** Wall time per loop iteration spent ticking, leaving room for messages. */
const TICK_BUDGET_MS = 12;
/** The same, with drawing off: fewer, longer bursts of ticking. */
const TICK_BUDGET_UNDRAWN_MS = 40;
const SNAPSHOT_INTERVAL_MS = 1000 / 60;
const SNAPSHOT_INTERVAL_UNDRAWN_MS = 250;
const HISTORY_INTERVAL_MS = 250;
const TREE_INTERVAL_MS = 1000;
const TPS_WINDOW_MS = 500;
/** Species listed in a snapshot. */
const SPECIES_SHOWN = 8;

let runner: SimRunner | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
/** Id of the creature being inspected, or 0 for none. */
let selectedId = 0;
/** Whether snapshots carry the map and creatures for drawing. */
let rendering = true;
let lastSnapshotTime = 0;
let lastHistoryTime = 0;
let lastTreeTime = 0;
/** History version last sent, or -1 to force a send. */
let sentHistoryVersion = -1;
/** Tick of the tree last sent, or -1 to force a send. */
let sentTreeTick = -1;
let windowStart = 0;
let windowTicks = 0;
let measuredTps = 0;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

/** Select the creature nearest (x, y) within `radius`, or clear the selection. */
function pick(world: World, x: number, y: number, radius: number): void {
  const { creatures: c, config } = world;
  let best = radius * radius;
  selectedId = 0;
  for (let i = 0; i < c.count; i++) {
    const dx = wrappedDelta(x, c.x[i]!, config.worldWidth);
    const dy = wrappedDelta(y, c.y[i]!, config.worldHeight);
    const d2 = dx * dx + dy * dy;
    if (d2 <= best) {
      best = d2;
      selectedId = c.id[i]!;
    }
  }
}

function inspect(world: World, i: number): Inspection {
  const { creatures: c, config } = world;
  const brain = c.brain[i]!;
  return {
    index: i,
    id: c.id[i]!,
    parentId: c.parentId[i]!,
    generation: c.generation[i]!,
    age: c.age[i]!,
    energy: c.energy[i]!,
    maxEnergy: maxEnergyFor(c.size[i]!, config),
    size: c.size[i]!,
    speed: c.speed[i]!,
    sensorRange: c.sensorRange[i]!,
    diet: c.diet[i]!,
    health: c.health[i]!,
    sick: c.sick[i]!,
    hue: c.hue[i]!,
    mutationRate: c.mutationRate[i]!,
    hiddenNeurons: brain.hiddenIds.length,
    links: enabledLinks(brain),
    inputs: Array.from(brain.activation.subarray(0, INPUT_COUNT)),
    outputs: Array.from(brain.activation.subarray(INPUT_COUNT, INPUT_COUNT + OUTPUT_COUNT)),
    species: c.species[i]!,
    brain: {
      hiddenCount: brain.hiddenIds.length,
      activation: Array.from(brain.activation),
      linkFrom: Array.from(brain.linkFrom),
      linkTo: Array.from(brain.linkTo),
      linkWeight: Array.from(brain.linkWeight),
    },
  };
}

/** Tally the living members of each species, largest first. */
function speciesViews(world: World): SpeciesView[] {
  const { creatures: c } = world;
  const tallies = new Map<number, { count: number; size: number; speed: number; diet: number }>();
  for (let i = 0; i < c.count; i++) {
    let tally = tallies.get(c.species[i]!);
    if (!tally) {
      tally = { count: 0, size: 0, speed: 0, diet: 0 };
      tallies.set(c.species[i]!, tally);
    }
    tally.count++;
    tally.size += c.size[i]!;
    tally.speed += c.speed[i]!;
    tally.diet += c.diet[i]!;
  }
  const bornTicks = new Map(world.species.species.map((record) => [record.id, record.bornTick]));
  return [...tallies]
    .map(([id, tally]) => ({
      id,
      count: tally.count,
      bornTick: bornTicks.get(id) ?? world.tick,
      meanSize: tally.size / tally.count,
      meanSpeed: tally.speed / tally.count,
      meanDiet: tally.diet / tally.count,
    }))
    .sort((a, b) => b.count - a.count || a.id - b.id)
    .slice(0, SPECIES_SHOWN);
}

function sendSnapshot(now: number): void {
  if (!runner) return;
  const { world } = runner;
  const { config, creatures: c, plants: p } = world;

  const creatures = new Float32Array(rendering ? c.count * CREATURE_STRIDE : 0);
  let sizeTotal = 0;
  let speedTotal = 0;
  let senseTotal = 0;
  let dietTotal = 0;
  let meatEaters = 0;
  let infected = 0;
  let maxGeneration = 0;
  let selected: Inspection | null = null;
  for (let i = 0; i < c.count; i++) {
    const size = c.size[i]!;
    if (rendering) {
      const o = i * CREATURE_STRIDE;
      creatures[o] = c.x[i]!;
      creatures[o + 1] = c.y[i]!;
      creatures[o + 2] = c.heading[i]!;
      creatures[o + 3] = c.energy[i]! / maxEnergyFor(size, config);
      creatures[o + 4] = config.creatureRadius * size;
      creatures[o + 5] = c.hue[i]!;
      creatures[o + 6] = c.diet[i]!;
      creatures[o + 7] = Math.sign(c.sick[i]!);
      creatures[o + 8] = c.species[i]!;
    }
    if (c.sick[i]! > 0) infected++;
    dietTotal += c.diet[i]!;
    if (c.diet[i]! > 0.5) meatEaters++;
    sizeTotal += size;
    speedTotal += c.speed[i]!;
    senseTotal += c.sensorRange[i]!;
    if (selectedId !== 0 && c.id[i] === selectedId) selected = inspect(world, i);
    if (c.generation[i]! > maxGeneration) maxGeneration = c.generation[i]!;
  }

  const cells = rendering ? p.energy.length : 0;
  const plants = new Uint8Array(cells);
  const meat = new Uint8Array(cells);
  const scent = new Uint8Array(cells);
  for (let i = 0; i < cells; i++) {
    plants[i] = (p.energy[i]! / config.plantCapacity) * 255;
    meat[i] = Math.min(1, p.meat[i]! / config.meatScale) * 255;
    scent[i] = Math.min(1, p.scent[i]!) * 255;
  }
  let plantEnergy = 0;
  for (let i = 0; i < p.energy.length; i++) plantEnergy += p.energy[i]!;

  const snapshot: Snapshot = {
    config,
    tick: world.tick,
    running: runner.running,
    speed: runner.speed,
    measuredTps: runner.running ? measuredTps : 0,
    population: c.count,
    creatures,
    meanSize: c.count > 0 ? sizeTotal / c.count : 0,
    meanSpeed: c.count > 0 ? speedTotal / c.count : 0,
    meanSensorRange: c.count > 0 ? senseTotal / c.count : 0,
    meanDiet: c.count > 0 ? dietTotal / c.count : 0,
    meatEaters,
    maxGeneration,
    plantCols: p.cols,
    plantRows: p.rows,
    plants,
    plantFill: world.plantCapacityTotal > 0 ? plantEnergy / world.plantCapacityTotal : 0,
    meat,
    scent,
    walls: rendering ? p.walls.slice() : new Uint8Array(0),
    environment: {
      season: world.climate.season,
      yearFraction: config.seasonLength > 0 ? (world.tick % config.seasonLength) / config.seasonLength : 0,
      growth: world.climate.growth,
      cost: world.climate.cost,
      active: world.environment.active.map((event) => ({
        kind: event.kind,
        remaining: event.endTick - world.tick,
      })),
      randomEvents: world.environment.randomEvents,
      infected,
      log: world.environment.log.slice(),
    },
    births: world.births,
    reseeded: world.reseeded,
    deaths: { ...world.deaths },
    selected,
    rendered: rendering,
    species: speciesViews(world),
  };
  post({ type: 'snapshot', snapshot }, [creatures.buffer, plants.buffer, meat.buffer, scent.buffer]);
  lastSnapshotTime = now;
}

/** Send the history if it changed since it was last sent. */
function sendHistory(now: number): void {
  if (!runner) return;
  const h = runner.world.history;
  if (h.version === sentHistoryVersion) return;
  const history: HistoryData = {
    tick: h.tick.slice(0, h.count),
    population: h.population.slice(0, h.count),
    plantPercent: h.plantFill.slice(0, h.count).map((fill) => fill * 100),
    meanSize: h.meanSize.slice(0, h.count),
    meanSpeed: h.meanSpeed.slice(0, h.count),
    meanSensorRange: h.meanSensorRange.slice(0, h.count),
    meanDiet: h.meanDiet.slice(0, h.count),
    meatEaters: h.meatEaters.slice(0, h.count),
    speciesCount: h.speciesCount.slice(0, h.count),
    meanLinks: h.meanLinks.slice(0, h.count),
    meanNeurons: h.meanNeurons.slice(0, h.count),
  };
  post(
    { type: 'history', history },
    Object.values(history).map((series) => series.buffer),
  );
  sentHistoryVersion = h.version;
  lastHistoryTime = now;
}

/** Send the family tree if the world has moved on since it was last sent. */
function sendTree(now: number): void {
  if (!runner) return;
  const { world } = runner;
  if (world.tick === sentTreeTick) return;
  const nodes = [...world.lineage.all()];
  const indexOf = new Map(nodes.map((node, k) => [node.id, k]));
  const tree: TreeData = {
    tick: world.tick,
    parent: new Int32Array(nodes.length),
    birthTick: new Float64Array(nodes.length),
    deathTick: new Float64Array(nodes.length),
    hue: new Float32Array(nodes.length),
    species: new Uint32Array(nodes.length),
  };
  nodes.forEach((node, k) => {
    tree.parent[k] = indexOf.get(node.parentId) ?? -1;
    tree.birthTick[k] = node.birthTick;
    tree.deathTick[k] = node.deathTick;
    tree.hue[k] = node.hue;
    tree.species[k] = node.species;
  });
  post({ type: 'tree', tree }, [
    tree.parent.buffer,
    tree.birthTick.buffer,
    tree.deathTick.buffer,
    tree.hue.buffer,
    tree.species.buffer,
  ]);
  sentTreeTick = world.tick;
  lastTreeTime = now;
}

function loop(): void {
  loopTimer = null;
  if (!runner || !runner.running) return;

  const now = performance.now();
  const budget = rendering ? TICK_BUDGET_MS : TICK_BUDGET_UNDRAWN_MS;
  windowTicks += runner.advance(now, () => performance.now(), budget);

  const after = performance.now();
  if (after - windowStart >= TPS_WINDOW_MS) {
    measuredTps = (windowTicks * 1000) / (after - windowStart);
    windowStart = after;
    windowTicks = 0;
  }
  const snapshotInterval = rendering ? SNAPSHOT_INTERVAL_MS : SNAPSHOT_INTERVAL_UNDRAWN_MS;
  if (after - lastSnapshotTime >= snapshotInterval) sendSnapshot(after);
  if (after - lastHistoryTime >= HISTORY_INTERVAL_MS) sendHistory(after);
  if (after - lastTreeTime >= TREE_INTERVAL_MS) sendTree(after);

  loopTimer = setTimeout(loop, 0);
}

function startLoop(): void {
  windowStart = performance.now();
  windowTicks = 0;
  if (loopTimer === null) loopTimer = setTimeout(loop, 0);
}

/** Forget everything tied to the previous world. */
function worldReplaced(): void {
  sentHistoryVersion = -1;
  sentTreeTick = -1;
  selectedId = 0;
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'init') {
    const wasRunning = runner?.running ?? false;
    const speed = runner?.speed ?? 1;
    // The random-events switch belongs to the user, so it survives a restart.
    const randomEvents = runner?.world.environment.randomEvents ?? message.config.randomEvents;
    runner = new SimRunner(message.config);
    runner.world.environment.randomEvents = randomEvents;
    runner.setSpeed(speed);
    worldReplaced();
    if (wasRunning) {
      runner.play();
      startLoop();
    }
  } else if (!runner) {
    return;
  } else if (message.type === 'play') {
    runner.play();
    startLoop();
  } else if (message.type === 'pause') {
    runner.pause();
  } else if (message.type === 'step') {
    runner.stepTicks(message.ticks);
  } else if (message.type === 'setSpeed') {
    runner.setSpeed(message.speed);
  } else if (message.type === 'pick') {
    pick(runner.world, message.x, message.y, message.radius);
  } else if (message.type === 'event') {
    triggerWorldEvent(runner.world, message.kind);
    // While paused, run one tick so the event's deaths show at once.
    if (!runner.running) runner.stepTicks(1);
  } else if (message.type === 'tool') {
    applyTool(runner.world, message.tool, message.x, message.y, message.fromX, message.fromY);
    // While paused, run one tick so a meteor's deaths show at once.
    if (message.tool === 'meteor' && !runner.running) runner.stepTicks(1);
  } else if (message.type === 'clearWalls') {
    clearWorldWalls(runner.world);
  } else if (message.type === 'setRandomEvents') {
    runner.world.environment.randomEvents = message.enabled;
  } else if (message.type === 'setRendering') {
    rendering = message.enabled;
  } else if (message.type === 'setConfig') {
    const config = runner.world.config as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(message.changes)) {
      if (!RESTART_KEYS.has(key as keyof SimConfig)) config[key] = value;
    }
  } else if (message.type === 'save') {
    const { world } = runner;
    post({ type: 'saved', json: JSON.stringify(saveWorld(world)), tick: world.tick, seed: world.config.seed });
    return;
  } else if (message.type === 'load') {
    try {
      runner.setWorld(loadWorld(JSON.parse(message.json) as SavedWorld));
      worldReplaced();
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'This file is not a saved world.' : (error as Error).message;
      post({ type: 'error', message: `Could not load: ${reason}` });
      return;
    }
  }
  const now = performance.now();
  sendSnapshot(now);
  sendHistory(now);
  sendTree(now);
};
