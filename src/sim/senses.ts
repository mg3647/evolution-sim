import { Input, INPUTS_PER_RAY, RAY_COUNT } from './brain';
import type { SimConfig } from './config';
import type { Creatures } from './creatures';
import { seasonAt } from './environment';
import { maxEnergyFor } from './genome';
import { cellIndexAt, type PlantField } from './plants';
import type { SpatialHash } from './spatialHash';

/** Points along each ray where ground cover is sampled, as fractions of its length. */
const GROUND_SAMPLES = [0.5, 1];
const TWO_PI = Math.PI * 2;

/** Offsets of the per-ray inputs. */
const RAY_PLANTS = 0;
const RAY_MEAT = 1;
const RAY_SCENT = 2;
const RAY_WALL = 3;
const RAY_NEARNESS = 4;
const RAY_KIN = 5;
const RAY_BIGGER = 6;
const RAY_SICK = 7;

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
  private cosHeading = 1;
  private sinHeading = 0;

  // This runs for every creature every tick and dominates the cost of a tick,
  // so values that do not change per creature are worked out once.
  private readonly cosSpread: number;
  private readonly sinSpread: number;
  /** Tangents of the angles bounding the centre ray and the whole field of view. */
  private readonly tanCentre: number;
  private readonly tanView: number;
  /** False if the field of view reaches past straight sideways, where the tangent test breaks down. */
  private readonly narrowView: boolean;
  private cachedTick = -1;
  private clock = 0;
  private season = 0;

  constructor(
    private readonly config: SimConfig,
    private readonly field: PlantField,
    private readonly hash: SpatialHash,
  ) {
    this.cosSpread = Math.cos(config.raySpread);
    this.sinSpread = Math.sin(config.raySpread);
    this.tanCentre = Math.tan(config.raySpread / 2);
    this.tanView = Math.tan(config.raySpread * 1.5);
    this.narrowView = config.raySpread * 1.5 < Math.PI / 2 - 0.01;
  }

  /** Write creature i's inputs. The hash must have been built from `creatures`. */
  sense(creatures: Creatures, i: number, tick: number, inputs: Float32Array): void {
    const { config, field } = this;
    const { worldWidth, worldHeight } = config;
    const x = creatures.x[i]!;
    const y = creatures.y[i]!;
    const heading = creatures.heading[i]!;
    const range = config.senseRange * creatures.sensorRange[i]!;
    // Plant cover is relative to the richest possible cell; a barren world reads as zero.
    const plantScale = config.plantCapacity > 0 ? 1 / config.plantCapacity : 0;
    const meatScale = 1 / config.meatScale;
    const cosHeading = Math.cos(heading);
    const sinHeading = Math.sin(heading);

    for (let ray = 0; ray < RAY_COUNT; ray++) {
      // Each ray is the heading turned by a whole number of spreads: -1, 0, +1.
      const turn = ray - 1;
      const dx = (cosHeading * this.cosSpread - turn * sinHeading * this.sinSpread) * range;
      const dy = (sinHeading * this.cosSpread + turn * cosHeading * this.sinSpread) * range;
      let plants = 0;
      let meat = 0;
      let scent = 0;
      let wall = 0;
      for (const t of GROUND_SAMPLES) {
        let px = turn === 0 ? x + cosHeading * range * t : x + dx * t;
        let py = turn === 0 ? y + sinHeading * range * t : y + dy * t;
        px -= Math.floor(px / worldWidth) * worldWidth;
        py -= Math.floor(py / worldHeight) * worldHeight;
        const cell = cellIndexAt(field, px, py);
        plants += field.energy[cell]!;
        meat += field.meat[cell]!;
        scent += field.scent[cell]!;
        // A nearer wall reads stronger.
        if (field.walls[cell]) wall = Math.max(wall, 1.5 - t);
      }
      const o = Input.Rays + ray * INPUTS_PER_RAY;
      inputs[o + RAY_PLANTS] = (plants / GROUND_SAMPLES.length) * plantScale;
      inputs[o + RAY_MEAT] = Math.min(1, (meat / GROUND_SAMPLES.length) * meatScale);
      inputs[o + RAY_SCENT] = Math.min(1, scent / GROUND_SAMPLES.length);
      inputs[o + RAY_WALL] = Math.min(1, wall);
      inputs[o + RAY_SICK] = 0;
      inputs[o + RAY_NEARNESS] = 0;
      inputs[o + RAY_KIN] = 0;
      inputs[o + RAY_BIGGER] = 0;
      this.nearest[ray] = Infinity;
    }

    this.self = i;
    this.x = x;
    this.y = y;
    this.heading = heading;
    this.cosHeading = cosHeading;
    this.sinHeading = sinHeading;
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
    if (tick !== this.cachedTick) {
      this.cachedTick = tick;
      this.clock = Math.sin((TWO_PI * tick) / config.clockPeriod);
      this.season = config.seasonStrength > 0 ? (seasonAt(tick, config) - 1) / config.seasonStrength : 0;
    }
    inputs[Input.Clock] = this.clock;
    inputs[Input.Season] = this.season;
    inputs[Input.Sick] = creatures.sick[i]! > 0 ? 1 : 0;
    inputs[Input.Bias] = 1;
  }

  private visit = (j: number): void => {
    if (j === this.self) return;
    const { config, creatures } = this;
    // Shortest way round the wrapped world, for two points inside it.
    let dx = creatures.x[j]! - this.x;
    if (dx > config.worldWidth / 2) dx -= config.worldWidth;
    else if (dx < -config.worldWidth / 2) dx += config.worldWidth;
    let dy = creatures.y[j]! - this.y;
    if (dy > config.worldHeight / 2) dy -= config.worldHeight;
    else if (dy < -config.worldHeight / 2) dy += config.worldHeight;
    if (dx === 0 && dy === 0) return;

    // Which ray points most nearly at the neighbor, if any does. `ahead` and
    // `aside` are the neighbor's position as seen from the creature.
    let ray: number;
    if (this.narrowView) {
      const ahead = dx * this.cosHeading + dy * this.sinHeading;
      if (ahead <= 0) return;
      const aside = dy * this.cosHeading - dx * this.sinHeading;
      const off = aside < 0 ? -aside : aside;
      if (off >= ahead * this.tanView) return;
      ray = off < ahead * this.tanCentre ? 1 : aside < 0 ? 0 : 2;
    } else {
      let bearing = (Math.atan2(dy, dx) - this.heading) % TWO_PI;
      if (bearing > Math.PI) bearing -= TWO_PI;
      else if (bearing < -Math.PI) bearing += TWO_PI;
      ray = Math.round(bearing / config.raySpread) + 1;
      if (ray < 0 || ray >= RAY_COUNT) return;
    }
    const distance = Math.sqrt(dx * dx + dy * dy);

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
    this.inputs[o + RAY_SICK] = creatures.sick[j]! > 0 ? 1 : 0;
  };
}
