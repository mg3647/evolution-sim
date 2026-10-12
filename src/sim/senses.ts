import { BIOME_TRAITS } from './biomes';
import { Obstacle, obstacleBetween } from './blocks';
import { Input, INPUTS_PER_RAY, RAY_COUNT, Ray } from './brain';
import type { SimConfig } from './config';
import { Held, type Creatures } from './creatures';
import { daylightAt, seasonAt } from './environment';
import { maxEnergyFor } from './genome';
import { wrapNear } from './geometry';
import { cellIndexAt, groundHue, temperatureAt, visibility, type PlantField } from './plants';
import { callShare, soundCellAt, type SoundField } from './sound';
import type { SpatialHash } from './spatialHash';

/** Points along each ray where the ground is sampled, as fractions of its length. */
const GROUND_SAMPLES = [0.25, 0.5, 0.75, 1];
/** The sample whose scent is compared left against right. */
const SCENT_SAMPLE = 1;
/** How strongly something seen at the first sample reads; one at the end of sight reads a quarter. */
const NEAREST = 1 + GROUND_SAMPLES[0]!;
const TWO_PI = Math.PI * 2;
/** This many creatures within sensing range reads as fully crowded. */
const CROWD_FULL = 8;
/** Health lost since its last turn that reads as full pain: about one hard bite. */
const PAIN_FULL = 0.3;
/** A temperature difference of a tenth between here and the end of sight reads as fully warmer or colder. */
const WARMER_GAIN = 10;
/** A steady gain of two percent of its maximum energy per tick reads as fully rising. */
const TREND_GAIN = 50;

/**
 * Fills a brain's inputs with what a creature perceives. Vision is three
 * rays (left, ahead, right). Each reports the ground along it (plants, meat,
 * water, wall, fire, items, blocks, stored food) up to the first wall or
 * block, which hides what lies past it, and, for the closest creature in its
 * direction, how near it is, how alike its colour is, whether it is bigger,
 * what it eats, whether it is coming this way, whether it is wounded or sick,
 * and its actual colour. A creature the colour of the ground under it can
 * only be seen from closer, and one behind a wall or block not at all.
 * Beyond vision a creature feels what is behind it and on which side, how
 * crowded it is, scent, calls, the temperature and where it is warmer, the
 * cell it faces, shelter, and its own body.
 */
export class Senses {
  /** After sense(): index of the closest creature in view, or -1, and the gap to its edge. */
  targetIndex = -1;
  targetGap = Infinity;
  /** The warmth of the season and hour, set by the world each tick; see Climate. */
  warmth = 0;
  /** The part of that warmth owed to the time of day. */
  dayWarmth = 0;

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
  private behindIndex = -1;
  private behindSide = 0;
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
  private daylight = 1;

