import { Input, INPUTS_PER_RAY, RAY_COUNT, Ray } from './brain';
import type { SimConfig } from './config';
import type { Creatures } from './creatures';
import { seasonAt } from './environment';
import { maxEnergyFor } from './genome';
import { cellIndexAt, type PlantField } from './plants';
import type { SpatialHash } from './spatialHash';

/** Points along each ray where the ground is sampled, as fractions of its length. */
const GROUND_SAMPLES = [0.5, 1];
const TWO_PI = Math.PI * 2;
/** This many creatures within sensing range reads as fully crowded. */
const CROWD_FULL = 8;
/** Health lost since its last turn that reads as full pain: about one hard bite. */
const PAIN_FULL = 0.3;

/**
 * Fills a brain's inputs with what a creature perceives. Vision is three
 * rays (left, ahead, right). Each reports the ground along it (plants, meat,
 * water, wall) and, for the closest creature in its direction, how near it
 * is, how alike its colour is, whether it is bigger, what it eats, whether
 * it is coming this way, and whether it is hurt. Beyond vision a creature
 * feels what is behind it, how crowded it is, scent, and its own body.
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
  private nearestBehind = Infinity;
  private neighbors = 0;

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
    /** Scent halfway along the left and right rays, for telling which side it is stronger on. */
    let scentLeft = 0;
    let scentRight = 0;

    for (let ray = 0; ray < RAY_COUNT; ray++) {
      // Each ray is the heading turned by a whole number of spreads: -1, 0, +1.
      const turn = ray - 1;
      const dx = (cosHeading * this.cosSpread - turn * sinHeading * this.sinSpread) * range;
      const dy = (sinHeading * this.cosSpread + turn * cosHeading * this.sinSpread) * range;
      let plants = 0;
      let meat = 0;
      let wall = 0;
      let water = 0;
      for (const t of GROUND_SAMPLES) {
        let px = turn === 0 ? x + cosHeading * range * t : x + dx * t;
        let py = turn === 0 ? y + sinHeading * range * t : y + dy * t;
        px -= Math.floor(px / worldWidth) * worldWidth;
        py -= Math.floor(py / worldHeight) * worldHeight;
        const cell = cellIndexAt(field, px, py);
        plants += field.energy[cell]!;
        meat += field.meat[cell]!;
        // A nearer wall or shore reads stronger.
        if (field.walls[cell]) wall = Math.max(wall, 1.5 - t);
        if (field.water[cell]) water = Math.max(water, 1.5 - t);
        if (t === GROUND_SAMPLES[0]) {
          if (turn < 0) scentLeft = field.scent[cell]!;
          else if (turn > 0) scentRight = field.scent[cell]!;
        }
      }
      const o = Input.Rays + ray * INPUTS_PER_RAY;
      inputs[o + Ray.Plants] = (plants / GROUND_SAMPLES.length) * plantScale;
      inputs[o + Ray.Meat] = Math.min(1, (meat / GROUND_SAMPLES.length) * meatScale);
      inputs[o + Ray.Water] = Math.min(1, water);
      inputs[o + Ray.Wall] = Math.min(1, wall);
      inputs[o + Ray.Near] = 0;
      inputs[o + Ray.Kin] = 0;
      inputs[o + Ray.Bigger] = 0;
      inputs[o + Ray.MeatEater] = 0;
      inputs[o + Ray.Approaching] = 0;
      inputs[o + Ray.Hurt] = 0;
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
    this.nearestBehind = Infinity;
    this.neighbors = 0;
    this.hash.query(x, y, range, this.visit);

    const social = config.socialSenses;
    inputs[Input.Behind] = social && this.nearestBehind < range ? 1 - this.nearestBehind / range : 0;
    inputs[Input.Crowding] = social ? Math.min(1, this.neighbors / CROWD_FULL) : 0;
    inputs[Input.Pain] = social ? Math.min(1, creatures.pain[i]! / PAIN_FULL) : 0;

    const cell = cellIndexAt(field, x, y);
    inputs[Input.Underfoot] = field.energy[cell]! * plantScale;
    inputs[Input.MeatUnderfoot] = Math.min(1, field.meat[cell]! * meatScale);
    inputs[Input.InWater] = field.water[cell]!;
    inputs[Input.ScentUnderfoot] = Math.min(1, field.scent[cell]!);
    inputs[Input.ScentSide] = Math.min(1, scentRight) - Math.min(1, scentLeft);
    inputs[Input.Energy] = creatures.energy[i]! / maxEnergyFor(creatures.size[i]!, config);
    inputs[Input.Health] = creatures.health[i]!;
    inputs[Input.Thirst] = 1 - creatures.hydration[i]!;
    inputs[Input.Age] = creatures.age[i]! / config.maxAge;
    inputs[Input.Sick] = creatures.sick[i]! > 0 ? 1 : 0;
    if (tick !== this.cachedTick) {
      this.cachedTick = tick;
      this.clock = Math.sin((TWO_PI * tick) / config.clockPeriod);
      this.season = config.seasonStrength > 0 ? (seasonAt(tick, config) - 1) / config.seasonStrength : 0;
    }
    inputs[Input.Clock] = this.clock;
    inputs[Input.Season] = this.season;
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
    this.neighbors++;

    // Which ray points most nearly at the neighbor, if any does. `ahead` and
    // `aside` are the neighbor's position as seen from the creature.
    let ray = -1;
    if (this.narrowView) {
      const ahead = dx * this.cosHeading + dy * this.sinHeading;
      if (ahead > 0) {
        const aside = dy * this.cosHeading - dx * this.sinHeading;
        const off = aside < 0 ? -aside : aside;
        if (off < ahead * this.tanView) ray = off < ahead * this.tanCentre ? 1 : aside < 0 ? 0 : 2;
      }
    } else {
      let bearing = (Math.atan2(dy, dx) - this.heading) % TWO_PI;
      if (bearing > Math.PI) bearing -= TWO_PI;
      else if (bearing < -Math.PI) bearing += TWO_PI;
      ray = Math.round(bearing / config.raySpread) + 1;
      if (ray < 0 || ray >= RAY_COUNT) ray = -1;
    }
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (ray < 0) {
      // Out of sight, but close enough to feel.
      if (distance < this.nearestBehind) this.nearestBehind = distance;
      return;
    }

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
    const inputs = this.inputs;
    inputs[o + Ray.Near] = 1 - distance / this.range;
    inputs[o + Ray.Kin] = Math.cos(TWO_PI * (creatures.hue[j]! - creatures.hue[this.self]!));
    inputs[o + Ray.Bigger] = (theirSize - mySize) / (theirSize + mySize);
    if (!config.socialSenses) return;
    // Plant-eaters read below zero and meat-eaters above, so neither looks like "nobody there".
    inputs[o + Ray.MeatEater] = creatures.diet[j]! * 2 - 1;
    // How squarely the other is facing this way: 1 is head-on, -1 is directly away.
    const theirHeading = creatures.heading[j]!;
    inputs[o + Ray.Approaching] = -(Math.cos(theirHeading) * dx + Math.sin(theirHeading) * dy) / distance;
    inputs[o + Ray.Hurt] = creatures.sick[j]! > 0 ? 1 : 1 - Math.max(0, creatures.health[j]!);
  };
}
