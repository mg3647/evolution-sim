import { Biome } from './biomes';
import type { SimConfig } from './config';
import { cellIndexAt, type PlantField } from './plants';
import type { Rng } from './rng';

/**
 * Blocks: solid things, each filling one cell, that stop movement as a wall
 * does but can be pushed, picked up, carried and set down by creatures. A
 * row of them is a wall, so a species that moves them can build.
 */

/** How many times likelier a cell is to start with a block in desert and tundra than elsewhere. */
const OPEN_LAND_BLOCKS = 4;

/** What creatures have done with blocks since the world was created. */
export interface BlockTally {
  /** Times a block was shoved one cell by a creature walking into it. */
  pushed: number;
  /** Times a creature set down a block it had been carrying. */
  setDown: number;
}

export function createBlockTally(): BlockTally {
  return { pushed: 0, setDown: 0 };
}

/** Whether a cell stops a creature walking into it: a wall or a block. */
export function isSolid(field: PlantField, cell: number): boolean {
  return field.walls[cell] === 1 || field.blocks[cell] === 1;
}

/** Whether a block can be put in a cell: nothing solid there already, and not water. */
export function canHoldBlock(field: PlantField, cell: number): boolean {
  return !isSolid(field, cell) && field.water[cell] === 0;
}

/** Add `by` to the count of blocks in or beside each of the nine cells around one. */
function countNear(field: PlantField, cell: number, by: number): void {
  const { cols, rows } = field;
  const cx = cell % cols;
  const cy = (cell - cx) / cols;
  for (let dy = -1; dy <= 1; dy++) {
    const row = ((cy + dy + rows) % rows) * cols;
    for (let dx = -1; dx <= 1; dx++) field.nearBlocks[row + ((cx + dx + cols) % cols)]! += by;
  }
}

/**
 * Put a block in a cell. `species` is the species of the creature that put
 * it there, or 0 if nobody did; `built` marks it as moved by a creature.
 */
export function addBlock(field: PlantField, cell: number, species = 0, built = false, heavy = false): void {
  if (field.blocks[cell] === 1) return;
  field.blocks[cell] = 1;
  field.blockCount++;
  field.blockHeavy[cell] = heavy ? 1 : 0;
  field.heavyGripTick[cell] = 0;
  field.blockSpecies[cell] = species;
  field.blockBuilt[cell] = built ? 1 : 0;
  countNear(field, cell, 1);
}

/** Take the block out of a cell, if there is one. Returns whether there was. */
export function removeBlock(field: PlantField, cell: number): boolean {
  if (field.blocks[cell] === 0) return false;
  field.blocks[cell] = 0;
  field.blockCount--;
  field.blockSpecies[cell] = 0;
  field.blockBuilt[cell] = 0;
  field.blockHeavy[cell] = 0;
  field.heavyGripTick[cell] = 0;
  countNear(field, cell, -1);
  return true;
}

/** Work out again, from where the blocks are, how many lie in or beside each cell. */
export function rebuildNearBlocks(field: PlantField): void {
  field.nearBlocks.fill(0);
  field.blockCount = 0;
  for (let cell = 0; cell < field.blocks.length; cell++) {
    if (field.blocks[cell] !== 1) continue;
    field.blockCount++;
    countNear(field, cell, 1);
  }
}

/** Scatter the first blocks over the land, more thickly in desert and tundra. */
export function scatterBlocks(field: PlantField, config: SimConfig, rng: Rng): void {
  if (config.blockDensity <= 0) return;
  // Shared out so that the whole map averages the configured density whatever its mix of biomes.
  let open = 0;
  let land = 0;
  for (let cell = 0; cell < field.biome.length; cell++) {
    if (field.water[cell] === 1) continue;
    land++;
    if (field.biome[cell] === Biome.Desert || field.biome[cell] === Biome.Tundra) open++;
  }
  if (land === 0) return;
  const elsewhere = (config.blockDensity * land) / (open * OPEN_LAND_BLOCKS + (land - open));
  for (let cell = 0; cell < field.biome.length; cell++) {
    if (field.water[cell] === 1 || field.walls[cell] === 1) continue;
    const biome = field.biome[cell]!;
    const chance = biome === Biome.Desert || biome === Biome.Tundra ? elsewhere * OPEN_LAND_BLOCKS : elsewhere;
    if (rng.chance(Math.min(1, chance))) addBlock(field, cell, 0, false, rng.chance(config.heavyBlockShare));
  }
}

/**
 * Whether a block stands between two points, which are `dx` and `dy` apart
 * the short way round the wrapped world. The cells the points are in do not count.
 */
export function blockBetween(field: PlantField, x: number, y: number, dx: number, dy: number, worldWidth: number, worldHeight: number): boolean {
  if (field.blockCount === 0) return false;
  const steps = Math.ceil(Math.hypot(dx, dy) / Math.min(field.cellWidth, field.cellHeight));
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    let px = x + dx * t;
    let py = y + dy * t;
    px -= Math.floor(px / worldWidth) * worldWidth;
    py -= Math.floor(py / worldHeight) * worldHeight;
    if (field.blocks[cellIndexAt(field, px, py)] === 1) return true;
  }
  return false;
}

