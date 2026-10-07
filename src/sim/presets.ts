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
  'blockDensity',
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
  /** One line saying what the setting is. Shown when the pointer rests on it and in its explainer. */
  hint: string;
  /** What happens when it is raised or lowered, for the explainer. */
  more?: string;
  min: number;
  max: number;
  step: number;
}

export interface SettingGroup {
  title: string;
  /** One line saying what the group is about. */
  about: string;
  settings: SettingInfo[];
}

/** What kind of difference a key setting makes. */
export type KeyTag = 'Speed' | 'Outcome' | 'Pace' | 'Nature';
export const KEY_TAG_HINTS: Record<KeyTag, string> = {
  Speed: 'Changes how fast the simulation runs on your computer',
  Outcome: 'Changes who survives and what evolves',
  Pace: 'Changes how quickly things happen and change',
  Nature: 'Changes the character of the world itself',
};

/** The few settings that matter most, each with the kind of difference it makes and why. */
export const KEY_SETTINGS: Partial<Record<keyof SimConfig, { tag: KeyTag; why: string }>> = {
  worldWidth: { tag: 'Speed', why: 'A bigger map holds more creatures, and the simulation slows with their number.' },
  worldHeight: { tag: 'Speed', why: 'A bigger map holds more creatures, and the simulation slows with their number.' },
  plantCapacity: { tag: 'Speed', why: 'More food means more creatures, which is the main thing that slows the simulation.' },
  attackDamage: { tag: 'Outcome', why: 'Decides whether hunting pays, and so whether meat-eaters exist at all.' },
  attackReach: { tag: 'Outcome', why: 'A longer reach lets hunters land bites on prey that would otherwise slip away.' },
  woundSlow: { tag: 'Outcome', why: 'Lets a hunter that has bitten once catch its prey again; without it prey simply outrun hunters.' },
  thirstRate: { tag: 'Outcome', why: 'Decides how far from water creatures can live, and so how much of the map is used.' },
  birthCost: { tag: 'Outcome', why: 'Makes each birth dearer, which shifts the balance between many short lives and fewer long ones.' },
  birthWaterShare: { tag: 'Outcome', why: 'Any sharing leaves newborns dry; in testing it collapsed the population unless water was easy to reach.' },
  speciesThreshold: { tag: 'Outcome', why: 'Changes how many species every chart and list reports, without changing how creatures live.' },
  speciesMinMembers: { tag: 'Outcome', why: 'Changes how many species every chart and list reports, without changing how creatures live.' },
  plantGrowthRate: { tag: 'Pace', why: 'Faster regrowth lets populations recover sooner and stay put; slower forces them to keep moving.' },
  initialMutationRate: { tag: 'Pace', why: 'Sets how fast bodies and brains change at the start; the rate then evolves on its own.' },
  seasonLength: { tag: 'Pace', why: 'A shorter year means booms and crashes come round more often.' },
  temperatureStrength: { tag: 'Nature', why: 'At 0 there are no biomes at all; higher makes deserts and tundra harsher.' },
  seasonStrength: { tag: 'Nature', why: 'Decides whether the year is steady or swings between plenty and famine.' },
  fireChance: { tag: 'Nature', why: 'Decides how often wildfires start.' },
  fireSpread: { tag: 'Nature', why: 'Decides whether fires burn out in patches or run across whole forests.' },
};

