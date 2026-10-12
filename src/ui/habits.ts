import { pathwayInput, pathwayOutput, type TraitName } from '../sim/associations';
import { Input, INPUT_COUNT, INPUT_LABELS, INPUTS_PER_RAY, OUTPUT_LABELS, RAY_COUNT } from '../sim/brain';
import type { ProfileGroup } from '../worker/protocol';
import { speciesName } from './speciesColors';
import { INPUT_GROUPS, SENSE_GROUPS, senseSides, type SenseGroup } from './senseGroups';

/** Words for what an action does when a habit drives it up, and when it holds it back. */
const ACTION_WORDS: [string, string][] = [
  ['turn right', 'turn left'],
  ['speed up', 'slow down'],
  ['breed', 'hold off breeding'],
  ['bite', 'hold off biting'],
  ['leave scent', 'leave less scent'],
  ['call', 'stay quiet'],
  ['give energy', 'keep its energy'],
  ['pick up', 'set down'],
  ['seek a mate', 'avoid mating'],
  ['learn faster', 'unlearn'],
  ['eat', 'stop eating'],
  ['display', 'stop displaying'],
];

/** Short column names for the actions. */
export const ACTION_SHORT = ['Turn', 'Thrust', 'Breed', 'Bite', 'Scent', 'Call', 'Give', 'Hold', 'Mate', 'Learn', 'Eat', 'Display'];

/** What an action does, given the sign of a habit's effect. */
export function actionWord(output: number, effect: number): string {
  const words = ACTION_WORDS[output] ?? [OUTPUT_LABELS[output]!, `less ${OUTPUT_LABELS[output]!}`];
  return effect >= 0 ? words[0] : words[1];
}

/**
 * "Plants ahead → speed up", or without a sign, "Plants ahead → Thrust". A
 * two-way sense is named by its upper side ("Stone ahead → speed up"), the side
 * a habit's effect is measured for; see habitOpposite for the other.
 */
export function habitLabel(pathway: number, effect?: number): string {
  const input = pathwayInput(pathway);
  const output = pathwayOutput(pathway);
  const sense = senseSides(input)?.[0] ?? INPUT_LABELS[input];
  return `${sense} → ${effect === undefined ? OUTPUT_LABELS[output] : actionWord(output, effect)}`;
}

/** For a two-way sense, what the habit does on the other side ("Branch ahead → slow down"); otherwise null. */
export function habitOpposite(pathway: number, effect: number): string | null {
  const sides = senseSides(pathwayInput(pathway));
  return sides ? `${sides[1]} → ${actionWord(pathwayOutput(pathway), -effect)}` : null;
}

/** One row of the sense-action map: a kind of sense, seen on the three rays or felt once. */
export interface SenseRow {
  label: string;
  group: SenseGroup;
  /** The inputs in the row: three for a ray sense (left, ahead, right), one otherwise. */
  inputs: number[];
}

function rayKindLabel(kind: number): string {
  // "Plants left" → "Plants seen"; every ray label ends in the side.
  return INPUT_LABELS[kind]!.replace(/ left$/, '');
}

/** Every sense, by kind, in the order of SENSE_GROUPS. The bias is left out. */
export const SENSE_ROWS: SenseRow[] = (() => {
  const rows: SenseRow[] = [];
  for (let kind = 0; kind < INPUTS_PER_RAY; kind++) {
    rows.push({
      label: rayKindLabel(kind),
      group: INPUT_GROUPS[kind]!,
      inputs: Array.from({ length: RAY_COUNT }, (_, side) => side * INPUTS_PER_RAY + kind),
    });
  }
  for (let input = RAY_COUNT * INPUTS_PER_RAY; input < INPUT_COUNT; input++) {
    if (input === Input.Bias) continue;
    rows.push({ label: INPUT_LABELS[input]!, group: INPUT_GROUPS[input]!, inputs: [input] });
  }
  return rows.sort((a, b) => SENSE_GROUPS.indexOf(a.group) - SENSE_GROUPS.indexOf(b.group));
})();

export function groupName(group: ProfileGroup): string {
  if (group.id === 'all') return 'Everyone';
  if (group.id === 'plants') return 'Plant-eaters';
  if (group.id === 'meat') return 'Meat-eaters';
  return speciesName(group.speciesId);
}

/** What the upper and lower halves of each trait are called. */
export const TRAIT_HALVES: Record<TraitName, [string, string]> = {
  size: ['Bigger', 'Smaller'],
  speed: ['Faster', 'Slower'],
  sensorRange: ['Longer sight', 'Shorter sight'],
  diet: ['More meat-eating', 'More plant-eating'],
  fur: ['Furrier', 'Less fur'],
  defense: ['Better defended', 'Less defended'],
  investment: ['Gives children more', 'Gives children less'],
  readiness: ['Waits to be fuller', 'Breeds less full'],
  mutationRate: ['Mutates more', 'Mutates less'],
  links: ['More links', 'Fewer links'],
  hiddenNeurons: ['More hidden neurons', 'Fewer hidden neurons'],
  learningLinks: ['More links that learn', 'Fewer links that learn'],
};

/** Colours for a habit's effect: drives the action up, or holds it back. */
export const DRIVES = '#6cb6ff';
export const HOLDS_BACK = '#ff8f6b';

export const percent = (share: number) => `${Math.round(share * 100)}%`;

/** A ratio of young as "1.4×"; anything past ten times as ">10×". */
export function times(ratio: number): string {
  if (!Number.isFinite(ratio) || ratio > 10) return '>10×';
  return `${ratio.toFixed(1)}×`;
}
