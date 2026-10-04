import type { SimConfig } from './config';
import type { EnergyLedger } from './ledger';
import { tileableNoise } from './noise';
import type { Rng } from './rng';

/** Noise features across the world, coarse to fine. */
const FERTILITY_PERIODS = [3, 6, 12];

/**
 * Food on the ground as a grid of cells. Each holds plant energy up to a
 * capacity, plus any meat left by creatures that died there.
 */
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
  /** Energy of dead creatures lying in each cell. It rots away over time. */
  meat: Float64Array;
}

/** Create a field with every cell grown to capacity. */
export function createPlantField(config: SimConfig, rng: Rng): PlantField {
  const cols = Math.max(1, Math.round(config.worldWidth / config.plantCellSize));
  const rows = Math.max(1, Math.round(config.worldHeight / config.plantCellSize));
  const fertility = tileableNoise(rng, cols, rows, FERTILITY_PERIODS);
  const capacity = new Float64Array(cols * rows);
  const floor = config.fertilityFloor;

  // Summed octaves bunch up around the middle; stretch them to fill [0, 1] so
  // the richest land is fully fertile and the floor actually leaves some barren.
  let low = Infinity;
  let high = -Infinity;
  for (const value of fertility) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const spread = high > low ? high - low : 1;

  for (let i = 0; i < fertility.length; i++) {
    const stretched = (fertility[i]! - low) / spread;
    const f = Math.min(1, Math.max(0, (stretched - floor) / (1 - floor)));
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
    meat: new Float64Array(cols * rows),
  };
}

/** Index of the cell containing a world position inside [0, world size). */
export function cellIndexAt(field: PlantField, x: number, y: number): number {
  const cx = Math.min(field.cols - 1, Math.floor(x / field.cellWidth));
  const cy = Math.min(field.rows - 1, Math.floor(y / field.cellHeight));
  return cy * field.cols + cx;
}

/**
 * Regrow every cell toward its capacity, drawing the energy from sunlight.
 *
 * Growth is logistic: existing plants make more plants, so a half-eaten cell
 * recovers fastest and a cell grazed bare recovers slowly, at `bareGrowth`
 * times the full rate. Overgrazing therefore costs the grazers later.
 */
export function growPlants(
  field: PlantField,
  growthRate: number,
  bareGrowth: number,
  ledger: EnergyLedger,
): void {
  const { energy, capacity } = field;
  let grown = 0;
  for (let i = 0; i < energy.length; i++) {
    const cap = capacity[i]!;
    if (cap === 0) continue;
    const current = energy[i]!;
    const cover = bareGrowth + (1 - bareGrowth) * (current / cap);
    const growth = (cap - current) * growthRate * cover;
    energy[i] = current + growth;
    grown += growth;
  }
  ledger.sunIn += grown;
}

/** Rot a fraction of all meat away as heat. */
export function decayMeat(field: PlantField, decayRate: number, ledger: EnergyLedger): void {
  const { meat } = field;
  let rotted = 0;
  for (let i = 0; i < meat.length; i++) {
    const current = meat[i]!;
    if (current === 0) continue;
    const loss = current * decayRate;
    meat[i] = current - loss;
    rotted += loss;
  }
  ledger.heatOut += rotted;
}

export function totalMeatEnergy(field: PlantField): number {
  let total = 0;
  for (let i = 0; i < field.meat.length; i++) total += field.meat[i]!;
  return total;
}

export function totalPlantEnergy(field: PlantField): number {
  let total = 0;
  for (let i = 0; i < field.energy.length; i++) total += field.energy[i]!;
  return total;
}
