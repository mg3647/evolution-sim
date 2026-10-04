import type { Rng } from './rng';

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * Value noise sampled at the centre of each cell of a cols x rows grid. It
 * tiles seamlessly in both directions, to match the wrapping world.
 *
 * `periods` lists, per octave, how many noise features span the grid's width;
 * each octave contributes half the amplitude of the one before. Values are in
 * [0, 1].
 */
export function tileableNoise(
  rng: Rng,
  cols: number,
  rows: number,
  periods: readonly number[],
): Float32Array {
  const out = new Float32Array(cols * rows);
  let amplitude = 1;
  let totalAmplitude = 0;

  for (const periodX of periods) {
    const periodY = Math.max(1, Math.round((periodX * rows) / cols));
    const lattice = new Float32Array(periodX * periodY);
    for (let i = 0; i < lattice.length; i++) lattice[i] = rng.float();
    const at = (ix: number, iy: number) => lattice[(iy % periodY) * periodX + (ix % periodX)]!;

    for (let cy = 0; cy < rows; cy++) {
      const v = ((cy + 0.5) / rows) * periodY;
      const y0 = Math.floor(v);
      const ty = smooth(v - y0);
      for (let cx = 0; cx < cols; cx++) {
        const u = ((cx + 0.5) / cols) * periodX;
        const x0 = Math.floor(u);
        const tx = smooth(u - x0);
        const top = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * tx;
        const bottom = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * tx;
        out[cy * cols + cx]! += (top + (bottom - top) * ty) * amplitude;
      }
    }
    totalAmplitude += amplitude;
    amplitude /= 2;
  }

  for (let i = 0; i < out.length; i++) out[i]! /= totalAmplitude;
  return out;
}
