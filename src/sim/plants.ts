import type { SimConfig } from './config';
import type { EnergyLedger } from './ledger';
import { tileableNoise } from './noise';
import type { Rng } from './rng';
import { distanceToWater, generateWater } from './water';

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
  /** Fertility per cell in [0, 1]. It drifts slowly; see environment.ts. */
  fertility: Float32Array;
  /** Most plant energy each cell can hold. */
  capacity: Float64Array;
  /** Plant energy each cell holds now. */
  energy: Float64Array;
  /** Energy of dead creatures lying in each cell. It rots away over time. */
  meat: Float64Array;
  /** Scent left by creatures in each cell. It spreads and fades; it is a signal, not energy. */
  scent: Float32Array;
  /** 1 where a wall blocks movement into the cell. */
  walls: Uint8Array;
  /** 1 where the cell is water: a lake or the river. Fixed for the life of the world. */
  water: Uint8Array;
  /** Whether the world has any water. Without it, nothing gets thirsty. */
  hasWater: boolean;
  /** 1 where a creature can drink: in water or in a cell next to it. */
  shore: Uint8Array;
  /** How much nearby water enriches the soil: 1 at the water's edge, fading to 0. */
  moisture: Float32Array;
  /** How hot each cell is on average: -1 the coldest regions, 1 the hottest. Fixed for the life of the world. */
  temperature: Float32Array;
}

/**
 * A fresh fertility map: seeded noise, one value in [0, 1] per cell, tiling
 * across the wrapped edges.
 */
export function generateFertility(config: SimConfig, rng: Rng, cols: number, rows: number): Float32Array {
  const fertility = tileableNoise(rng, cols, rows, FERTILITY_PERIODS);
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
    fertility[i] = Math.min(1, Math.max(0, (stretched - floor) / (1 - floor)));
  }
  return fertility;
}

/**
 * Fill in everything about the water that follows from where it is: whether
 * there is any, which cells are close enough to drink from, and how much
 * the nearby water enriches each cell's soil.
 */
export function waterDerived(
  water: Uint8Array,
  cols: number,
  rows: number,
  config: SimConfig,
): Pick<PlantField, 'water' | 'hasWater' | 'shore' | 'moisture'> {
  const distance = distanceToWater(water, cols, rows);
  const shore = new Uint8Array(water.length);
  const moisture = new Float32Array(water.length);
  for (let i = 0; i < water.length; i++) {
    shore[i] = distance[i]! <= 1 ? 1 : 0;
    moisture[i] =
      config.moistureReach > 0 ? Math.min(1, Math.max(0, 1 - (distance[i]! - 1) / config.moistureReach)) : 0;
  }
  return { water, hasWater: water.includes(1), shore, moisture };
}

/**
 * A map of hot and cold regions: seeded noise stretched to fill [-1, 1]. It
 * tiles across the wrapped edges, so there is no seam where hot meets cold.
 */
export function generateTemperature(config: SimConfig, rng: Rng, cols: number, rows: number): Float32Array {
  const regions = Math.max(2, Math.round(config.worldWidth / Math.max(1, config.biomeSize)));
  const temperature = tileableNoise(rng, cols, rows, [regions, regions * 2]);
  let low = Infinity;
  let high = -Infinity;
  for (const value of temperature) {
    low = Math.min(low, value);
    high = Math.max(high, value);
  }
  const spread = high > low ? high - low : 1;
  for (let i = 0; i < temperature.length; i++) temperature[i] = ((temperature[i]! - low) / spread) * 2 - 1;
  return temperature;
}

/** How hot a cell is right now: its own temperature plus the warmth of the season and hour. */
export function temperatureAt(field: PlantField, cell: number, warmth: number, config: SimConfig): number {
  return config.temperatureStrength * (field.temperature[cell]! + warmth);
}

/** Most plant energy a cell can hold: none under water, more on moist ground near it. */
export function cellCapacity(field: PlantField, cell: number, config: SimConfig): number {
  if (field.water[cell] === 1) return 0;
  const richness = Math.min(1, field.fertility[cell]! + field.moisture[cell]! * config.moistureBoost);
  return richness * config.plantCapacity;
}

/** Create a field with every cell grown to capacity. */
export function createPlantField(config: SimConfig, rng: Rng): PlantField {
  const cols = Math.max(1, Math.round(config.worldWidth / config.plantCellSize));
  const rows = Math.max(1, Math.round(config.worldHeight / config.plantCellSize));
  const fertility = generateFertility(config, rng, cols, rows);
  const field: PlantField = {
    cols,
    rows,
    cellWidth: config.worldWidth / cols,
    cellHeight: config.worldHeight / rows,
    fertility,
    capacity: new Float64Array(cols * rows),
    energy: new Float64Array(cols * rows),
    meat: new Float64Array(cols * rows),
    scent: new Float32Array(cols * rows),
    walls: new Uint8Array(cols * rows),
    ...waterDerived(generateWater(config, rng, cols, rows), cols, rows, config),
    temperature: generateTemperature(config, rng, cols, rows),
  };
  for (let i = 0; i < fertility.length; i++) field.capacity[i] = cellCapacity(field, i, config);
  field.energy.set(field.capacity);
  return field;
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

/** Hues of the ground, on the same 0 to 1 colour wheel as creatures' hue genes. */
const BARE_HUE = 0.08;
const PLANT_HUE = 0.33;
const WATER_HUE = 0.58;
/** A creature whose hue is this far from the ground's, or further, is not hidden at all. */
const CAMOUFLAGE_GAP = 0.2;

/**
 * The colour of the ground in a cell, as a hue: brown when bare, green when
 * full of plants, red where meat lies, blue for water.
 */
export function groundHue(field: PlantField, cell: number, config: SimConfig): number {
  if (field.water[cell] === 1) return WATER_HUE;
  const cover = config.plantCapacity > 0 ? Math.min(1, field.energy[cell]! / config.plantCapacity) : 0;
  const meat = Math.min(1, field.meat[cell]! / config.meatScale);
  // Red is hue 0, so meat pulls the hue down towards it.
  return (BARE_HUE + (PLANT_HUE - BARE_HUE) * cover) * (1 - meat);
}

/**
 * How far away a creature of the given hue can be seen while on ground of
 * `ground` hue, as a share of the viewer's sight range: 1 when it stands out,
 * down to 1 - camouflage when it matches exactly.
 */
export function visibility(hue: number, ground: number, camouflage: number): number {
  let gap = Math.abs(hue - ground);
  if (gap > 0.5) gap = 1 - gap;
  return 1 - camouflage * Math.max(0, 1 - gap / CAMOUFLAGE_GAP);
}