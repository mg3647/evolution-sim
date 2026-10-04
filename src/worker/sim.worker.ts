import { enabledLinks, INPUT_COUNT, OUTPUT_COUNT } from '../sim/brain';
import { maxEnergyFor } from '../sim/genome';
import { wrappedDelta } from '../sim/geometry';
import { clearWorldWalls, triggerWorldEvent, type World } from '../sim/world';
import {
  CREATURE_STRIDE,
  type FromWorker,
  type HistoryData,
  type Inspection,
  type Snapshot,
  type ToWorker,
} from './protocol';
import { SimRunner } from './runner';

/** Wall time per loop iteration spent ticking, leaving room for messages. */
const TICK_BUDGET_MS = 12;
const SNAPSHOT_INTERVAL_MS = 1000 / 60;
const HISTORY_INTERVAL_MS = 250;
const TPS_WINDOW_MS = 500;

let runner: SimRunner | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
/** Id of the creature being inspected, or 0 for none. */
let selectedId = 0;
let lastSnapshotTime = 0;
let lastHistoryTime = 0;
/** History version last sent, or -1 to force a send. */
let sentHistoryVersion = -1;
let windowStart = 0;
let windowTicks = 0;
let measuredTps = 0;

function post(message: FromWorker, transfer: Transferable[]): void {
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
    hue: c.hue[i]!,
    mutationRate: c.mutationRate[i]!,
    hiddenNeurons: brain.hiddenIds.length,
    links: enabledLinks(brain),
    inputs: Array.from(brain.activation.subarray(0, INPUT_COUNT)),
    outputs: Array.from(brain.activation.subarray(INPUT_COUNT, INPUT_COUNT + OUTPUT_COUNT)),
  };
}

function sendSnapshot(now: number): void {
  if (!runner) return;
  const { world } = runner;
  const { config, creatures: c, plants: p } = world;

  const creatures = new Float32Array(c.count * CREATURE_STRIDE);
  let sizeTotal = 0;
  let speedTotal = 0;
  let senseTotal = 0;
  let dietTotal = 0;
  let meatEaters = 0;
  let maxGeneration = 0;
  let selected: Inspection | null = null;
  for (let i = 0; i < c.count; i++) {
    const size = c.size[i]!;
    const o = i * CREATURE_STRIDE;
    creatures[o] = c.x[i]!;
    creatures[o + 1] = c.y[i]!;
    creatures[o + 2] = c.heading[i]!;
    creatures[o + 3] = c.energy[i]! / maxEnergyFor(size, config);
    creatures[o + 4] = config.creatureRadius * size;
    creatures[o + 5] = c.hue[i]!;
    creatures[o + 6] = c.diet[i]!;
    dietTotal += c.diet[i]!;
    if (c.diet[i]! > 0.5) meatEaters++;
    sizeTotal += size;
    speedTotal += c.speed[i]!;
    senseTotal += c.sensorRange[i]!;
    if (selectedId !== 0 && c.id[i] === selectedId) selected = inspect(world, i);
    if (c.generation[i]! > maxGeneration) maxGeneration = c.generation[i]!;
  }

  const plants = new Uint8Array(p.energy.length);
  const meat = new Uint8Array(p.meat.length);
  const scent = new Uint8Array(p.scent.length);
  let plantEnergy = 0;
  for (let i = 0; i < plants.length; i++) {
    plants[i] = (p.energy[i]! / config.plantCapacity) * 255;
    meat[i] = Math.min(1, p.meat[i]! / config.meatScale) * 255;
    scent[i] = Math.min(1, p.scent[i]!) * 255;
    plantEnergy += p.energy[i]!;
  }

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
    walls: p.walls.slice(),
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
      log: world.environment.log.slice(),
    },
    births: world.births,
    reseeded: world.reseeded,
    deaths: { ...world.deaths },
    selected,
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
    meanLinks: h.meanLinks.slice(0, h.count),
    meanNeurons: h.meanNeurons.slice(0, h.count),
  };
  post({ type: 'history', history }, [
    history.tick.buffer,
    history.population.buffer,
    history.plantPercent.buffer,
    history.meanSize.buffer,
    history.meanSpeed.buffer,
    history.meanSensorRange.buffer,
    history.meanDiet.buffer,
    history.meatEaters.buffer,
    history.meanLinks.buffer,
    history.meanNeurons.buffer,
  ]);
  sentHistoryVersion = h.version;
  lastHistoryTime = now;
}

function loop(): void {
  loopTimer = null;
  if (!runner || !runner.running) return;

  const now = performance.now();
  windowTicks += runner.advance(now, () => performance.now(), TICK_BUDGET_MS);

  const after = performance.now();
  if (after - windowStart >= TPS_WINDOW_MS) {
    measuredTps = (windowTicks * 1000) / (after - windowStart);
    windowStart = after;
    windowTicks = 0;
  }
  if (after - lastSnapshotTime >= SNAPSHOT_INTERVAL_MS) sendSnapshot(after);
  if (after - lastHistoryTime >= HISTORY_INTERVAL_MS) sendHistory(after);

  loopTimer = setTimeout(loop, 0);
}

function startLoop(): void {
  windowStart = performance.now();
  windowTicks = 0;
  if (loopTimer === null) loopTimer = setTimeout(loop, 0);
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
    sentHistoryVersion = -1;
    selectedId = 0;
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
  } else if (message.type === 'clearWalls') {
    clearWorldWalls(runner.world);
  } else if (message.type === 'setRandomEvents') {
    runner.world.environment.randomEvents = message.enabled;
  }
  const now = performance.now();
  sendSnapshot(now);
  sendHistory(now);
};
