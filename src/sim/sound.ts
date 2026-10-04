import type { SimConfig } from './config';
import type { Creatures } from './creatures';

/**
 * Calls made by creatures, as loudness on a coarse grid. It is rebuilt every
 * tick from who called on the tick before, so a call is heard one tick late
 * and then is gone. A call is loudest in its own cell and carries, fainter,
 * into the eight cells around it.
 */
export interface SoundField {
  cols: number;
  rows: number;
  cellWidth: number;
  cellHeight: number;
  /** Number of callers in each cell. */
  callers: Float32Array;
  /** Loudness in each cell: 1 is one caller in that very cell. */
  loudness: Float32Array;
}

/** Share of a call's loudness that reaches the cells beside and diagonal to the caller's. */
const BESIDE = 0.5;
const DIAGONAL = 0.25;

export function createSoundField(config: SimConfig): SoundField {
  const cols = Math.max(1, Math.round(config.worldWidth / config.soundCellSize));
  const rows = Math.max(1, Math.round(config.worldHeight / config.soundCellSize));
  return {
    cols,
    rows,
    cellWidth: config.worldWidth / cols,
    cellHeight: config.worldHeight / rows,
    callers: new Float32Array(cols * rows),
    loudness: new Float32Array(cols * rows),
  };
}

/** Index of the sound cell containing a world position inside [0, world size). */
export function soundCellAt(field: SoundField, x: number, y: number): number {
  const cx = Math.min(field.cols - 1, Math.floor(x / field.cellWidth));
  const cy = Math.min(field.rows - 1, Math.floor(y / field.cellHeight));
  return cy * field.cols + cx;
}

/** Rebuild the field from the creatures currently flagged as calling. Returns how many are. */
export function buildSound(field: SoundField, c: Creatures): number {
  const { cols, rows, callers, loudness } = field;
  callers.fill(0);
  let calling = 0;
  for (let i = 0; i < c.count; i++) {
    if (c.calling[i] === 0) continue;
    callers[soundCellAt(field, c.x[i]!, c.y[i]!)]!++;
    calling++;
  }
  loudness.fill(0);
  if (calling === 0) return 0;

  for (let y = 0; y < rows; y++) {
    const up = (y === 0 ? rows - 1 : y - 1) * cols;
    const down = (y === rows - 1 ? 0 : y + 1) * cols;
    const row = y * cols;
    for (let x = 0; x < cols; x++) {
      const count = callers[row + x]!;
      if (count === 0) continue;
      const left = x === 0 ? cols - 1 : x - 1;
      const right = x === cols - 1 ? 0 : x + 1;
      loudness[row + x]! += count;
      loudness[row + left]! += count * BESIDE;
      loudness[row + right]! += count * BESIDE;
      loudness[up + x]! += count * BESIDE;
      loudness[down + x]! += count * BESIDE;
      loudness[up + left]! += count * DIAGONAL;
      loudness[up + right]! += count * DIAGONAL;
      loudness[down + left]! += count * DIAGONAL;
      loudness[down + right]! += count * DIAGONAL;
    }
  }
  return calling;
}
