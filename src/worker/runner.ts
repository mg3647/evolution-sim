import type { SimConfig } from '../sim/config';
import { createWorld, step, type World } from '../sim/world';
import type { Speed } from './protocol';

/** Longest stretch of owed sim time kept after a stall, in seconds. */
const MAX_BACKLOG_SECONDS = 0.25;
/** How often the clock is checked while running a batch of ticks. */
const BUDGET_CHECK_INTERVAL = 16;

/**
 * Drives a world at a fixed timestep. It owns no timers and reads no clock of
 * its own: the caller passes the time in, which keeps it testable.
 */
export class SimRunner {
  world: World;
  running = false;
  speed: Speed = 1;
  private owedTicks = 0;
  private lastTime: number | null = null;

  constructor(config: SimConfig) {
    this.world = createWorld(config);
  }

  reset(config: SimConfig): void {
    this.world = createWorld(config);
    this.owedTicks = 0;
    this.lastTime = null;
  }

  /** Swap in another world, such as one loaded from a file. Play state and speed are kept. */
  setWorld(world: World): void {
    this.world = world;
    this.owedTicks = 0;
    this.lastTime = null;
  }

  play(): void {
    this.running = true;
    this.lastTime = null;
  }

  pause(): void {
    this.running = false;
    this.owedTicks = 0;
  }

  setSpeed(speed: Speed): void {
    this.speed = speed;
    this.owedTicks = 0;
  }

  /** Run exactly `ticks` steps regardless of play state. */
  stepTicks(ticks: number): void {
    for (let i = 0; i < ticks; i++) step(this.world);
  }

  /**
   * Run the ticks owed since the previous call, spending at most `budgetMs`
   * of wall time as measured by `clock`. Returns the number of ticks run.
   */
  advance(now: number, clock: () => number, budgetMs: number): number {
    if (!this.running) return 0;
    const deadline = clock() + budgetMs;
    let ran = 0;

    if (this.speed === 'max') {
      do {
        for (let i = 0; i < BUDGET_CHECK_INTERVAL; i++) step(this.world);
        ran += BUDGET_CHECK_INTERVAL;
      } while (clock() < deadline);
      this.lastTime = now;
      return ran;
    }

    const ticksPerMs = (this.world.config.ticksPerSecond * this.speed) / 1000;
    if (this.lastTime !== null) this.owedTicks += (now - this.lastTime) * ticksPerMs;
    this.lastTime = now;
    this.owedTicks = Math.min(this.owedTicks, MAX_BACKLOG_SECONDS * 1000 * ticksPerMs);

    while (this.owedTicks >= 1) {
      step(this.world);
      this.owedTicks--;
      ran++;
      if (ran % BUDGET_CHECK_INTERVAL === 0 && clock() >= deadline) break;
    }
    return ran;
  }
}
