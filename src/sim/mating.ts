import type { Brain } from './brain';
import type { Genes } from './genome';
import {
  DEFENSE_SCALE,
  DIET_SCALE,
  FUR_SCALE,
  SENSOR_SCALE,
  SIZE_SCALE,
  SPEED_SCALE,
  WEIGHT_SCALE,
} from './species';

/**
 * How different two creatures are, for deciding whether they may mate. On
 * the same scale as species: 1 is a clear difference. The body part adds up
 * the genes' differences, each over the same scale species use (size, speed
 * and sensor range as ratios). The wiring part follows NEAT's compatibility
 * distance: the share of links (by innovation id) only one has, over all
 * links either has, plus the mean weight difference on the links both have.
 */
export function mateDistance(aGenes: Genes, aBrain: Brain, bGenes: Genes, bBrain: Brain): number {
  const body =
    Math.abs(Math.log(aGenes.size / bGenes.size)) / SIZE_SCALE +
    Math.abs(Math.log(aGenes.speed / bGenes.speed)) / SPEED_SCALE +
    Math.abs(Math.log(aGenes.sensorRange / bGenes.sensorRange)) / SENSOR_SCALE +
    Math.abs(aGenes.diet - bGenes.diet) / DIET_SCALE +
    Math.abs(aGenes.fur - bGenes.fur) / FUR_SCALE +
    Math.abs(aGenes.defense - bGenes.defense) / DEFENSE_SCALE;

  const theirs = new Map<number, number>();
  for (const link of bBrain.links) if (link.enabled) theirs.set(link.innovation, link.weight);
  let mine = 0;
  let shared = 0;
  let weight = 0;
  for (const link of aBrain.links) {
    if (!link.enabled) continue;
    mine++;
    const other = theirs.get(link.innovation);
    if (other !== undefined) {
      shared++;
      weight += Math.abs(link.weight - other);
    }
  }
  const union = mine + theirs.size - shared;
  const missing = union > 0 ? (union - shared) / union : 0;
  const stronger = shared > 0 ? Math.min(1, weight / shared / WEIGHT_SCALE) : 0;
  return body + missing + stronger;
}
