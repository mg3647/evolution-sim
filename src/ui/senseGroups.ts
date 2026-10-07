import { Input, INPUT_COUNT, INPUTS_PER_RAY, Ray, RAY_COUNT } from '../sim/brain';

/** The kinds of thing a creature senses, for showing its inputs in groups. */
export const SENSE_GROUPS = ['Vision', 'Social', 'Body', 'Climate', 'Items'] as const;
export type SenseGroup = (typeof SENSE_GROUPS)[number];

export const SENSE_GROUP_HINTS: Record<SenseGroup, string> = {
  Vision: 'The ground along its three rays and underfoot, and how near the creature on each ray is',
  Social: 'What it can tell about other creatures: kin, size, diet, colour, scent and calls',
  Body: 'Its own state: energy, health, thirst, age, pain and sickness',
  Climate: 'Season, daylight, temperature, water and fire',
  Items: 'Stones, branches and stored food, on the ground and in its grip',
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
  [Ray.Fire]: 'Climate',
  [Ray.Items]: 'Items',
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
  [Input.Bias]: 'Body',
};

/** The group an input belongs to. */
export function senseGroup(input: number): SenseGroup {
  if (input < RAY_COUNT * INPUTS_PER_RAY) return RAY_GROUPS[input % INPUTS_PER_RAY] ?? 'Vision';
  return OTHER_GROUPS[input] ?? 'Body';
}

/** Every input's group, by input number. */
export const INPUT_GROUPS: SenseGroup[] = Array.from({ length: INPUT_COUNT }, (_, input) => senseGroup(input));
