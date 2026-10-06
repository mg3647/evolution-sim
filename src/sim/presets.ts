import { defaultConfig, type SimConfig } from './config';

/**
 * What the settings panel shows: the settings worth a slider, grouped and
 * explained, and ready-made presets. Every other constant is still editable
 * in the panel's full list.
 */

/** Settings that shape the world when it is created. A change takes effect on the next restart. */
export const RESTART_KEYS: ReadonlySet<keyof SimConfig> = new Set<keyof SimConfig>([
  'seed',
  'worldWidth',
  'worldHeight',
  'plantCellSize',
  'fertilityFloor',
  'waterShare',
  'biomeSize',
  'branchDensity',
  'stoneDensity',
  'riverWidth',
  'moistureReach',
  'initialCreatures',
  'founderDietMax',
  'founderLinks',
  'senseRange',
  'raySpread',
  'statsInterval',
  'statsCapacity',
  'randomEvents',
]);

export interface SettingInfo {
  key: keyof SimConfig;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
}

export interface SettingGroup {
  title: string;
  settings: SettingInfo[];
}

export const SETTING_GROUPS: SettingGroup[] = [
  {
    title: 'Plants and seasons',
    settings: [
      { key: 'plantCapacity', label: 'Plant richness', hint: 'How much food the best land can hold', min: 4, max: 60, step: 1 },
      { key: 'plantGrowthRate', label: 'Plant growth speed', hint: 'How fast eaten plants grow back', min: 0.001, max: 0.03, step: 0.001 },
      { key: 'seasonStrength', label: 'Season strength', hint: '0 is no seasons; 0.9 swings from near-dark winters to bright summers', min: 0, max: 0.9, step: 0.05 },
      { key: 'seasonLength', label: 'Year length (ticks)', hint: 'Ticks in one full cycle of seasons', min: 1000, max: 30000, step: 500 },
      { key: 'dayLength', label: 'Day length (ticks)', hint: 'Ticks in one day and night; 0 turns night off', min: 0, max: 3000, step: 50 },
      { key: 'nightVision', label: 'Sight at night', hint: 'How far creatures see at midnight, as a share of how far they see at noon', min: 0.1, max: 1, step: 0.05 },
      { key: 'fertilityDriftPeriod', label: 'Land drift (ticks)', hint: 'Ticks for rich and barren land to move to entirely new places; 0 keeps it fixed', min: 0, max: 300000, step: 10000 },
    ],
  },
  {
    title: 'Water and thirst',
    settings: [
      { key: 'thirstRate', label: 'Thirst', hint: 'Share of its water a creature loses each tick; at 0.0004 it lasts about 2,500 ticks without a drink', min: 0, max: 0.005, step: 0.0001 },
      { key: 'drinkRate', label: 'Drinking speed', hint: 'Share of its water a creature regains each tick in or beside water', min: 0.001, max: 0.1, step: 0.001 },
      { key: 'swimSpeed', label: 'Swimming speed', hint: 'How fast creatures move in water, compared with on land', min: 0.1, max: 1, step: 0.05 },
      { key: 'swimCost', label: 'Swimming cost', hint: 'How much more energy living costs while in water', min: 1, max: 4, step: 0.1 },
      { key: 'moistureBoost', label: 'Richer land by water', hint: 'Extra fertility at the water’s edge, fading with distance', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Temperature',
    settings: [
      { key: 'temperatureStrength', label: 'Temperature strength', hint: 'How far hot and cold places, seasons and nights differ; 0 turns temperature and biomes off', min: 0, max: 2, step: 0.1 },
      { key: 'climateShift', label: 'Warmer or colder world', hint: 'Below zero makes everywhere colder, so more tundra; above makes everywhere hotter, so more desert and rainforest', min: -1, max: 1, step: 0.05 },
      { key: 'biomeTempThreshold', label: 'Mild land', hint: 'Higher leaves more of the map as grassland and forest; lower gives more desert, rainforest and tundra', min: 0.05, max: 0.95, step: 0.05 },
      { key: 'biomeWetThreshold', label: 'Open land', hint: 'Higher leaves more grassland and desert; lower gives more forest and rainforest', min: 0.05, max: 0.95, step: 0.05 },
      { key: 'exertionHeat', label: 'Heat of moving', hint: 'How much hotter moving flat out makes a creature feel', min: 0, max: 1, step: 0.05 },
      { key: 'temperatureCost', label: 'Cost of heat and cold', hint: 'Extra energy a creature burns when too hot or too cold, as a multiple of its upkeep', min: 0, max: 5, step: 0.1 },
      { key: 'comfortBand', label: 'Comfort range', hint: 'How far from mild a plain creature can be before the temperature costs it anything', min: 0, max: 1, step: 0.05 },
      { key: 'furWarmth', label: 'Warmth of fur', hint: 'How much cold a full coat keeps out', min: 0, max: 1.5, step: 0.05 },
      { key: 'furCost', label: 'Cost of fur', hint: 'Energy a full coat costs, as a share of upkeep', min: 0, max: 1, step: 0.05 },
      { key: 'seasonTempSwing', label: 'Seasonal swing', hint: 'How much hotter summer is, and colder winter', min: 0, max: 1, step: 0.05 },
      { key: 'dayTempSwing', label: 'Day and night swing', hint: 'How much hotter noon is, and colder midnight', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Fire, branches and stones',
    settings: [
      { key: 'fireChance', label: 'Lightning', hint: 'Chance each tick that lightning strikes somewhere; it starts a fire only where it is hot and there is something to burn. 0 means no fires start on their own', min: 0, max: 0.02, step: 0.0005 },
      { key: 'fireSpread', label: 'Fire spread', hint: 'Chance each tick that fire catches in a neighbouring cell full of plants; 0 keeps every fire to one cell', min: 0, max: 0.1, step: 0.005 },
      { key: 'fireDamage', label: 'Fire strength', hint: 'Health a creature loses each tick it stands in fire; 0 makes fire harmless', min: 0, max: 0.2, step: 0.005 },
      { key: 'fireWarmth', label: 'Warmth of fire', hint: 'How much a fire warms the land around it', min: 0, max: 2, step: 0.1 },
      { key: 'fireMinHeat', label: 'Heat needed for lightning fires', hint: 'Lightning only starts a fire where it is at least this hot at that moment', min: -1, max: 1.5, step: 0.05 },
      { key: 'ashGrowth', label: 'Richness of ash', hint: 'How many times faster plants regrow on fresh ash', min: 0, max: 6, step: 0.5 },
      { key: 'branchRegrowTicks', label: 'Branch fall (ticks)', hint: 'Ticks for each forest cell to get about one chance at a new branch; 0 stops branches falling', min: 0, max: 20000, step: 500 },
    ],
  },
  {
    title: 'Cost of living',
    settings: [
      { key: 'upkeepCost', label: 'Upkeep', hint: 'Energy a body burns each tick just staying alive', min: 0.02, max: 0.4, step: 0.01 },
      { key: 'moveCost', label: 'Movement cost', hint: 'Energy burned per distance moved', min: 0, max: 0.2, step: 0.005 },
      { key: 'senseCost', label: 'Cost of sight', hint: 'Energy per tick for vision, growing with how far a creature sees', min: 0, max: 0.05, step: 0.002 },
      { key: 'brainLinkCost', label: 'Cost per brain link', hint: 'Energy per tick for each link; higher keeps brains small', min: 0, max: 0.005, step: 0.0001 },
      { key: 'maxAge', label: 'Lifespan (ticks)', hint: 'Creatures die of old age at this many ticks', min: 500, max: 20000, step: 500 },
    ],
  },
  {
    title: 'Hunting',
    settings: [
      { key: 'attackDamage', label: 'Bite strength', hint: 'Health a full meat-eater takes per bite from a same-size victim; 0 turns fighting off', min: 0, max: 1, step: 0.01 },
      { key: 'camouflage', label: 'Camouflage', hint: 'How much shorter the distance a creature can be seen from when it is the colour of the ground under it; 0 turns it off', min: 0, max: 0.95, step: 0.05 },
      { key: 'defenseDamage', label: 'Defenses bite back', hint: 'Health a biter loses per bite on a fully defended victim of its own size; 0 turns defenses off', min: 0, max: 1, step: 0.05 },
      { key: 'defenseCost', label: 'Cost of defenses', hint: 'Energy full defenses cost, as a share of upkeep', min: 0, max: 1, step: 0.05 },
      { key: 'woundSlow', label: 'Wounds slow the victim', hint: 'How much a wounded creature is slowed; 0 is not at all', min: 0, max: 0.9, step: 0.05 },
      { key: 'attackReach', label: 'Bite reach', hint: 'How close an attacker must be for a bite to land', min: 1, max: 15, step: 1 },
      { key: 'bodyEnergy', label: 'Meat in a body', hint: 'Energy a body of size 1 leaves as meat when it dies', min: 5, max: 60, step: 1 },
      { key: 'meatDecayRate', label: 'Meat rot speed', hint: 'Share of meat that rots away each tick', min: 0, max: 0.005, step: 0.0001 },
    ],
  },
  {
    title: 'Reproduction and mutation',
    settings: [
      { key: 'reproduceThreshold', label: 'Energy needed to breed', hint: 'A creature can split once its store is this full', min: 0.3, max: 0.95, step: 0.05 },
      { key: 'minReproduceAge', label: 'Youngest breeding age', hint: 'Ticks a creature must live before it can split', min: 0, max: 1500, step: 50 },
      { key: 'initialMutationRate', label: 'Starting mutation rate', hint: 'How much founders’ children differ from them; the rate itself then evolves', min: 0.01, max: 0.3, step: 0.01 },
      { key: 'addLinkChance', label: 'Chance of a new brain link', hint: 'Per birth; higher makes brains change faster', min: 0, max: 0.5, step: 0.01 },
      { key: 'addNeuronChance', label: 'Chance of a new neuron', hint: 'Per birth', min: 0, max: 0.2, step: 0.005 },
      { key: 'maxCreatures', label: 'Population cap', hint: 'No births happen while the population is this large', min: 200, max: 10000, step: 100 },
    ],
  },
  {
    title: 'Disease and events',
    settings: [
      { key: 'plagueTransmission', label: 'Plague spread chance', hint: 'Chance per tick that a sick creature infects each healthy one nearby', min: 0, max: 0.2, step: 0.005 },
      { key: 'plagueDeathChance', label: 'Plague death chance', hint: 'Chance per tick that a sick creature dies', min: 0, max: 0.01, step: 0.0002 },
      { key: 'meteorRadius', label: 'Meteor size', hint: 'Radius of the blast', min: 50, max: 900, step: 25 },
      { key: 'randomEventInterval', label: 'Random event gap (ticks)', hint: 'Average ticks between random events when they are switched on', min: 1000, max: 100000, step: 1000 },
    ],
  },
  {
    title: 'World (applies on restart)',
    settings: [
      { key: 'initialCreatures', label: 'Starting creatures', hint: 'How many founders the world begins with', min: 20, max: 3000, step: 20 },
      { key: 'worldWidth', label: 'World width', hint: 'Width of the world', min: 600, max: 6000, step: 200 },
      { key: 'worldHeight', label: 'World height', hint: 'Height of the world', min: 600, max: 6000, step: 200 },
      { key: 'fertilityFloor', label: 'Barren land', hint: 'Higher leaves more of the map barren', min: 0, max: 0.7, step: 0.05 },
      { key: 'biomeSize', label: 'Biome size', hint: 'Rough width of each hot or cold region, in world units', min: 300, max: 3000, step: 100 },
      { key: 'waterShare', label: 'Water', hint: 'Share of the map that is lake or river; 0 means no water and no thirst', min: 0, max: 0.4, step: 0.01 },
    ],
  },
];

export interface Preset {
  id: string;
  label: string;
  description: string;
  overrides: Partial<SimConfig>;
}

export const PRESETS: Preset[] = [
  {
    id: 'default',
    label: 'Balanced',
    description: 'The tuned defaults: five biomes on a 4,000 by 4,000 map, with grazers, scavengers and some hunters.',
    overrides: {},
  },
  {
    id: 'garden',
    label: 'Peaceful garden',
    description: 'Rich land, mild seasons and no biting. Good for watching foraging evolve.',
    overrides: { plantCapacity: 36, seasonStrength: 0.15, attackDamage: 0, founderDietMax: 0.2 },
  },
  {
    id: 'hunters',
    label: 'Hunting grounds',
    description: 'Strong bites and meat-rich bodies, so hunters take hold quickly.',
    overrides: { attackDamage: 0.8, bodyEnergy: 30, meatDecayRate: 0.0003, plantCapacity: 30 },
  },
  {
    id: 'harsh',
    label: 'Harsh seasons',
    description: 'Poor land, long hard winters and land that shifts quickly.',
    overrides: { plantCapacity: 16, seasonStrength: 0.8, seasonLength: 9000, fertilityDriftPeriod: 30000 },
  },
  {
    id: 'dry',
    label: 'Dry land',
    description: 'No lakes or river, so no thirst. The world as it was before water.',
    overrides: { waterShare: 0 },
  },
  {
    id: 'wetlands',
    label: 'Wetlands',
    description: 'Nearly a third of the map is water, with rich land along every shore.',
    overrides: { waterShare: 0.3, moistureBoost: 0.7 },
  },
  {
    id: 'dark',
    label: 'Long dark nights',
    description: 'Days twice as long, and creatures see only a fifth as far at midnight.',
    overrides: { dayLength: 1200, nightVision: 0.2 },
  },
  {
    id: 'chaos',
    label: 'Chaos',
    description: 'Random droughts, plagues, meteors and walls every few thousand ticks.',
    overrides: { randomEvents: true, randomEventInterval: 4000 },
  },
  {
    id: 'small',
    label: 'Small world',
    description: 'The 2,000 by 2,000 map of earlier versions: a quarter of the area, so it runs faster.',
    overrides: { worldWidth: 2000, worldHeight: 2000, initialCreatures: 400, maxCreatures: 5000, biomeSize: 700 },
  },
  {
    id: 'continents',
    label: 'Continents',
    description: 'A few very large biomes, so populations live far apart.',
    overrides: { biomeSize: 2000 },
  },
  {
    id: 'iceAgeWorld',
    label: 'Ice age world',
    description: 'A cold planet: mostly tundra, with mild land only where it would otherwise be hot.',
    overrides: { climateShift: -0.5 },
  },
  {
    id: 'oases',
    label: 'Desert with oases',
    description: 'A hot, dry planet: mostly desert, with life gathered around the water.',
    overrides: { climateShift: 0.45, biomeWetThreshold: 0.7, waterShare: 0.1 },
  },
  {
    id: 'noBiomes',
    label: 'No biomes',
    description: 'Temperature off: one kind of land everywhere, as before biomes.',
    overrides: { temperatureStrength: 0 },
  },
  {
    id: 'big',
    label: 'Huge world',
    description: 'A 6,000 by 6,000 map. Slow, but room for many separate populations.',
    overrides: { worldWidth: 6000, worldHeight: 6000, initialCreatures: 2700, maxCreatures: 10000 },
  },
];

/** A full config for a preset, keeping the given seed. */
export function presetConfig(preset: Preset, seed: string): SimConfig {
  return { ...defaultConfig, ...preset.overrides, seed };
}
