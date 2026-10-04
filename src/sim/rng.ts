/**
 * Seeded random number generator (sfc32). Every random decision in the sim
 * must come from here so that a seed fully determines a run.
 */

export interface RngState {
  a: number;
  b: number;
  c: number;
  d: number;
}

/** xmur3 string hash: turns a seed string into a stream of 32-bit values. */
function seedHasher(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return h >>> 0;
  };
}

export class Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: string | number) {
    const next = seedHasher(String(seed));
    this.a = next();
    this.b = next();
    this.c = next();
    this.d = next();
    // Discard the first outputs so similar seeds diverge.
    for (let i = 0; i < 12; i++) this.uint32();
  }

  /** Uniform integer in [0, 2^32). */
  uint32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }

  /** Uniform float in [0, 1). */
  float(): number {
    return this.uint32() / 4294967296;
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + this.float() * (max - min);
  }

  /** Uniform integer in [min, max). */
  int(min: number, max: number): number {
    return min + Math.floor(this.float() * (max - min));
  }

  /** True with probability p. */
  chance(p: number): boolean {
    return this.float() < p;
  }

  /** Uniformly chosen element of a non-empty array. */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new Error('Rng.pick: empty array');
    return items[this.int(0, items.length)] as T;
  }

  getState(): RngState {
    return { a: this.a, b: this.b, c: this.c, d: this.d };
  }

  setState(state: RngState): void {
    this.a = state.a;
    this.b = state.b;
    this.c = state.c;
    this.d = state.d;
  }
}
