/**
 * Walls, water and biomes change rarely (a tool, rain, a slow climate drift),
 * yet the screen needs them for every picture. So the worker sends them only
 * when they differ from the ones it sent last, and the page keeps the last
 * ones it received and fills them back in.
 */

/** The maps that are sent only when they change. */
export interface SteadyMaps {
  walls: Uint8Array;
  water: Uint8Array;
  biome: Uint8Array;
}

const NONE = new Uint8Array(0);

function same(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Worker side: decides whether a snapshot carries the steady maps. */
export class SteadyMapSender {
  private sent: SteadyMaps | null = null;

  /** Send the maps with the next snapshot whatever they hold, as after a new world or a drawing switch. */
  reset(): void {
    this.sent = null;
  }

  /** Copies of the maps if any changed since the last ones sent, or null if none did. */
  take(walls: Uint8Array, water: Uint8Array, biome: Uint8Array): SteadyMaps | null {
    const last = this.sent;
    if (last && same(last.walls, walls) && same(last.water, water) && same(last.biome, biome)) return null;
    this.sent = { walls: walls.slice(), water: water.slice(), biome: biome.slice() };
    // The page gets its own copies; the ones kept here are for comparing.
    return { walls: walls.slice(), water: water.slice(), biome: biome.slice() };
  }
}

/** Page side: fills the steady maps back into a snapshot that left them out. */
export class SteadyMapKeeper {
  private kept: SteadyMaps = { walls: NONE, water: NONE, biome: NONE };

  /** Called with each snapshot; `sent` says whether it carries the maps. */
  fill(snapshot: SteadyMaps & { mapsSent: boolean; rendered: boolean }): void {
    if (!snapshot.rendered) return;
    if (snapshot.mapsSent) {
      this.kept = { walls: snapshot.walls, water: snapshot.water, biome: snapshot.biome };
      return;
    }
    snapshot.walls = this.kept.walls;
    snapshot.water = this.kept.water;
    snapshot.biome = this.kept.biome;
  }
}