export const SETTING_GROUPS: SettingGroup[] = [
  {
    title: 'The map',
    about: 'The size and shape of the world. These apply the next time you press Restart.',
    settings: [
      { key: 'worldWidth', label: 'World width', hint: 'Width of the world, in world units', more: 'A bigger world holds more creatures and gives populations room to live apart, but runs slower.', min: 600, max: 6000, step: 200 },
      { key: 'worldHeight', label: 'World height', hint: 'Height of the world, in world units', min: 600, max: 6000, step: 200 },
      { key: 'initialCreatures', label: 'Starting creatures', hint: 'How many parentless creatures the world begins with', more: 'The population soon settles to what the food supports, so this mostly sets how varied the starting families are.', min: 20, max: 3000, step: 20 },
      { key: 'waterShare', label: 'Water', hint: 'Share of the map that is lake or river; 0 means no water and no thirst', more: 'More water means less land to feed on, but more rich land along its shores.', min: 0, max: 0.4, step: 0.01 },
      { key: 'biomeSize', label: 'Biome size', hint: 'Rough width of each hot or cold region, in world units', more: 'Bigger biomes keep populations apart for longer, which helps them become different species.', min: 300, max: 3000, step: 100 },
      { key: 'fertilityFloor', label: 'Barren land', hint: 'How much of the map grows nothing at all', more: 'Higher leaves more bare ground between patches of food.', min: 0, max: 0.7, step: 0.05 },
    ],
  },
  {
    title: 'Climate and biomes',
    about: 'Heat and cold, the seasons, day and night, and which biomes they make.',
    settings: [
      { key: 'temperatureStrength', label: 'Temperature strength', hint: 'How far hot and cold places, seasons and nights differ; 0 turns temperature and biomes off', more: 'At 0 the whole map is plain grassland and nothing is ever too hot or cold. Higher makes deserts hotter and tundra colder.', min: 0, max: 2, step: 0.1 },
      { key: 'climateShift', label: 'Warmer or colder world', hint: 'Makes everywhere colder (below zero) or hotter (above zero)', more: 'Below zero turns more land to tundra; above turns more to desert and rainforest.', min: -1, max: 1, step: 0.05 },
      { key: 'biomeTempThreshold', label: 'Mild land', hint: 'How far from mild a place must be to count as hot or cold', more: 'Higher leaves more of the map as grassland and forest; lower gives more desert, rainforest and tundra.', min: 0.05, max: 0.95, step: 0.05 },
      { key: 'biomeWetThreshold', label: 'Open land', hint: 'How wet soil must be to grow forest instead of grassland', more: 'Higher leaves more grassland and desert; lower gives more forest and rainforest.', min: 0.05, max: 0.95, step: 0.05 },
      { key: 'seasonLength', label: 'Year length (ticks)', hint: 'Ticks in one full cycle of seasons', min: 1000, max: 30000, step: 500 },
      { key: 'seasonStrength', label: 'Season strength', hint: 'How much plant growth swings between summer and winter; 0 is no seasons', more: 'At 0.9 winters are near-dark and summers bright, so populations boom and crash each year.', min: 0, max: 0.9, step: 0.05 },
      { key: 'seasonTempSwing', label: 'Seasonal swing', hint: 'How much hotter summer is, and colder winter', min: 0, max: 1, step: 0.05 },
      { key: 'dayLength', label: 'Day length (ticks)', hint: 'Ticks in one day and night; 0 turns night off', min: 0, max: 3000, step: 50 },
      { key: 'dayTempSwing', label: 'Day and night swing', hint: 'How much hotter noon is, and colder midnight', more: 'Deserts swing three times as far as this.', min: 0, max: 1, step: 0.05 },
      { key: 'nightVision', label: 'Sight at night', hint: 'How far creatures see at midnight, as a share of how far they see at noon', min: 0.1, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Plants and food',
    about: 'How much there is to eat, how fast it comes back, and how long it keeps.',
    settings: [
      { key: 'plantCapacity', label: 'Plant richness', hint: 'How much food the best land can hold', more: 'Higher feeds a larger population. It is the main control on how many creatures there are.', min: 4, max: 60, step: 1 },
      { key: 'plantGrowthRate', label: 'Plant growth speed', hint: 'How fast eaten plants grow back', more: 'Higher lets creatures graze the same spot again sooner, so they need to travel less.', min: 0.001, max: 0.03, step: 0.001 },
      { key: 'moistureBoost', label: 'Richer land by water', hint: 'Extra fertility at the water’s edge, fading with distance', min: 0, max: 1, step: 0.05 },
      { key: 'fertilityDriftPeriod', label: 'Land drift (ticks)', hint: 'Ticks for rich and barren land to move to entirely new places; 0 keeps it fixed', more: 'Shorter forces populations to keep moving and re-adapting.', min: 0, max: 300000, step: 10000 },
      { key: 'bodyEnergy', label: 'Meat in a body', hint: 'Energy a body of size 1 leaves as meat when it dies', more: 'Higher makes hunting and scavenging pay better, but also makes each child cost more to build.', min: 5, max: 60, step: 1 },
      { key: 'meatDecayRate', label: 'Meat rot speed', hint: 'Share of meat that rots away each tick', more: 'Lower leaves bodies lying around for longer, which favours scavengers.', min: 0, max: 0.005, step: 0.0001 },
      { key: 'storeDecay', label: 'Stored food spoils', hint: 'Share of plant food set down by creatures that spoils each tick', min: 0, max: 0.001, step: 0.00001 },
    ],
  },
  {
    title: 'Water and thirst',
    about: 'How badly creatures need water and what it is like to be in it.',
    settings: [
      { key: 'thirstRate', label: 'Thirst', hint: 'Share of its water a creature loses each tick', more: 'At 0.0004 a creature lasts about 2,500 ticks without a drink. Higher ties creatures closer to water.', min: 0, max: 0.005, step: 0.0001 },
      { key: 'drinkRate', label: 'Drinking speed', hint: 'Share of its water a creature regains each tick in or beside water', min: 0.001, max: 0.1, step: 0.001 },
      { key: 'swimSpeed', label: 'Swimming speed', hint: 'How fast creatures move in water, compared with on land', min: 0.1, max: 1, step: 0.05 },
      { key: 'swimCost', label: 'Swimming cost', hint: 'How much more energy living costs while in water', min: 1, max: 4, step: 0.1 },
    ],
  },
  {
    title: 'Cost of living',
    about: 'What a body, its senses, its brain and its coat cost in energy every tick.',
    settings: [
      { key: 'upkeepCost', label: 'Upkeep', hint: 'Energy a body burns each tick just staying alive', more: 'Higher starves creatures sooner and shrinks the population; lower lets idle creatures linger.', min: 0.02, max: 0.4, step: 0.01 },
      { key: 'moveCost', label: 'Movement cost', hint: 'Energy burned per distance moved', more: 'Higher favours slow bodies that sit and graze; lower favours fast roamers.', min: 0, max: 0.2, step: 0.005 },
      { key: 'senseCost', label: 'Cost of sight', hint: 'Energy per tick for vision, growing with how far a creature sees', min: 0, max: 0.05, step: 0.002 },
      { key: 'brainLinkCost', label: 'Cost per brain link', hint: 'Energy per tick for each link in a brain', more: 'Higher keeps brains small and simple; lower lets wiring pile up.', min: 0, max: 0.005, step: 0.0001 },
      { key: 'temperatureCost', label: 'Cost of heat and cold', hint: 'Extra energy a creature burns when too hot or too cold, as a multiple of its upkeep', more: 'Higher makes deserts and tundra harder to live in without the right body.', min: 0, max: 5, step: 0.1 },
      { key: 'comfortBand', label: 'Comfort range', hint: 'How far from mild a plain creature can be before the temperature costs it anything', min: 0, max: 1, step: 0.05 },
      { key: 'exertionHeat', label: 'Heat of moving', hint: 'How much hotter moving flat out makes a creature feel', more: 'Higher makes resting through the heat of the day pay, and moving a way to keep warm.', min: 0, max: 1, step: 0.05 },
      { key: 'furWarmth', label: 'Warmth of fur', hint: 'How much cold a full coat keeps out', min: 0, max: 1.5, step: 0.05 },
      { key: 'furCost', label: 'Cost of fur', hint: 'Energy a full coat costs, as a share of upkeep', min: 0, max: 1, step: 0.05 },
      { key: 'defenseCost', label: 'Cost of defenses', hint: 'Energy full spines or poison cost, as a share of upkeep', min: 0, max: 1, step: 0.05 },
    ],
  },
  {
    title: 'Life and breeding',
    about: 'How long creatures live, when they can have young, and what a child costs.',
    settings: [
      { key: 'maxAge', label: 'Lifespan (ticks)', hint: 'Every creature dies of old age at this many ticks', more: 'Longer lives mean fewer generations per hour, so evolution runs slower. It is the same for all creatures and does not evolve.', min: 500, max: 20000, step: 500 },
      { key: 'minReproduceAge', label: 'Youngest breeding age', hint: 'Ticks a creature must live before it can have young', more: 'Higher makes a childhood: a newborn must survive that long on its own before it can pass anything on.', min: 0, max: 1500, step: 50 },
      { key: 'reproduceThreshold', label: 'Energy needed to breed', hint: 'How full its energy store must be before a creature can have a child', more: 'Higher makes creatures save up for longer between births.', min: 0.3, max: 0.95, step: 0.05 },
      { key: 'offspringShare', label: 'Share given to a child', hint: 'Share of its energy a parent hands over at a birth', more: 'Part of it builds the child’s body; the rest is the child’s starting store. Higher gives fewer, better-fed young.', min: 0.1, max: 0.9, step: 0.05 },
      { key: 'birthCost', label: 'Cost of a birth', hint: 'Share of the energy handed to a child that is lost as heat', more: 'At 0, breeding wastes nothing. Higher makes each birth dearer, so the same food supports fewer creatures. In testing it slowed breeding only a little.', min: 0, max: 0.8, step: 0.05 },
      { key: 'birthWaterShare', label: 'Water given to a child', hint: 'Share of the water in its body a parent hands to its child at a birth; 0 gives the child its parent’s level for free', more: 'In testing, any sharing at all, even 0.1, left newborns too dry to reach water and the population collapsed. Try it with a low Thirst setting or a wet map.', min: 0, max: 0.5, step: 0.05 },
      { key: 'maxCreatures', label: 'Population cap', hint: 'No births happen while the population is this large', more: 'A safety limit for speed. A world sitting at the cap is not being limited by food.', min: 200, max: 10000, step: 100 },
    ],
  },
  {
    title: 'Mutation and brains',
    about: 'How much children differ from their parents, in body and in wiring.',
    settings: [
      { key: 'initialMutationRate', label: 'Starting mutation rate', hint: 'How much the first creatures’ children differ from them', more: 'The rate is itself inherited and evolves, so this only sets where it starts.', min: 0.01, max: 0.3, step: 0.01 },
      { key: 'addLinkChance', label: 'Chance of a new brain link', hint: 'Chance, at each birth, that the child’s brain gains a link', more: 'Higher makes behaviour change faster, and brains grow unless links are costly.', min: 0, max: 0.5, step: 0.01 },
      { key: 'addNeuronChance', label: 'Chance of a new neuron', hint: 'Chance, at each birth, that the child’s brain gains a hidden neuron', min: 0, max: 0.2, step: 0.005 },
      { key: 'tauChangeChance', label: 'Chance a neuron gets slower or faster', hint: 'Chance, at each birth, that each hidden neuron’s time constant shifts', more: 'A neuron with a time constant of 1 follows its inputs at once. A larger one changes slowly, so it can hold a state for many ticks: a mood, a plan, or a count.', min: 0, max: 0.5, step: 0.01 },
      { key: 'maxNeuronTau', label: 'Slowest neuron (ticks)', hint: 'The longest time constant a hidden neuron can evolve', min: 1, max: 100, step: 1 },
    ],
  },
  {
    title: 'Species',
    about: 'How creatures are sorted into species. These change what the charts and lists count, not how creatures live.',
    settings: [
      { key: 'speciesThreshold', label: 'Species difference', hint: 'How different a branch of the family tree must be from the group it split from to count as its own species', more: '1 is a clear difference, such as 0.15 in diet or 20% in size. Lower counts more, smaller species; higher lumps them together.', min: 0.5, max: 6, step: 0.25 },
      { key: 'speciesMinMembers', label: 'Species minimum members', hint: 'Fewest creatures a species, and the group it leaves behind, may have', more: 'Higher ignores small splinter groups, so the species list is shorter and steadier.', min: 2, max: 60, step: 1 },
      { key: 'speciesMinAge', label: 'Species minimum age (ticks)', hint: 'How long ago a branch must have split off before it can be its own species', min: 0, max: 30000, step: 500 },
    ],
  },
  {
    title: 'Hunting and defence',
    about: 'Biting, hiding, and fighting back.',
    settings: [
      { key: 'attackDamage', label: 'Bite strength', hint: 'Health a full meat-eater takes per bite from a victim of its own size; 0 turns fighting off', more: 'Higher makes hunting easier, so more meat-eaters. Too high and prey cannot react before they die.', min: 0, max: 1, step: 0.01 },
      { key: 'attackReach', label: 'Bite reach', hint: 'How close an attacker must be for a bite to land', min: 1, max: 15, step: 1 },
      { key: 'woundSlow', label: 'Wounds slow the victim', hint: 'How much a wounded creature is slowed; 0 is not at all', more: 'Higher lets a hunter that has landed one bite catch its prey again.', min: 0, max: 0.9, step: 0.05 },
      { key: 'camouflage', label: 'Camouflage', hint: 'How much less far a creature can be seen from when it is the colour of the ground under it; 0 turns it off', min: 0, max: 0.95, step: 0.05 },
      { key: 'defenseDamage', label: 'Defenses bite back', hint: 'Health a biter loses per bite on a fully defended victim of its own size; 0 turns defenses off', min: 0, max: 1, step: 0.05 },
      { key: 'stoneBite', label: 'Stone in the grip', hint: 'How much harder a creature holding a stone bites; 0 makes stones useless', min: 0, max: 2, step: 0.1 },
      { key: 'branchShield', label: 'Branch as a shield', hint: 'Share of each bite that a held branch takes instead of its holder; 0 makes branches useless', min: 0, max: 0.9, step: 0.05 },
    ],
  },
  {
    title: 'Fire, carrying and blocks',
    about: 'Wildfire, the branches that feed it, what creatures can pick up, and the blocks they can build with.',
    settings: [
      { key: 'fireChance', label: 'Lightning', hint: 'Chance each tick that lightning strikes somewhere; 0 means no fires start on their own', more: 'A strike starts a fire only where it is hot and there is something to burn.', min: 0, max: 0.02, step: 0.0005 },
      { key: 'fireSpread', label: 'Fire spread', hint: 'Chance each tick that fire catches in a neighbouring cell with enough to burn', more: 'At 0 every fire stays in one cell. At 0.015 fires burn out in patches; at 0.03 each burning cell lights nearly three others and fires run across whole forests.', min: 0, max: 0.1, step: 0.005 },
      { key: 'fireDamage', label: 'Fire strength', hint: 'Health a creature loses each tick it stands in fire; 0 makes fire harmless', min: 0, max: 0.2, step: 0.005 },
      { key: 'fireWarmth', label: 'Warmth of fire', hint: 'How much a fire warms the land around it', min: 0, max: 2, step: 0.1 },
      { key: 'fireMinHeat', label: 'Heat needed for lightning fires', hint: 'Lightning only starts a fire where it is at least this hot at that moment', min: -1, max: 1.5, step: 0.05 },
      { key: 'ashGrowth', label: 'Richness of ash', hint: 'How many times faster plants regrow on fresh ash', min: 0, max: 6, step: 0.5 },
      { key: 'branchRegrowTicks', label: 'Branch fall (ticks)', hint: 'Ticks for each forest cell to get about one chance at a new branch; 0 stops branches falling', min: 0, max: 20000, step: 500 },
      { key: 'shelter', label: 'Shelter of a block', hint: 'How much a block shelters what is in or beside its cell: the share cut from the cost of heat and cold there, and from how fast stored food spoils', more: 'At 0 a block is only an obstacle. Higher gives creatures a reason to stay by blocks, and to bring blocks to where they live.', min: 0, max: 0.95, step: 0.05 },
      { key: 'blockWeight', label: 'Weight of a block', hint: 'Share of its speed a creature loses while it carries a block', min: 0, max: 0.9, step: 0.05 },
      { key: 'blockDensity', label: 'Blocks', hint: 'Share of land cells that start with a block on them; desert and tundra get more', more: 'Blocks stop movement like walls, but creatures can push them, pick them up and set them down.', min: 0, max: 0.08, step: 0.005 },
      { key: 'carrySlow', label: 'Weight of a load', hint: 'Share of its speed a creature loses while it holds anything', more: 'Lower makes carrying cheaper, so more creatures keep hold of things.', min: 0, max: 0.6, step: 0.05 },
      { key: 'carryMouthfuls', label: 'Size of a load of food', hint: 'How much food a creature picks up at once, in mouthfuls', min: 1, max: 30, step: 1 },
    ],
  },
  {
    title: 'Disease and events',
    about: 'Plague, meteors and how often events strike on their own.',
    settings: [
      { key: 'plagueTransmission', label: 'Plague spread chance', hint: 'Chance per tick that a sick creature infects each healthy one nearby', min: 0, max: 0.2, step: 0.005 },
      { key: 'plagueDeathChance', label: 'Plague death chance', hint: 'Chance per tick that a sick creature dies', min: 0, max: 0.01, step: 0.0002 },
      { key: 'meteorRadius', label: 'Meteor size', hint: 'Radius of the blast, in world units', min: 50, max: 900, step: 25 },
      { key: 'randomEventInterval', label: 'Random event gap (ticks)', hint: 'Average ticks between random events when they are switched on', min: 1000, max: 100000, step: 1000 },
    ],
  },
];

/** The Wildfire switch: how often lightning strikes and how readily fire spreads. */
export const WILDFIRE_LEVELS = [
  {
    id: 'off',
    label: 'Off',
    hint: 'No lightning, so no fire starts on its own. The Fire tool still works',
    fireChance: 0,
    fireSpread: 0.015,
  },
  {
    id: 'rare',
    label: 'Rare',
    hint: 'Few lightning fires, and they spread slowly enough to burn out in patches',
    fireChance: 0.002,
    fireSpread: 0.015,
  },
  {
    id: 'natural',
    label: 'Natural',
    hint: 'More lightning and fire that spreads twice as readily: big fires that cross whole forests',
    fireChance: 0.005,
    fireSpread: 0.03,
  },
] as const;

/** The level the settings are at, or null if the fire sliders have been set to something else. */
export function wildfireLevel(config: SimConfig): (typeof WILDFIRE_LEVELS)[number]['id'] | null {
  if (config.fireChance === 0) return 'off';
  for (const level of WILDFIRE_LEVELS) {
    if (config.fireChance === level.fireChance && config.fireSpread === level.fireSpread) return level.id;
  }
  return null;
}

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
    id: 'longLives',
    label: 'Long lives',
    description: 'Creatures live 10,000 ticks instead of 5,000: easier to watch one carry and haul, but evolution runs at half the pace.',
    overrides: { maxAge: 10000 },
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
