import { Input, INPUTS_PER_RAY, RAY_COUNT } from './brain';
import type { SimConfig } from './config';
import type { Creatures } from './creatures';
import { seasonAt } from './environment';
import { maxEnergyFor } from './genome';
import { wrap, wrappedDelta } from './geometry';
import { cellIndexAt, type PlantField } from './plants';
import type { SpatialHash } from './spatialHash';

/** Points along each ray where ground cover is sampled, as fractions of its length. */
const GROUND_SAMPLES = [0.5, 1];
const TWO_PI = Math.PI * 2;

/** Offsets of the per-ray inputs. */
const RAY_PLANTS = 0;
const RAY_MEAT = 1;
const RAY_SCENT = 2;
const RAY_NEARNESS = 3;
const RAY_KIN = 4;
const RAY_BIGGER = 5;

/**
 * Fills a brain's inputs with what a creature perceives. Vision is three
 * rays (left, ahead, right). Each reports the plants, meat and scent along it, and,
 * for the closest creature in its direction, how near it is, how alike its
 * colour is to the viewer's, and whether it is bigger or smaller.
 */
export class Senses {
  /** After sense(): index of the closest creature in view, or -1, and the gap to its edge. */
  targetIndex = -1;
  targetGap = Infinity;

  // State for the neighbor visit, kept on the instance to avoid a closure per creature.
  private self = 0;
  private x = 0;
  private y = 0;
  private heading = 0;
  private range = 0;
  private inputs: Float32Array = new Float32Array(0);
  private creatures!: Creatures;
  private nearest = new Float32Array(RAY_COUNT);

  constructor(
    private readonly config: SimConfig,
    private readonly field: PlantField,
    private readonly hash: SpatialHash,
  ) {}

  /** Write creature i's inputs. The hash must have been built from `creatures`. */
  sense(creatures: Creatures, i: number, tick: number, inputs: Float32Array): void {
    const { config, field } = this;
    const x = creatures.x[i]!;
    const y = creatures.y[i]!;
    const heading = creatures.heading[i]!;
    const range = config.senseRange * creatures.sensorRange[i]!;
    // Plant cover is relative to the richest possible cell; a barren world reads as zero.
    const plantScale = config.plantCapacity > 0 ? 1 / config.plantCapacity : 0;
    const meatScale = 1 / config.meatScale;

    for (let ray = 0; ray < RAY_COUNT; ray++) {
      const angle = heading + (ray - 1) * config.raySpread;
      const dx = Math.cos(angle) * range;
      const dy = Math.sin(angle) * range;
      let plants = 0;
      let meat = 0;
      let scent = 0;
      for (const t of GROUND_SAMPLES) {
        const px = wrap(x + dx * t, config.worldWidth);
        const py = wrap(y + dy * t, config.worldHeight);
        const cell = cellIndexAt(field, px, py);
        plants += field.energy[cell]!;
        meat += field.meat[cell]!;
        scent += field.scent[cell]!;
      }
      const o = Input.Rays + ray * INPUTS_PER_RAY;
      inputs[o + RAY_PLANTS] = (plants / GROUND_SAMPLES.length) * plantScale;
      inputs[o + RAY_MEAT] = Math.min(1, (meat / GROUND_SAMPLES.length) * meatScale);
      inputs[o + RAY_SCENT] = Math.min(1, scent / GROUND_SAMPLES.length);
      inputs[o + RAY_NEARNESS] = 0;
      inputs[o + RAY_KIN] = 0;
      inputs[o + RAY_BIGGER] = 0;
      this.nearest[ray] = Infinity;
    }

    this.self = i;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.range = range;
    this.inputs = inputs;
    this.creatures = creatures;
    this.targetIndex = -1;
    this.targetGap = Infinity;
    this.hash.query(x, y, range, this.visit);

    const cell = cellIndexAt(field, x, y);
    inputs[Input.Underfoot] = field.energy[cell]! * plantScale;
    inputs[Input.MeatUnderfoot] = Math.min(1, field.meat[cell]! * meatScale);
    inputs[Input.ScentUnderfoot] = Math.min(1, field.scent[cell]!);
    inputs[Input.Energy] = creatures.energy[i]! / maxEnergyFor(creatures.size[i]!, config);
    inputs[Input.Health] = creatures.health[i]!;
    inputs[Input.Age] = creatures.age[i]! / config.maxAge;
    inputs[Input.Clock] = Math.sin((TWO_PI * tick) / config.clockPeriod);
    inputs[Input.Season] = config.seasonStrength > 0 ? (seasonAt(tick, config) - 1) / config.seasonStrength : 0;
    inputs[Input.Bias] = 1;
  }

  private visit = (j: number): void => {
    if (j === this.self) return;
    const { config, creatures } = this;
    const dx = wrappedDelta(this.x, creatures.x[j]!, config.worldWidth);
    const dy = wrappedDelta(this.y, creatures.y[j]!, config.worldHeight);
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance === 0) return;

    // Which ray points most nearly at the neighbor, if any does.
    let bearing = (Math.atan2(dy, dx) - this.heading) % TWO_PI;
    if (bearing > Math.PI) bearing -= TWO_PI;
    else if (bearing < -Math.PI) bearing += TWO_PI;
    const ray = Math.round(bearing / config.raySpread) + 1;
    if (ray < 0 || ray >= RAY_COUNT) return;

    const mySize = creatures.size[this.self]!;
    const theirSize = creatures.size[j]!;
    const gap = distance - config.creatureRadius * (mySize + theirSize);
    if (gap < this.targetGap) {
      this.targetGap = gap;
      this.targetIndex = j;
    }
    if (distance >= this.nearest[ray]!) return;

    this.nearest[ray] = distance;
    const o = Input.Rays + ray * INPUTS_PER_RAY;
    this.inputs[o + RAY_NEARNESS] = 1 - distance / this.range;
    this.inputs[o + RAY_KIN] = Math.cos(TWO_PI * (creatures.hue[j]! - creatures.hue[this.self]!));
    this.inputs[o + RAY_BIGGER] = (theirSize - mySize) / (theirSize + mySize);
  };
}
