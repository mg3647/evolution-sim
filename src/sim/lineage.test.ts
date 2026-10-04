import { describe, expect, it } from 'vitest';
import { Lineage } from './lineage';

/** Ids of the kept nodes, sorted. */
function ids(lineage: Lineage): number[] {
  return [...lineage.all()].map((node) => node.id).sort((a, b) => a - b);
}

describe('Lineage', () => {
  it('records births with their parent', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0.5);
    lineage.born(2, 1, 10, 0.5);
    expect(lineage.get(2)).toMatchObject({ parentId: 1, birthTick: 10, deathTick: -1 });
    expect(lineage.get(1)!.children).toEqual([2]);
  });

  it('drops a creature that dies without living descendants', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0);
    lineage.born(2, 1, 5, 0);
    lineage.died(2, 9);
    expect(ids(lineage)).toEqual([1]);
    expect(lineage.get(1)!.children).toEqual([]);
  });

  it('keeps a dead ancestor where the tree branches', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0);
    lineage.born(2, 1, 5, 0);
    lineage.born(3, 1, 6, 0);
    lineage.died(1, 20);
    expect(ids(lineage)).toEqual([1, 2, 3]);
    expect(lineage.get(1)!.deathTick).toBe(20);
  });

  it('splices a dead ancestor with one child out of the chain', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0);
    lineage.born(2, 1, 5, 0);
    lineage.born(3, 2, 9, 0);
    lineage.died(2, 12);
    expect(ids(lineage)).toEqual([1, 3]);
    expect(lineage.get(3)!.parentId).toBe(1);
    expect(lineage.get(1)!.children).toEqual([3]);
  });

  it('cascades: removing the last of two branches collapses the fork', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0);
    lineage.born(2, 1, 5, 0);
    lineage.born(3, 1, 6, 0);
    lineage.died(1, 20);
    lineage.died(3, 25);
    // The fork at 1 now has one branch left, so it goes and 2 becomes a root.
    expect(ids(lineage)).toEqual([2]);
    expect(lineage.get(2)!.parentId).toBe(0);
  });

  it('treats a child of an already-forgotten parent as a root', () => {
    const lineage = new Lineage();
    lineage.born(7, 99, 3, 0);
    expect(lineage.get(7)!.parentId).toBe(0);
  });

  it('stays near twice the living population over a long random history', () => {
    const lineage = new Lineage();
    let nextId = 1;
    let alive: number[] = [];
    for (let i = 0; i < 20; i++) {
      lineage.born(nextId, 0, 0, 0);
      alive.push(nextId++);
    }
    // Deterministic pseudo-random births and deaths holding the population near 20.
    let state = 12345;
    const random = () => (state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for (let tick = 1; tick < 5000; tick++) {
      const parent = alive[Math.floor(random() * alive.length)]!;
      lineage.born(nextId, parent, tick, 0);
      alive.push(nextId++);
      const victim = Math.floor(random() * alive.length);
      lineage.died(alive[victim]!, tick);
      alive.splice(victim, 1);
    }
    expect(alive.length).toBe(20);
    expect(lineage.size).toBeLessThan(2 * alive.length);
    for (const id of alive) expect(lineage.get(id)!.deathTick).toBe(-1);
    // Every kept dead node is a real fork, and every parent link is mutual.
    for (const node of lineage.all()) {
      if (node.deathTick >= 0) expect(node.children.length).toBeGreaterThanOrEqual(2);
      for (const child of node.children) expect(lineage.get(child)!.parentId).toBe(node.id);
    }
  });

  it('round-trips through save and load', () => {
    const lineage = new Lineage();
    lineage.born(1, 0, 0, 0.1);
    lineage.born(2, 1, 5, 0.2);
    lineage.born(3, 1, 6, 0.3);
    const copy = Lineage.load(lineage.save());
    expect(copy.save()).toEqual(lineage.save());
    copy.died(3, 9);
    expect(lineage.get(3)).toBeDefined();
  });
});
