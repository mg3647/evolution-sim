import { CREATURE_STRIDE, type FromWorker, type Snapshot, type ToWorker } from './protocol';
import { SimRunner } from './runner';

/** Wall time per loop iteration spent ticking, leaving room for messages. */
const TICK_BUDGET_MS = 12;
const SNAPSHOT_INTERVAL_MS = 1000 / 60;
const TPS_WINDOW_MS = 500;

let runner: SimRunner | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
let lastSnapshotTime = 0;
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
  for (let i = 0; i < c.count; i++) {
    const o = i * CREATURE_STRIDE;
    creatures[o] = c.x[i]!;
    creatures[o + 1] = c.y[i]!;
    creatures[o + 2] = c.heading[i]!;
    creatures[o + 3] = c.energy[i]! / config.creatureMaxEnergy;
  }

  const plants = new Uint8Array(p.energy.length);
  let plantEnergy = 0;
  let plantCapacity = 0;
  for (let i = 0; i < plants.length; i++) {
    plants[i] = (p.energy[i]! / config.plantCapacity) * 255;
    plantEnergy += p.energy[i]!;
    plantCapacity += p.capacity[i]!;
  }

  const snapshot: Snapshot = {
    config,
    tick: world.tick,
    running: runner.running,
    speed: runner.speed,
    measuredTps: runner.running ? measuredTps : 0,
    population: c.count,
    creatures,
    plantCols: p.cols,
    plantRows: p.rows,
    plants,
    plantFill: plantCapacity > 0 ? plantEnergy / plantCapacity : 0,
    deaths: { ...world.deaths },
  };
  post({ type: 'snapshot', snapshot }, [creatures.buffer, plants.buffer]);
  lastSnapshotTime = now;
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
  sendSnapshot(performance.now());
};