/** What stands in the way between two points: nothing, a block, or a wall, which hides more. */
export const Obstacle = { None: 0, Block: 1, Wall: 2 } as const;

/**
 * The thickest obstacle between two points, which are `dx` and `dy` apart
 * the short way round the wrapped world: a wall if there is one, else a
 * block if there is one. The cells the points are in do not count.
 */
export function obstacleBetween(field: PlantField, x: number, y: number, dx: number, dy: number, worldWidth: number, worldHeight: number): number {
  const steps = Math.ceil(Math.hypot(dx, dy) / Math.min(field.cellWidth, field.cellHeight));
  let found: number = Obstacle.None;
  for (let s = 1; s < steps; s++) {
    const t = s / steps;
    let px = x + dx * t;
    let py = y + dy * t;
    px -= Math.floor(px / worldWidth) * worldWidth;
    py -= Math.floor(py / worldHeight) * worldHeight;
    const cell = cellIndexAt(field, px, py);
    if (field.walls[cell] === 1) return Obstacle.Wall;
    if (field.blocks[cell] === 1) found = Obstacle.Block;
  }
  return found;
}

/** The cell one step on from `to`, in the direction a creature moved to get from `from` to `to`; -1 if it did not change cell. */
export function cellBeyond(field: PlantField, from: number, to: number): number {
  const { cols, rows } = field;
  const fx = from % cols;
  const tx = to % cols;
  const fy = (from - fx) / cols;
  const ty = (to - tx) / cols;
  // The short way round the wrapped world.
  let dx = tx - fx;
  if (dx > 1) dx -= cols;
  else if (dx < -1) dx += cols;
  let dy = ty - fy;
  if (dy > 1) dy -= rows;
  else if (dy < -1) dy += rows;
  if (dx === 0 && dy === 0) return -1;
  return ((ty + dy + rows) % rows) * cols + ((tx + dx + cols) % cols);
}

/** How many ticks a creature's push on a heavy block lasts, for a second creature to join it. */
const GRIP_TICKS = 2;

/**
 * Shove the block in `to` one cell on, away from a creature of the given
 * species coming from `from`. Returns whether it moved: it does not if the
 * cell beyond is solid or water. A heavy block moves only if `grip` is given
 * and a different creature pushed on it this tick or the one before; the
 * first to push leaves the mark and stays put.
 */
export function pushBlock(
  field: PlantField,
  from: number,
  to: number,
  species: number,
  grip?: { tick: number; creature: number },
): boolean {
  if (field.blocks[to] === 0) return false;
  const heavy = field.blockHeavy[to] === 1;
  if (heavy) {
    if (!grip) return false;
    const recent = field.heavyGripTick[to]! > 0 && grip.tick + 1 - field.heavyGripTick[to]! <= GRIP_TICKS;
    if (!recent || field.heavyGripper[to] === grip.creature) {
      field.heavyGripTick[to] = grip.tick + 1;
      field.heavyGripper[to] = grip.creature;
      return false;
    }
  }
  const beyond = cellBeyond(field, from, to);
  if (beyond < 0 || !canHoldBlock(field, beyond)) return false;
  removeBlock(field, to);
  addBlock(field, beyond, species, true, heavy);
  return true;
}

/** A free cell for a block at `cell` or, failing that, one of the eight around it; -1 if there is none. */
export function freeCellNear(field: PlantField, cell: number, reach = 1): number {
  if (canHoldBlock(field, cell)) return cell;
  const { cols, rows } = field;
  const cx = cell % cols;
  const cy = (cell - cx) / cols;
  for (let r = 1; r <= reach; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const near = ((cy + dy + rows) % rows) * cols + ((cx + dx + cols) % cols);
        if (canHoldBlock(field, near)) return near;
      }
    }
  }
  return -1;
}

/**
 * The longest straight run of touching blocks that creatures have moved:
 * along a row, a column or either diagonal. Runs do not continue across the
 * world's edges, and blocks nobody has moved do not count.
 */
export function longestBuiltLine(field: PlantField): number {
  const { cols, rows, blockBuilt } = field;
  let longest = 0;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ] as const) {
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        if (blockBuilt[cy * cols + cx] === 0) continue;
        // Only count from the start of a run.
        const px = cx - dx;
        const py = cy - dy;
        if (px >= 0 && px < cols && py >= 0 && py < rows && blockBuilt[py * cols + px] === 1) continue;
        let length = 0;
        for (let x = cx, y = cy; x >= 0 && x < cols && y >= 0 && y < rows && blockBuilt[y * cols + x] === 1; x += dx, y += dy) {
          length++;
        }
        if (length > longest) longest = length;
      }
    }
  }
  return longest;
}
