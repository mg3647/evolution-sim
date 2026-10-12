import { speciesRgb } from '../render/speciesPalette';
import type { HistoryData } from '../worker/protocol';

/** The colour a species is drawn in everywhere, as CSS hex; id 0 stands for the smaller species lumped together. */
export function speciesColor(id: number): string {
  return `#${speciesRgb(id).toString(16).padStart(6, '0')}`;
}

const ONSETS = ['B', 'D', 'F', 'G', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'V', 'Z', 'Th', 'Sh'];
const VOWELS = ['a', 'e', 'i', 'o', 'u', 'y', 'au', 'ei'];
const MIDDLES = ['l', 'r', 'n', 'm', 'v', 's', 'th', 'd', 'k', 'z', 'b', 't', 'x', 'ph', 'll', 'nd'];
const ENDINGS = ['', 'n', 'ra', 's'];

/**
 * A short made-up name for a species, such as "Velora", so one can be followed
 * from view to view. The same id always gives the same name, and no two ids
 * below 65,536 share one: the id is shuffled by an odd multiplier (a one-to-one
 * map on 16 bits), then read off as onset, vowel, middle, vowel and ending.
 */
export function speciesName(id: number): string {
  if (id <= 0) return 'Smaller species';
  let x = Math.imul(id, 40503) & 0xffff;
  const pick = (list: string[]) => {
    const part = list[x % list.length]!;
    x = Math.floor(x / list.length);
    return part;
  };
  return pick(ONSETS) + pick(VOWELS) + pick(MIDDLES) + pick(VOWELS) + pick(ENDINGS);
}

/** The series of the species stream chart, one per species the history follows. */
export function streamSeries(history: HistoryData | null): { label: string; color: string }[] {
  return (history?.species ?? []).map((s) => ({ label: speciesName(s.id), color: speciesColor(s.id) }));
}
