import type { SimConfig } from '../sim/config';
import type { EventKind } from '../sim/environment';
import type { ToolKind } from '../sim/world';
import type { FromWorker, HistoryData, ProfileGroup, Snapshot, Speed, ToWorker, TreeData } from './protocol';

export interface SimClientHandlers {
  onSnapshot: (snapshot: Snapshot) => void;
  onHistory: (history: HistoryData) => void;
  onTree: (tree: TreeData) => void;
  onProfiles: (groups: ProfileGroup[]) => void;
  /** A save is ready: the world as JSON text, with the tick and seed it was taken at. */
  onSaved: (json: string, tick: number, seed: string) => void;
  onError: (message: string) => void;
}

/** Page-side handle on the simulation worker. */
export class SimClient {
  private worker: Worker;

  constructor(handlers: SimClientHandlers) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<FromWorker>) => {
      const message = event.data;
      if (message.type === 'snapshot') handlers.onSnapshot(message.snapshot);
      else if (message.type === 'history') handlers.onHistory(message.history);
      else if (message.type === 'tree') handlers.onTree(message.tree);
      else if (message.type === 'profiles') handlers.onProfiles(message.groups);
      else if (message.type === 'saved') handlers.onSaved(message.json, message.tick, message.seed);
      else handlers.onError(message.message);
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

  triggerEvent(kind: EventKind): void {
    this.send({ type: 'event', kind });
  }

  /** Apply a hand tool at (x, y), or along a drag from (fromX, fromY) to it. */
  applyTool(tool: ToolKind, x: number, y: number, fromX: number, fromY: number): void {
    this.send({ type: 'tool', tool, x, y, fromX, fromY });
  }

  clearWalls(): void {
    this.send({ type: 'clearWalls' });
  }

  setRandomEvents(enabled: boolean): void {
    this.send({ type: 'setRandomEvents', enabled });
  }

  /** Turn drawing data on or off. Off spares the page the work of drawing. */
  setRendering(enabled: boolean): void {
    this.send({ type: 'setRendering', enabled });
  }

  /** Change settings in the running world. Settings that only matter at creation are ignored. */
  setConfig(changes: Partial<SimConfig>): void {
    this.send({ type: 'setConfig', changes });
  }

  /** Ask for the world as save data; it arrives through `onSaved`. */
  save(): void {
    this.send({ type: 'save' });
  }

  /** Replace the world with one from save data. A bad file reports through `onError`. */
  load(json: string): void {
    this.send({ type: 'load', json });
  }

  destroy(): void {
    this.worker.terminate();
  }
}
