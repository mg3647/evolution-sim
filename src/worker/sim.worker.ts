import { maxEnergyFor } from '../sim/genome';
import {
  CREATURE_STRIDE,
  type FromWorker,
  type HistoryData,
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

function sendSnapshot(now: number): void {
  if (!runner) return;
  const { world } = runner;
  const { config, creatures: c, plants: p } = world;

  const creatures = new Float32Array(c.count * CREATURE_STRIDE);
  let sizeTotal = 0;
  let speedTotal = 0;
  let maxGeneration = 0;
  for (let i = 0; i < c.count; i++) {
    const size = c.size[i]!;
    const o = i * CREATURE_STRIDE;
    creatures[o] = c.x[i]!;
    creatures[o + 1] = c.y[i]!;
    creatures[o + 2] = c.heading[i]!;
    creatures[o + 3] = c.energy[i]! / maxEnergyFor(size, config);
    creatures[o + 4] = config.creatureRadius * size;
    creatures[o + 5] = c.hue[i]!;
    sizeTotal += size;
    speedTotal += c.speed[i]!;
    if (c.generation[i]! > maxGeneration) maxGeneration = c.generation[i]!;
  }

  const plants = new Uint8Array(p.energy.length);
  let plantEnergy = 0;
  for (let i = 0; i < plants.length; i++) {
    plants[i] = (p.energy[i]! / config.plantCapacity) * 255;
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
    maxGeneration,
    plantCols: p.cols,
    plantRows: p.rows,
    plants,
    plantFill: world.plantCapacityTotal > 0 ? plantEnergy / world.plantCapacityTotal : 0,
    births: world.births,
    reseeded: world.reseeded,
    deaths: { ...world.deaths },
  };
  post({ type: 'snapshot', snapshot }, [creatures.buffer, plants.buffer]);
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
  };
  post({ type: 'history', history }, [
    history.tick.buffer,
    history.population.buffer,
    history.plantPercent.buffer,
    history.meanSize.buffer,
    history.meanSpeed.buffer,
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
    runner = new SimRunner(message.config);
    runner.setSpeed(speed);
    sentHistoryVersion = -1;
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
  }
  const now = performance.now();
  sendSnapshot(now);
  sendHistory(now);
};