  constructor(
    private readonly config: SimConfig,
    private readonly field: PlantField,
    private readonly hash: SpatialHash,
    private readonly sound: SoundField,
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
    if (tick !== this.cachedTick) {
      this.cachedTick = tick;
      this.clock = Math.sin((TWO_PI * tick) / config.clockPeriod);
      this.season = config.seasonStrength > 0 ? (seasonAt(tick, config) - 1) / config.seasonStrength : 0;
      this.daylight = daylightAt(tick, config);
    }
    const here = cellIndexAt(field, x, y);
    // Sight shortens in the dark, and reaches further over open desert.
    const range =
      config.senseRange *
      creatures.sensorRange[i]! *
      (config.nightVision + (1 - config.nightVision) * this.daylight) *
      BIOME_TRAITS[field.biome[here]!]!.sight;
    // Plant cover is relative to the richest possible cell; a barren world reads as zero.
    const plantScale = config.plantCapacity > 0 ? 1 / config.plantCapacity : 0;
    const meatScale = 1 / config.meatScale;
    const cosHeading = Math.cos(heading);
    const sinHeading = Math.sin(heading);
    /** Scent halfway along the left and right rays, for telling which side it is stronger on. */
    let scentLeft = 0;
    let scentRight = 0;

    const swimming = field.water[here] === 1;
    const storeLeast = config.biteSize;
    // The ground is sampled twelve times per creature, so the field's arrays are held close.
    const { cols, rows, cellWidth, cellHeight, walls, blocks, blockHeavy, energy, meat: meatField, water: waterField } = field;
    const { fire: fireField, stones, branches, store: storeField, scent } = field;
    for (let ray = 0; ray < RAY_COUNT; ray++) {
      // Each ray is the heading turned by a whole number of spreads: -1, 0, +1.
      const turn = ray - 1;
      const dx = (cosHeading * this.cosSpread - turn * sinHeading * this.sinSpread) * range;
      const dy = (sinHeading * this.cosSpread + turn * cosHeading * this.sinSpread) * range;
      let plants = 0;
      let meat = 0;
      let wall = 0;
      let water = 0;
      let fire = 0;
      let items = 0;
      let store = 0;
      let block = 0;
      // Walked from near to far, so the first hit of each kind is the nearest, and the walk stops at a
      // wall or block: nothing past one is seen, nor is scent from past one smelled.
      for (const t of GROUND_SAMPLES) {
        let px = turn === 0 ? x + cosHeading * range * t : x + dx * t;
        let py = turn === 0 ? y + sinHeading * range * t : y + dy * t;
        px = wrapNear(px, worldWidth);
        py = wrapNear(py, worldHeight);
        // As cellIndexAt, written out.
        const cell =
          Math.min(rows - 1, Math.floor(py / cellHeight)) * cols + Math.min(cols - 1, Math.floor(px / cellWidth));
        if (t === GROUND_SAMPLES[SCENT_SAMPLE]) {
          if (turn < 0) scentLeft = scent[cell]!;
          else if (turn > 0) scentRight = scent[cell]!;
        }
        // What is underfoot has its own senses.
        if (cell === here) continue;
        const near = NEAREST - t;
        if (walls[cell]) {
          wall = near;
          break;
        }
        if (blocks[cell]) {
          // Heavy blocks read below zero, light ones above, so a creature can tell which it faces.
          block = blockHeavy[cell] === 1 ? -near : near;
          break;
        }
        plants += energy[cell]!;
        meat += meatField[cell]!;
        // In water, the water input shows the way back to land instead.
        if (water === 0 && (swimming ? !waterField[cell] : waterField[cell])) water = near;
        if (fire === 0 && fireField[cell]) fire = near;
        if (items === 0) {
          if (stones[cell]) items = near;
          else if (branches[cell]) items = -near;
        }
        if (store === 0 && storeField[cell]! >= storeLeast) store = near;
      }
      const o = Input.Rays + ray * INPUTS_PER_RAY;
      inputs[o + Ray.Plants] = (plants / GROUND_SAMPLES.length) * plantScale;
      inputs[o + Ray.Meat] = Math.min(1, (meat / GROUND_SAMPLES.length) * meatScale);
      inputs[o + Ray.Water] = water;
      inputs[o + Ray.Wall] = wall;
      inputs[o + Ray.Fire] = fire;
      inputs[o + Ray.Items] = items;
      inputs[o + Ray.Block] = block;
      inputs[o + Ray.Store] = store;
      inputs[o + Ray.Near] = 0;
      inputs[o + Ray.Kin] = 0;
      inputs[o + Ray.Bigger] = 0;
      inputs[o + Ray.MeatEater] = 0;
      inputs[o + Ray.Approaching] = 0;
      inputs[o + Ray.Hurt] = 0;
      inputs[o + Ray.ColourWarm] = 0;
      inputs[o + Ray.ColourGreen] = 0;
      inputs[o + Ray.Display] = 0;
      inputs[o + Ray.Sick] = 0;
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
    this.behindIndex = -1;
    this.behindSide = 0;
    this.neighbors = 0;
    this.hash.query(x, y, range, this.visit);

    const social = config.socialSenses;
    const felt = social && this.nearestBehind < range;
    inputs[Input.Behind] = felt ? 1 - this.nearestBehind / range : 0;
    inputs[Input.BehindSide] = felt ? this.behindSide : 0;
    inputs[Input.BehindMeatEater] = felt ? creatures.diet[this.behindIndex]! * 2 - 1 : 0;
    inputs[Input.Crowding] = social ? Math.min(1, this.neighbors / CROWD_FULL) : 0;
    inputs[Input.Pain] = social ? Math.min(1, creatures.pain[i]! / PAIN_FULL) : 0;

    const cell = here;
    inputs[Input.Underfoot] = field.energy[cell]! * plantScale;
    inputs[Input.MeatUnderfoot] = Math.min(1, field.meat[cell]! * meatScale);
    inputs[Input.InWater] = field.water[cell]!;
    inputs[Input.ScentUnderfoot] = Math.min(1, field.scent[cell]!);
    inputs[Input.ItemUnderfoot] = field.stones[cell]! > 0 ? 1 : field.branches[cell]! > 0 ? -1 : 0;
    inputs[Input.StoreUnderfoot] = Math.min(1, field.store[cell]! * plantScale);
    const held = creatures.held[i]!;
    inputs[Input.HoldingTool] = held === Held.Stone ? 1 : held === Held.Branch ? -1 : 0;
    inputs[Input.HoldingBlock] = held === Held.Block ? 1 : 0;
    inputs[Input.HoldingFood] =
      held === Held.Plants || held === Held.Meat
        ? Math.min(1, creatures.heldEnergy[i]! / (config.biteSize * creatures.size[i]! ** 2 * config.carryMouthfuls))
        : 0;
    inputs[Input.ScentSide] = Math.min(1, scentRight) - Math.min(1, scentLeft);
    // The cell it faces, where Hold lifts and sets down blocks; one cell's length ahead, as in the world.
    let frontX = x + cosHeading * field.cellWidth;
    let frontY = y + sinHeading * field.cellHeight;
    frontX = wrapNear(frontX, worldWidth);
    frontY = wrapNear(frontY, worldHeight);
    const front = cellIndexAt(field, frontX, frontY);
    inputs[Input.Facing] = front !== cell && field.blocks[front] ? (field.blockHeavy[front] === 1 ? -1 : 1) : 0;
    inputs[Input.Sheltered] = config.shelter > 0 && field.nearBlocks[cell]! > 0 ? 1 : 0;

    // Hearing: how loud calls are one sound cell to the left and to the right.
    if (config.hearing) {
      const { sound } = this;
      const reach = config.soundCellSize;
      let leftX = x + sinHeading * reach;
      let leftY = y - cosHeading * reach;
      let rightX = x - sinHeading * reach;
      let rightY = y + cosHeading * reach;
      leftX = wrapNear(leftX, worldWidth);
      leftY = wrapNear(leftY, worldHeight);
      rightX = wrapNear(rightX, worldWidth);
      rightY = wrapNear(rightY, worldHeight);
      const leftCell = soundCellAt(sound, leftX, leftY);
      const rightCell = soundCellAt(sound, rightX, rightY);
      // A caller does not hear its own call: what it added is taken back out.
      let ownLeft = 0;
      let ownRight = 0;
      if (creatures.calling[i] === 1) {
        const own = soundCellAt(sound, x, y);
        ownLeft = callShare(sound, own, leftCell);
        ownRight = callShare(sound, own, rightCell);
      }
      inputs[Input.HearLeft] = Math.min(1, Math.max(0, sound.loudness[leftCell]! - ownLeft));
      inputs[Input.HearRight] = Math.min(1, Math.max(0, sound.loudness[rightCell]! - ownRight));
    } else {
      inputs[Input.HearLeft] = 0;
      inputs[Input.HearRight] = 0;
    }
    inputs[Input.Energy] = creatures.energy[i]! / maxEnergyFor(creatures.size[i]!, config);
    inputs[Input.Health] = creatures.health[i]!;
    inputs[Input.Thirst] = 1 - creatures.hydration[i]!;
    inputs[Input.Age] = creatures.age[i]! / config.maxAge;
    inputs[Input.Sick] = creatures.sick[i]! > 0 ? 1 : 0;
    inputs[Input.Clock] = this.clock;
    inputs[Input.Season] = this.season;
    inputs[Input.Daylight] = this.daylight;
    if (config.temperatureStrength > 0) {
      const warmthHere = temperatureAt(field, cell, this.warmth, config, this.dayWarmth);
      let aheadX = x + cosHeading * range;
      let aheadY = y + sinHeading * range;
      aheadX = wrapNear(aheadX, worldWidth);
      aheadY = wrapNear(aheadY, worldHeight);
      const ahead = temperatureAt(field, cellIndexAt(field, aheadX, aheadY), this.warmth, config, this.dayWarmth);
      // To the sides, at the ends of the left and right rays.
      const sideX = cosHeading * this.cosSpread * range;
      const sideY = sinHeading * this.cosSpread * range;
      const turnX = sinHeading * this.sinSpread * range;
      const turnY = cosHeading * this.sinSpread * range;
      const right = this.warmthAt(x + sideX - turnX, y + sideY + turnY);
      const left = this.warmthAt(x + sideX + turnX, y + sideY - turnY);
      inputs[Input.Temperature] = Math.max(-1, Math.min(1, warmthHere));
      inputs[Input.WarmerAhead] = Math.max(-1, Math.min(1, (ahead - warmthHere) * WARMER_GAIN));
      inputs[Input.WarmerSide] = Math.max(-1, Math.min(1, (right - left) * WARMER_GAIN));
    } else {
      inputs[Input.Temperature] = 0;
      inputs[Input.WarmerAhead] = 0;
      inputs[Input.WarmerSide] = 0;
    }
    inputs[Input.EnergyTrend] = Math.max(-1, Math.min(1, creatures.trend[i]! * TREND_GAIN));
    inputs[Input.Bias] = 1;
  }

  /** The temperature felt at a point, which may lie outside the world and is wrapped into it. */
  private warmthAt(px: number, py: number): number {
    const { config, field } = this;
    px = wrapNear(px, config.worldWidth);
    py = wrapNear(py, config.worldHeight);
    return temperatureAt(field, cellIndexAt(field, px, py), this.warmth, config, this.dayWarmth);
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
      // Out of sight, but close enough to feel, and on which side.
      if (distance < this.nearestBehind) {
        this.nearestBehind = distance;
        this.behindIndex = j;
        this.behindSide = (dy * this.cosHeading - dx * this.sinHeading) / distance;
      }
      return;
    }

    // A creature in the cover of a forest, or the colour of the ground it
    // stands on, cannot be seen from as far.
    const theirCell = cellIndexAt(this.field, creatures.x[j]!, creatures.y[j]!);
    let seen = BIOME_TRAITS[this.field.biome[theirCell]!]!.cover;
    if (config.camouflage > 0) {
      seen *= visibility(creatures.hue[j]!, groundHue(this.field, theirCell, config), config.camouflage);
    }
    // A wall in the way hides a creature; a block wholly or in part: a ring of them is a pen.
    const obstacle = obstacleBetween(this.field, this.x, this.y, dx, dy, config.worldWidth, config.worldHeight);
    if (obstacle === Obstacle.Wall) return;
    if (obstacle === Obstacle.Block) seen *= 1 - config.blockCover;
    if (distance > this.range * seen) return;

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
    const colour = TWO_PI * creatures.hue[j]!;
    inputs[o + Ray.ColourWarm] = Math.cos(colour);
    inputs[o + Ray.ColourGreen] = Math.sin(colour);
    inputs[o + Ray.Display] = creatures.display[j]!;
    if (!config.socialSenses) return;
    // Plant-eaters read below zero and meat-eaters above, so neither looks like "nobody there".
    inputs[o + Ray.MeatEater] = creatures.diet[j]! * 2 - 1;
    // How squarely the other is facing this way: 1 is head-on, -1 is directly away.
    const theirHeading = creatures.heading[j]!;
    inputs[o + Ray.Approaching] = -(Math.cos(theirHeading) * dx + Math.sin(theirHeading) * dy) / distance;
    inputs[o + Ray.Hurt] = 1 - Math.max(0, creatures.health[j]!);
    inputs[o + Ray.Sick] = creatures.sick[j]! > 0 ? 1 : 0;
  };
}
