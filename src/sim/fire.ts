import { Biome } from './biomes';
import type { SimConfig } from './config';
import type { EnergyLedger } from './ledger';
import type { PlantField } from './plants';
import type { Rng } from './rng';

/**
 * Things lying on the ground, and wildfire. Branches lie in forests and
 * stones in deserts. Fire starts by lightning in hot weather, spreads through
 * plants and branches, hurts whatever stands in it, warms the land around
 * it, and leaves ash on which plants regrow faster.
 */

/** Most branches a cell holds. */
export const MAX_BRANCHES = 3;
/** Cells from a fire within which the air is warmed. */
const WARM_REACH = 2;
/** Ash below this has washed away. */
const ASH_GONE = 0.01;
/** A cell with this much ash or more is still too bare to burn again. */
const ASH_FIREBREAK = 0.5;

/** Totals since the world was created. */
export interface FireTally {
  /** Fires started by lightning or by hand. */
  started: number;
  /** Cells that have caught fire. */
  cellsBurned: number;
  /** Cells burning right now. */
  burning: number;
}

export function createFireTally(): FireTally {
  return { started: 0, cellsBurned: 0, burning: 0 };
}

/** Scatter the first branches over forest and rainforest, and stones over desert. */
export function scatterItems(field: PlantField, config: SimConfig, rng: Rng): void {
  for (let cell = 0; cell < field.biome.length; cell++) {
    if (field.water[cell] === 1) continue;
    const biome = field.biome[cell]!;
    if ((biome === Biome.Forest || biome === Biome.Rainforest) && rng.chance(config.branchDensity)) {
      field.branches[cell] = 1;
    } else if (biome === Biome.Desert && rng.chance(config.stoneDensity)) {
      field.stones[cell] = 1;
    }
  }
}

/**
 * Let branches fall: each tick a few cells are looked at, and a forest or
 * rainforest cell among them with room gains one. Over `branchRegrowTicks`
 * every cell is looked at about once.
 */
export function dropBranches(field: PlantField, config: SimConfig, rng: Rng): void {
  if (config.branchRegrowTicks <= 0) return;
  const cells = field.biome.length;
  const looks = cells / config.branchRegrowTicks;
  // The whole part is looked at for certain, the fraction by chance.
  const count = Math.floor(looks) + (rng.chance(looks - Math.floor(looks)) ? 1 : 0);
  for (let k = 0; k < count; k++) {
    const cell = rng.int(0, cells);
    const biome = field.biome[cell]!;
    if (field.water[cell] === 1 || field.fire[cell]! > 0) continue;
    if ((biome === Biome.Forest || biome === Biome.Rainforest) && field.branches[cell]! < MAX_BRANCHES) {
      field.branches[cell]!++;
    }
  }
}

/** Whether a cell has enough to burn: plants, or a branch. Water, walls and fresh ash do not burn. */
function fuel(field: PlantField, cell: number, config: SimConfig): number {
  if (field.water[cell] === 1 || field.walls[cell] === 1 || field.ash[cell]! >= ASH_FIREBREAK) return 0;
  if (field.branches[cell]! > 0) return 1;
  return config.plantCapacity > 0 ? Math.min(1, field.energy[cell]! / config.plantCapacity) : 0;
}

/** Set a cell alight if it has anything to burn. Returns whether it caught. */
export function ignite(field: PlantField, cell: number, config: SimConfig, tally: FireTally): boolean {
  if (field.fire[cell]! > 0 || fuel(field, cell, config) < config.fireMinFuel) return false;
  field.fire[cell] = config.fireDuration;
  tally.cellsBurned++;
  tally.burning++;
  return true;
}

/**
 * Lightning: in hot weather, now and then a random cell is struck. `heat` is
 * how hot that cell is right now; the hotter, the likelier it catches.
 */
export function maybeLightning(
  field: PlantField,
  config: SimConfig,
  rng: Rng,
  tally: FireTally,
  heatAt: (cell: number) => number,
): void {
  if (config.fireChance <= 0 || !rng.chance(config.fireChance)) return;
  const cell = rng.int(0, field.biome.length);
  if (heatAt(cell) < config.fireMinHeat) return;
  if (ignite(field, cell, config, tally)) tally.started++;
}

/**
 * Advance every fire by one tick: burn plants away as heat, spread to
 * neighbouring cells with fuel, and leave ash when a cell burns out. A
 * branch in a burning cell keeps it alight longer. Also rebuilds the map of
 * warmth around fires, and fades old ash.
 */
export function burn(
  field: PlantField,
  config: SimConfig,
  rng: Rng,
  ledger: EnergyLedger,
  tally: FireTally,
): void {
  const { cols, rows, fire, ash, energy, fireHeat } = field;
  if (tally.burning === 0 && !field.hasAsh) return;

  let burning = 0;
  let anyAsh = false;
  let burned = 0;
  const caught: number[] = [];
  if (tally.burning > 0) fireHeat.fill(0);
  for (let cell = 0; cell < fire.length; cell++) {
    if (ash[cell]! > 0) {
      const left = ash[cell]! * (1 - config.ashDecay);
      ash[cell] = left < ASH_GONE ? 0 : left;
      if (left >= ASH_GONE) anyAsh = true;
    }
    if (fire[cell]! <= 0) continue;

    // Burn a share of the plants each tick.
    const loss = energy[cell]! * config.fireBurnRate;
    energy[cell]! -= loss;
    burned += loss;

    const cx = cell % cols;
    const cy = (cell - cx) / cols;
    // Spread to each of the four neighbours that has enough to burn, by chance.
    for (let side = 0; side < 4; side++) {
      const nx = (cx + (side === 0 ? 1 : side === 1 ? cols - 1 : 0)) % cols;
      const ny = (cy + (side === 2 ? 1 : side === 3 ? rows - 1 : 0)) % rows;
      const neighbour = ny * cols + nx;
      if (fire[neighbour]! > 0) continue;
      const food = fuel(field, neighbour, config);
      if (food >= config.fireMinFuel && rng.chance(config.fireSpread)) caught.push(neighbour);
    }

    // Warm the air around.
    for (let dy = -WARM_REACH; dy <= WARM_REACH; dy++) {
      const wy = (cy + dy + rows) % rows;
      for (let dx = -WARM_REACH; dx <= WARM_REACH; dx++) {
        const reach = Math.max(Math.abs(dx), Math.abs(dy));
        const at = wy * cols + ((cx + dx + cols) % cols);
        const warmth = config.fireWarmth * (1 - reach / (WARM_REACH + 1));
        if (warmth > fireHeat[at]!) fireHeat[at] = warmth;
      }
    }

    const left = fire[cell]! - 1;
    if (left > 0) {
      fire[cell] = left;
      burning++;
    } else if (field.branches[cell]! > 0) {
      // A branch burns in its turn and keeps the fire going.
      field.branches[cell]!--;
      fire[cell] = config.fireDuration;
      burning++;
    } else {
      fire[cell] = 0;
      ash[cell] = 1;
      anyAsh = true;
    }
  }
  for (const cell of caught) {
    if (fire[cell] === 0) {
      fire[cell] = config.fireDuration;
      tally.cellsBurned++;
      burning++;
    }
  }
  if (burning === 0 && tally.burning > 0) fireHeat.fill(0);
  tally.burning = burning;
  field.hasAsh = anyAsh;
  ledger.heatOut += burned;
}
