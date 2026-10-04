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
      { key: 'fertilityDriftPeriod', label: 'Land drift (ticks)', hint: 'Ticks for rich and barren land to move to entirely new places; 0 keeps it fixed', min: 0, max: 300000, step: 10000 },
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
      { key: 'attackDamage', label: 'Bite strength', hint: 'Health a full meat-eater takes per bite from a same-size victim; 0 turns fighting off', min: 0, max: 0.6, step: 0.01 },
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
    description: 'The tuned defaults: grazers, scavengers and some hunters.',
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
    overrides: { attackDamage: 0.4, bodyEnergy: 30, meatDecayRate: 0.0003, plantCapacity: 30 },
  },
  {
    id: 'harsh',
    label: 'Harsh seasons',
    description: 'Poor land, long hard winters and land that shifts quickly.',
    overrides: { plantCapacity: 16, seasonStrength: 0.8, seasonLength: 9000, fertilityDriftPeriod: 30000 },
  },
  {
    id: 'chaos',
    label: 'Chaos',
    description: 'Random droughts, plagues, meteors and walls every few thousand ticks.',
    overrides: { randomEvents: true, randomEventInterval: 4000 },
  },
  {
    id: 'big',
    label: 'Big world',
    description: 'Four times the area and creatures. Slower, but room for separate populations.',
    overrides: { worldWidth: 4000, worldHeight: 4000, initialCreatures: 1600, maxCreatures: 10000 },
  },
];

/** A full config for a preset, keeping the given seed. */
export function presetConfig(preset: Preset, seed: string): SimConfig {
  return { ...defaultConfig, ...preset.overrides, seed };
}
