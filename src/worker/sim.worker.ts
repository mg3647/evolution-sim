import type { FromWorker, Snapshot, ToWorker } from './protocol';
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

function post(message: FromWorker): void {
  self.postMessage(message);
}

function sendSnapshot(now: number): void {
  if (!runner) return;
  const { world } = runner;
  const snapshot: Snapshot = {
    tick: world.tick,
    running: runner.running,
    speed: runner.speed,
    measuredTps: runner.running ? measuredTps : 0,
    worldWidth: world.config.worldWidth,
    worldHeight: world.config.worldHeight,
    seed: world.config.seed,
  };
  post({ type: 'snapshot', snapshot });
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
