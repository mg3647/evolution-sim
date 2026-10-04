import type { SimConfig } from '../sim/config';

/** Speed multiplier over the configured tick rate, or 'max' for unthrottled. */
export type Speed = number | 'max';

export type ToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; ticks: number }
  | { type: 'setSpeed'; speed: Speed };

/** What the page needs to draw one frame and update the controls. */
export interface Snapshot {
  tick: number;
  running: boolean;
  speed: Speed;
  /** Ticks per second actually achieved over the last sampling window. */
  measuredTps: number;
  worldWidth: number;
  worldHeight: number;
  seed: string;
}

export type FromWorker = { type: 'snapshot'; snapshot: Snapshot };
