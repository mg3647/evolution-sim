import { describe, expect, it } from 'vitest';
import { defaultConfig } from './config';
import { createLedger } from './ledger';
import { tileableNoise } from './noise';
import { cellIndexAt, createPlantField, growPlants, totalPlantEnergy } from './plants';
import { Rng } from './rng';

describe('tileableNoise', () => {
  it('stays in [0, 1] and is repeatable for a seed', () => {
    const a = tileableNoise(new Rng('n'), 40, 30, [2, 4, 8]);
    const b = tileableNoise(new Rng('n'), 40, 30, [2, 4, 8]);
    expect(a).toEqual(b);
    for (const v of a) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('is continuous across the wrapped edges', () => {
    const cols = 64;
    const rows = 64;
    const noise = tileableNoise(new Rng('seam'), cols, rows, [2, 4]);
    let seam = 0;
    let interior = 0;
    for (let y = 0; y < rows; y++) {
      seam += Math.abs(noise[y * cols]! - noise[y * cols + cols - 1]!);
      interior += Math.abs(noise[y * cols + 30]! - noise[y * cols + 31]!);
    }
    // The step across the seam is no rougher than a step in the middle.
    expect(seam).toBeLessThan(interior * 3 + 0.5);
  });
});

describe('plant field', () => {
  const config = { ...defaultConfig, worldWidth: 400, worldHeight: 200, plantCellSize: 20 };

  it('tiles the world exactly and starts full', () => {
    const field = createPlantField(config, new Rng('f'));
    expect(field.cols).toBe(20);
    expect(field.rows).toBe(10);
    expect(field.energy).toEqual(field.capacity);
    for (const f of field.fertility) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    expect(totalPlantEnergy(field)).toBeGreaterThan(0);
  });

  it('spans the full range of fertility, from barren to fully fertile', () => {
    const field = createPlantField(config, new Rng('f'));
    expect(Math.max(...field.fertility)).toBeCloseTo(1, 5);
    expect(Math.min(...field.fertility)).toBe(0);
  });

  it('maps positions to cells, clamping the far edge', () => {
    const field = createPlantField(config, new Rng('f'));
    expect(cellIndexAt(field, 0, 0)).toBe(0);
    expect(cellIndexAt(field, 25, 0)).toBe(1);
    expect(cellIndexAt(field, 0, 25)).toBe(20);
    expect(cellIndexAt(field, 400, 200)).toBe(20 * 10 - 1);
  });

  it('regrows toward capacity and books the growth as sunlight', () => {
    const field = createPlantField(config, new Rng('f'));
    const full = totalPlantEnergy(field);
    field.energy.fill(0);
    const ledger = createLedger();

    // With bare growth at 1 the cover term drops out and growth is linear.
    growPlants(field, 0.1, 1, ledger);
    expect(totalPlantEnergy(field)).toBeCloseTo(full * 0.1, 6);
    expect(ledger.sunIn).toBeCloseTo(full * 0.1, 6);

    for (let i = 0; i < 500; i++) growPlants(field, 0.1, 1, ledger);
    expect(totalPlantEnergy(field)).toBeCloseTo(full, 6);
    expect(ledger.sunIn).toBeCloseTo(full, 6);
  });

  it('grows a half-eaten cell faster than a bare one, and never past capacity', () => {
    const field = createPlantField(config, new Rng('f'));
    const full = totalPlantEnergy(field);

    const growthFrom = (fill: number) => {
      for (let i = 0; i < field.energy.length; i++) field.energy[i] = field.capacity[i]! * fill;
      const ledger = createLedger();
      growPlants(field, 0.1, 0.1, ledger);
      return ledger.sunIn;
    };
    expect(growthFrom(0.5)).toBeGreaterThan(growthFrom(0));
    expect(growthFrom(0)).toBeGreaterThan(0);
    expect(growthFrom(1)).toBeCloseTo(0, 9);

    field.energy.fill(0);
    const ledger = createLedger();
    for (let i = 0; i < 5000; i++) growPlants(field, 0.1, 0.1, ledger);
    expect(totalPlantEnergy(field)).toBeCloseTo(full, 6);
    for (let i = 0; i < field.energy.length; i++) {
      expect(field.energy[i]).toBeLessThanOrEqual(field.capacity[i]! + 1e-9);
    }
  });
});
