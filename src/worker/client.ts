import type { SimConfig } from '../sim/config';
import type { FromWorker, Snapshot, Speed, ToWorker } from './protocol';

/** Page-side handle on the simulation worker. */
export class SimClient {
  private worker: Worker;

  constructor(onSnapshot: (snapshot: Snapshot) => void) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      if (event.data.type === 'snapshot') onSnapshot(event.data.snapshot);
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

  destroy(): void {
    this.worker.terminate();
  }
}
