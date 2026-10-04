import type { Brain } from './brain';
import type { SimConfig } from './config';
import type { Creatures } from './creatures';

/**
 * Groups creatures into species by how alike their genes are. Each species
 * has a representative; a creature belongs to a species if it is within a
 * set distance of that representative. A creature that fits none founds a
 * new species. Children start in their parent's species and are re-checked
 * at each classification, so species split as lineages drift apart.
 */

/** How much each difference counts toward the distance between two creatures. */
const SIZE_SCALE = 0.35;
const SPEED_SCALE = 0.35;
const SENSOR_SCALE = 0.6;
const DIET_SCALE = 0.25;
const BRAIN_WEIGHT = 3;

export interface SpeciesRecord {
  id: number;
  /** Tick at which the species was first seen. */
  bornTick: number;
  /** Members at the last classification. */
  count: number;
  /** Genes of the representative that membership is measured against. */
  size: number;
  speed: number;
  sensorRange: number;
  diet: number;
  /** Innovation ids of the representative's enabled links. */
  links: number[];
}

export interface SpeciesState {
  nextId: number;
  species: SpeciesRecord[];
}

export function createSpeciesState(): SpeciesState {
  return { nextId: 1, species: [] };
}

function enabledInnovations(brain: Brain): number[] {
  const ids: number[] = [];
  for (const link of brain.links) if (link.enabled) ids.push(link.innovation);
  return ids.sort((a, b) => a - b);
}

/** Share of links, across both wirings, that only one of them has. Both lists are sorted. */
function wiringDifference(a: number[], b: number[]): number {
  let shared = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      shared++;
      i++;
      j++;
    } else if (a[i]! < b[j]!) i++;
    else j++;
  }
  const union = a.length + b.length - shared;
  return union === 0 ? 0 : 1 - shared / union;
}

/** Distance between creature i and a species' representative: 0 is identical. */
function distanceTo(record: SpeciesRecord, c: Creatures, i: number, links: number[]): number {
  return (
    Math.abs(Math.log(c.size[i]! / record.size)) / SIZE_SCALE +
    Math.abs(Math.log(c.speed[i]! / record.speed)) / SPEED_SCALE +
    Math.abs(Math.log(c.sensorRange[i]! / record.sensorRange)) / SENSOR_SCALE +
    Math.abs(c.diet[i]! - record.diet) / DIET_SCALE +
    wiringDifference(links, record.links) * BRAIN_WEIGHT
  );
}

/**
 * Assign every creature to a species, founding new ones as needed and
 * dropping those left empty. Each surviving species then takes its first
 * member as its new representative, so it follows its members as they evolve.
 */
export function classifySpecies(state: SpeciesState, c: Creatures, tick: number, config: SimConfig): void {
  const byId = new Map<number, SpeciesRecord>();
  for (const record of state.species) {
    record.count = 0;
    byId.set(record.id, record);
  }
  const firstMember = new Map<number, number>();

  for (let i = 0; i < c.count; i++) {
    const links = enabledInnovations(c.brain[i]!);
    const current = byId.get(c.species[i]!);
    let home = current && distanceTo(current, c, i, links) <= config.speciesThreshold ? current : undefined;
    if (!home) {
      // Nearest other species within reach, if any.
      let best = config.speciesThreshold;
      for (const record of state.species) {
        if (record === current) continue;
        const distance = distanceTo(record, c, i, links);
        if (distance <= best) {
          best = distance;
          home = record;
        }
      }
    }
    if (!home) {
      home = {
        id: state.nextId++,
        bornTick: tick,
        count: 0,
        size: c.size[i]!,
        speed: c.speed[i]!,
        sensorRange: c.sensorRange[i]!,
        diet: c.diet[i]!,
        links,
      };
      state.species.push(home);
      byId.set(home.id, home);
    }
    home.count++;
    c.species[i] = home.id;
    if (!firstMember.has(home.id)) firstMember.set(home.id, i);
  }

  state.species = state.species.filter((record) => record.count > 0);
  for (const record of state.species) {
    const i = firstMember.get(record.id)!;
    record.size = c.size[i]!;
    record.speed = c.speed[i]!;
    record.sensorRange = c.sensorRange[i]!;
    record.diet = c.diet[i]!;
    record.links = enabledInnovations(c.brain[i]!);
  }
}
