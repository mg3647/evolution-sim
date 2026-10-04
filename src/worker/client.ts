import type { SimConfig } from '../sim/config';
import type { FromWorker, HistoryData, Snapshot, Speed, ToWorker } from './protocol';

export interface SimClientHandlers {
  onSnapshot: (snapshot: Snapshot) => void;
  onHistory: (history: HistoryData) => void;
}

/** Page-side handle on the simulation worker. */
export class SimClient {
  private worker: Worker;

  constructor(handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'snapshot') handlers.onSnapshot(message.snapshot);
      else handlers.onHistory(message.history);
    };
  }

  private send(message: ToWorker): void {
    this.worker.postMessage(message);
  }

  init(config: SimConfig): void {
    this.send({ type: 'init', config });
  }

  play(): void {
    this.send({ type: 'play' });
  }

  pause(): void {
    this.send({ type: 'pause' });
  }

  step(ticks = 1): void {
    this.send({ type: 'step', ticks });
  }

  setSpeed(speed: Speed): void {
    this.send({ type: 'setSpeed', speed });
  }

  /** Select the creature nearest a world position within `radius`, or none. */
  pick(x: number, y: number, radius: number): void {
    this.send({ type: 'pick', x, y, radius });
  }

  destroy(): void {
    this.worker.terminate();
  }
}
