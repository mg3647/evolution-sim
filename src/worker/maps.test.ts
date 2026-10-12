import { describe, expect, it } from 'vitest';
import { SteadyMapKeeper, SteadyMapSender } from './maps';

const snapshot = (maps: { walls: Uint8Array; water: Uint8Array; biome: Uint8Array } | null) => ({
  walls: maps?.walls ?? new Uint8Array(0),
  water: maps?.water ?? new Uint8Array(0),
  biome: maps?.biome ?? new Uint8Array(0),
  mapsSent: maps !== null,
  rendered: true,
});

describe('steady maps', () => {
  it('are sent first, then only when one changes', () => {
    const sender = new SteadyMapSender();
    const walls = new Uint8Array([0, 1, 0]);
    const water = new Uint8Array([1, 0, 0]);
    const biome = new Uint8Array([2, 2, 3]);
    expect(sender.take(walls, water, biome)).not.toBeNull();
    expect(sender.take(walls, water, biome)).toBeNull();
    walls[2] = 1;
    expect(sender.take(walls, water, biome)?.walls).toEqual(new Uint8Array([0, 1, 1]));
    expect(sender.take(walls, water, biome)).toBeNull();
    sender.reset();
    expect(sender.take(walls, water, biome)).not.toBeNull();
  });

  it('are sent as copies, so later changes in the world do not reach the page', () => {
    const sender = new SteadyMapSender();
    const walls = new Uint8Array([0, 0]);
    const sent = sender.take(walls, new Uint8Array(2), new Uint8Array(2))!;
    walls[0] = 1;
    expect(sent.walls[0]).toBe(0);
  });

  it('are filled back in on the page when left out', () => {
    const sender = new SteadyMapSender();
    const keeper = new SteadyMapKeeper();
    const walls = new Uint8Array([0, 1]);
    const water = new Uint8Array([1, 0]);
    const biome = new Uint8Array([3, 4]);
    const first = snapshot(sender.take(walls, water, biome));
    keeper.fill(first);
    const second = snapshot(sender.take(walls, water, biome));
    expect(second.mapsSent).toBe(false);
    keeper.fill(second);
    expect(second.walls).toEqual(walls);
    expect(second.water).toEqual(water);
    expect(second.biome).toEqual(biome);
  });

  it('are left empty when nothing is drawn', () => {
    const keeper = new SteadyMapKeeper();
    keeper.fill(snapshot({ walls: new Uint8Array([1]), water: new Uint8Array([1]), biome: new Uint8Array([1]) }));
    const undrawn = { ...snapshot(null), rendered: false };
    keeper.fill(undrawn);
    expect(undrawn.walls.length).toBe(0);
  });
});
