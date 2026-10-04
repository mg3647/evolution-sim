import type { SimConfig } from './config';
import type { EnergyLedger } from './ledger';
import { tileableNoise } from './noise';
import type { Rng } from './rng';

/** Noise features across the world, coarse to fine. */
const FERTILITY_PERIODS = [3, 6, 12];

/** Plants as a grid of cells, each holding plant energy up to a capacity. */
export interface PlantField {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  /** Fertility per cell in [0, 1]. Fixed for now; it drifts in a later milestone. */
  fertility: Float32Array;
  /** Most plant energy each cell can hold. */
  capacity: Float64Array;
  /** Plant energy each cell holds now. */
  energy: Float64Array;
}

/** Create a field with every cell grown to capacity. */
export function createPlantField(config: SimConfig, rng: Rng): PlantField {
  const cols = Math.max(1, Math.round(config.worldWidth / config.plantCellSize));
  const rows = Math.max(1, Math.round(config.worldHeight / config.plantCellSize));
  const fertility = tileableNoise(rng, cols, rows, FERTILITY_PERIODS);
  const capacity = new Float64Array(cols * rows);
  const floor = config.fertilityFloor;

  for (let i = 0; i < fertility.length; i++) {
    const f = Math.min(1, Math.max(0, (fertility[i]! - floor) / (1 - floor)));
    fertility[i] = f;
    capacity[i] = f * config.plantCapacity;
  }

  return {
    cols,
    rows,
    cellWidth: config.worldWidth / cols,
    cellHeight: config.worldHeight / rows,
    fertility,
    capacity,
    energy: capacity.slice(),
  };
}

/** Index of the cell containing a world position inside [0, world size). */
export function cellIndexAt(field: PlantField, x: number, y: number): number {
  const cx = Math.min(field.cols - 1, Math.floor(x / field.cellWidth));
  const cy = Math.min(field.rows - 1, Math.floor(y / field.cellHeight));
  return cy * field.cols + cx;
}

/** Regrow every cell toward its capacity, drawing the energy from sunlight. */
export function growPlants(field: PlantField, growthRate: number, ledger: EnergyLedger): void {
  const { energy, capacity } = field;
  let grown = 0;
  for (let i = 0; i < energy.length; i++) {
    const growth = (capacity[i]! - energy[i]!) * growthRate;
    energy[i]! += growth;
    grown += growth;
  }
  ledger.sunIn += grown;
}

export function totalPlantEnergy(field: PlantField): number {
  let total = 0;
  for (let i = 0; i < field.energy.length; i++) total += field.energy[i]!;
  return total;
}
