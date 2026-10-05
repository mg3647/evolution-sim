/**
 * Biomes: kinds of land, each with one clear perk and one clear drawback.
 * A cell's biome follows from how hot it is and how wet its soil is, the
 * way real biomes follow heat and rain.
 */

export const Biome = { Grassland: 0, Forest: 1, Rainforest: 2, Desert: 3, Tundra: 4 } as const;
export const BIOME_COUNT = 5;
export const BIOME_LABELS: string[] = ['Grassland', 'Forest', 'Rainforest', 'Desert', 'Tundra'];

export interface BiomeTraits {
  /** Multiplier on how much plant energy the land can hold. */
  plants: number;
  /**
   * How far away a creature standing here can be seen, as a multiple of the
   * viewer's sight range: under 1 is cover.
   */
  cover: number;
  /** Multiplier on how far a creature standing here sees. */
  sight: number;
  /** Multiplier on the energy cost of moving. */
  moveCost: number;
  /** Multiplier on how fast a creature here loses water. */
  thirst: number;
  /** Multiplier on how fast meat rots. */
  meatRot: number;
  /** How many times stronger the swing between hot days and cold nights is. */
  daySwing: number;
  /** Whether plants grow only in the warm half of the year, in one rich bloom. */
  seasonalBloom: boolean;
  /** Hue of the bare ground, for camouflage; see groundHue in plants.ts. */
  bareHue: number;
}

const PLAIN: BiomeTraits = {
  plants: 1,
  cover: 1,
  sight: 1,
  moveCost: 1,
  thirst: 1,
  meatRot: 1,
  daySwing: 1,
  seasonalBloom: false,
  bareHue: 0.08,
};

/** What each biome does, indexed by Biome. The numbers are starting points for tuning. */
export const BIOME_TRAITS: readonly BiomeTraits[] = [
  // Grassland: steady food and open sight, but nowhere to hide.
  PLAIN,
  // Forest: more plants and cover, but undergrowth makes moving cost more.
  { ...PLAIN, plants: 1.5, cover: 0.6, moveCost: 1.2 },
  // Rainforest: the richest plants and little thirst, but the least sight. Its heat is hard on big bodies.
  { ...PLAIN, plants: 2, cover: 0.4, thirst: 0.5 },
  // Desert: long sight and few rivals, but little food, great thirst, hot days and cold nights.
  { ...PLAIN, plants: 0.5, sight: 1.5, thirst: 2.5, daySwing: 3, bareHue: 0.13 },
  // Tundra: meat keeps and summer brings a bloom, but nothing grows in the cold half of the year.
  { ...PLAIN, meatRot: 0.25, seasonalBloom: true, bareHue: 0.55 },
];

/** Thresholds for telling biomes apart; see SimConfig for the settings behind them. */
export interface BiomeRules {
  /** A place's own temperature must be beyond this, either way, to be hot or cold. */
  temperature: number;
  /** Soil wetter than this is wet. */
  wetness: number;
}

/**
 * The biome for a place with a temperature in [-1, 1] (after any shift of
 * the whole climate) and soil wetness in [0, 1].
 */
export function biomeFor(temperature: number, wetness: number, rules: BiomeRules): number {
  if (temperature < -rules.temperature) return Biome.Tundra;
  if (temperature > rules.temperature) return wetness > rules.wetness ? Biome.Rainforest : Biome.Desert;
  return wetness > rules.wetness ? Biome.Forest : Biome.Grassland;
}

/**
 * How much plants grow in a seasonal-bloom biome at a point in the year:
 * nothing through autumn and winter, up to three times the normal rate at
 * midsummer, and about the same over a whole year as steady growth.
 * `yearPhase` is sin of the time of year: 1 at midsummer, -1 at midwinter.
 */
export function bloomGrowth(yearPhase: number): number {
  return Math.max(0, yearPhase) * 3;
}
