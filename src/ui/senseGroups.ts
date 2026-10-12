import { Input, INPUT_COUNT, INPUTS_PER_RAY, Ray, RAY_COUNT } from '../sim/brain';

/** The kinds of thing a creature senses, for showing its inputs in groups. */
export const SENSE_GROUPS = ['Vision', 'Social', 'Body', 'Climate', 'Items'] as const;
export type SenseGroup = (typeof SENSE_GROUPS)[number];

export const SENSE_GROUP_HINTS: Record<SenseGroup, string> = {
  Vision: 'The ground along its three rays and underfoot, and how near the creature on each ray is',
  Social: 'What it can tell about other creatures: kin, size, diet, colour, displays, scent and calls',
  Body: 'Its own state: energy and whether it is rising, health, thirst, age, pain and sickness',
  Climate: 'Season, daylight, temperature and where it is warmer, shelter, water and fire',
  Items: 'Stones, branches, blocks and stored food, on the ground and in its grip',
};

/** What each ray reports, by its place within the ray's block of inputs. */
const RAY_GROUPS: Record<number, SenseGroup> = {
  [Ray.Plants]: 'Vision',
  [Ray.Meat]: 'Vision',
  [Ray.Water]: 'Vision',
  [Ray.Wall]: 'Vision',
  [Ray.Near]: 'Vision',
  [Ray.Kin]: 'Social',
  [Ray.Bigger]: 'Social',
  [Ray.MeatEater]: 'Social',
  [Ray.Approaching]: 'Social',
  [Ray.Hurt]: 'Social',
  [Ray.ColourWarm]: 'Social',
  [Ray.ColourGreen]: 'Social',
  [Ray.Display]: 'Social',
  [Ray.Sick]: 'Social',
  [Ray.Store]: 'Items',
  [Ray.Fire]: 'Climate',
  [Ray.Items]: 'Items',
  [Ray.Block]: 'Items',
};

const OTHER_GROUPS: Record<number, SenseGroup> = {
  [Input.Behind]: 'Social',
  [Input.Crowding]: 'Social',
  [Input.Underfoot]: 'Vision',
  [Input.MeatUnderfoot]: 'Vision',
  [Input.InWater]: 'Climate',
  [Input.ScentUnderfoot]: 'Social',
  [Input.ScentSide]: 'Social',
  [Input.HearLeft]: 'Social',
  [Input.HearRight]: 'Social',
  [Input.Energy]: 'Body',
  [Input.Health]: 'Body',
  [Input.Thirst]: 'Body',
  [Input.Age]: 'Body',
  [Input.Pain]: 'Body',
  [Input.Sick]: 'Body',
  [Input.Clock]: 'Body',
  [Input.Season]: 'Climate',
  [Input.Daylight]: 'Climate',
  [Input.Temperature]: 'Climate',
  [Input.WarmerAhead]: 'Climate',
  [Input.ItemUnderfoot]: 'Items',
  [Input.StoreUnderfoot]: 'Items',
  [Input.HoldingTool]: 'Items',
  [Input.HoldingFood]: 'Items',
  [Input.HoldingBlock]: 'Items',
  [Input.EnergyTrend]: 'Body',
  [Input.BehindSide]: 'Social',
  [Input.BehindMeatEater]: 'Social',
  [Input.WarmerSide]: 'Climate',
  [Input.Facing]: 'Items',
  [Input.Sheltered]: 'Climate',
  [Input.Bias]: 'Body',
};

/** The group an input belongs to. */
export function senseGroup(input: number): SenseGroup {
  if (input < RAY_COUNT * INPUTS_PER_RAY) return RAY_GROUPS[input % INPUTS_PER_RAY] ?? 'Vision';
  return OTHER_GROUPS[input] ?? 'Body';
}

/** Every input's group, by input number. */
export const INPUT_GROUPS: SenseGroup[] = Array.from({ length: INPUT_COUNT }, (_, input) => senseGroup(input));

/**
 * Two-way senses read above zero for one thing and below for another, such as
 * a stone (above) or a branch (below). These are the names of the two sides,
 * so the screen can say which one is meant instead of "Stone or branch".
 */
const RAY_SIDES: Partial<Record<number, [string, string]>> = {
  [Ray.Kin]: ['Kin', 'Unlike'],
  [Ray.Bigger]: ['Bigger', 'Smaller'],
  [Ray.MeatEater]: ['Meat-eater', 'Plant-eater'],
  [Ray.Approaching]: ['Coming', 'Going away'],
  [Ray.ColourWarm]: ['Red', 'Cyan'],
  [Ray.ColourGreen]: ['Green', 'Violet'],
  [Ray.Items]: ['Stone', 'Branch'],
  [Ray.Block]: ['Light block', 'Heavy block'],
};
const RAY_SIDE_WORDS = ['left', 'ahead', 'right'];

const OTHER_SIDES: Partial<Record<number, [string, string]>> = {
  [Input.ScentSide]: ['Scent to the right', 'Scent to the left'],
  [Input.Season]: ['Summer', 'Winter'],
  [Input.Temperature]: ['Hot', 'Cold'],
  [Input.WarmerAhead]: ['Warmer ahead', 'Colder ahead'],
  [Input.ItemUnderfoot]: ['Stone underfoot', 'Branch underfoot'],
  [Input.HoldingTool]: ['Holding a stone', 'Holding a branch'],
  [Input.EnergyTrend]: ['Energy rising', 'Energy falling'],
  [Input.BehindSide]: ['Creature behind on the right', 'Creature behind on the left'],
  [Input.BehindMeatEater]: ['Meat-eater behind', 'Plant-eater behind'],
  [Input.WarmerSide]: ['Warmer to the right', 'Warmer to the left'],
  [Input.Facing]: ['Light block in front', 'Heavy block in front'],
};

/** The names of a two-way sense's sides, [above zero, below zero], or null for a one-way sense. */
export function senseSides(input: number): [string, string] | null {
  if (input < RAY_COUNT * INPUTS_PER_RAY) {
    const sides = RAY_SIDES[input % INPUTS_PER_RAY];
    if (!sides) return null;
    const ray = RAY_SIDE_WORDS[Math.floor(input / INPUTS_PER_RAY)]!;
    return [`${sides[0]} ${ray}`, `${sides[1]} ${ray}`];
  }
  return OTHER_SIDES[input] ?? null;
}

/** What a sense is reading right now, naming the side for a two-way one: "Branch ahead", not "Stone or branch ahead". */
export function senseNow(input: number, value: number, label: string): string {
  const sides = senseSides(input);
  return sides ? sides[value >= 0 ? 0 : 1] : label;
}
