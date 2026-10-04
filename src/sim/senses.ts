import { Input, INPUTS_PER_RAY, RAY_COUNT } from './brain';
import type { SimConfig } from './config';
import type { Creatures } from './creatures';
import { maxEnergyFor } from './genome';
import { wrap, wrappedDelta } from './geometry';
import { cellIndexAt, type PlantField } from './plants';
import type { SpatialHash } from './spatialHash';

/** Points along each ray where plant cover is sampled, as fractions of its length. */
const PLANT_SAMPLES = [0.5, 1];
const TWO_PI = Math.PI * 2;

/**
 * Fills a brain's inputs with what a creature perceives. Vision is three
 * rays (left, ahead, right). Each reports the plant cover along it, how near
 * the closest creature in its direction is, and how alike that creature's
 * colour is to the viewer's.
 */
export class Senses {
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
    private readonly plants: PlantField,
    private readonly hash: SpatialHash,
  ) {}

  /** Write creature i's inputs. The hash must have been built from `creatures`. */
  sense(creatures: Creatures, i: number, tick: number, inputs: Float32Array): void {
    const { config, plants } = this;
    const x = creatures.x[i]!;
    const y = creatures.y[i]!;
    const heading = creatures.heading[i]!;
    const range = config.senseRange * creatures.sensorRange[i]!;
    // Plant cover is relative to the richest possible cell; a barren world reads as zero.
    const coverScale = config.plantCapacity > 0 ? 1 / config.plantCapacity : 0;

    for (let ray = 0; ray < RAY_COUNT; ray++) {
      const angle = heading + (ray - 1) * config.raySpread;
      const dx = Math.cos(angle) * range;
      const dy = Math.sin(angle) * range;
      let cover = 0;
      for (const t of PLANT_SAMPLES) {
        const px = wrap(x + dx * t, config.worldWidth);
        const py = wrap(y + dy * t, config.worldHeight);
        cover += plants.energy[cellIndexAt(plants, px, py)]!;
      }
      const o = Input.Rays + ray * INPUTS_PER_RAY;
      inputs[o] = (cover / PLANT_SAMPLES.length) * coverScale;
      inputs[o + 1] = 0;
      inputs[o + 2] = 0;
      this.nearest[ray] = Infinity;
    }

    this.self = i;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.range = range;
    this.inputs = inputs;
    this.creatures = creatures;
    this.hash.query(x, y, range, this.visit);

    inputs[Input.Underfoot] = plants.energy[cellIndexAt(plants, x, y)]! * coverScale;
    inputs[Input.Energy] = creatures.energy[i]! / maxEnergyFor(creatures.size[i]!, config);
    inputs[Input.Age] = creatures.age[i]! / config.maxAge;
    inputs[Input.Clock] = Math.sin((TWO_PI * tick) / config.clockPeriod);
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
    if (ray < 0 || ray >= RAY_COUNT || distance >= this.nearest[ray]!) return;

    this.nearest[ray] = distance;
    const o = Input.Rays + ray * INPUTS_PER_RAY;
    this.inputs[o + 1] = 1 - distance / this.range;
    this.inputs[o + 2] = Math.cos(TWO_PI * (creatures.hue[j]! - creatures.hue[this.self]!));
  };
}
