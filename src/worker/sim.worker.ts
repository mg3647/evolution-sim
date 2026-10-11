import { BIOME_COUNT } from '../sim/biomes';
import { enabledLinks, INPUT_COUNT, OUTPUT_COUNT } from '../sim/brain';
import type { SimConfig } from '../sim/config';
import { Held } from '../sim/creatures';
import { daylightAt } from '../sim/environment';
import { maxEnergyFor, temperatureStress } from '../sim/genome';
import { cellIndexAt, temperatureAt } from '../sim/plants';
import { RESTART_KEYS } from '../sim/presets';
import { brainProfile } from '../sim/profile';
import { BEHAVIOUR_DIET_BINS, BEHAVIOUR_SPEED_BINS, DENSITY_GRID } from '../sim/stats';
import { wrappedDelta } from '../sim/geometry';
import { loadWorld, saveWorld, type SavedWorld } from '../sim/serialize';
import { applyTool, clearWorldWalls, triggerWorldEvent, type World } from '../sim/world';
import {
  CREATURE_STRIDE,
  DIET_BINS,
  type FromWorker,
  type HistoryData,
  type LabData,
  type Inspection,
  type ProfileGroup,
  type Snapshot,
  type SpeciesView,
  type ToWorker,
  type TreeData,
} from './protocol';
import { SimRunner } from './runner';

/** Wall time per loop iteration spent ticking, leaving room for messages. */
const TICK_BUDGET_MS = 12;
/** The same, with drawing off: fewer, longer bursts of ticking. */
const TICK_BUDGET_UNDRAWN_MS = 40;
const SNAPSHOT_INTERVAL_MS = 1000 / 60;
const SNAPSHOT_INTERVAL_UNDRAWN_MS = 250;
const HISTORY_INTERVAL_MS = 250;
const TREE_INTERVAL_MS = 1000;
const TPS_WINDOW_MS = 500;
/** Species listed in a snapshot. */
const SPECIES_SHOWN = 8;
/** Founders listed in the Lab view. */
const FOUNDERS_SHOWN = 12;
/** Species drawn separately in the stream chart; smaller ones are summed. */
const STREAM_SPECIES = 12;
/** Species drawn separately in the chart of blocks moved. */
const BLOCK_SPECIES = 8;

let runner: SimRunner | null = null;
let loopTimer: ReturnType<typeof setTimeout> | null = null;
/** Id of the creature being inspected, or 0 for none. */
let selectedId = 0;
/** Whether snapshots carry the map and creatures for drawing. */
let rendering = true;
let lastSnapshotTime = 0;
let lastHistoryTime = 0;
let lastTreeTime = 0;
/** History version last sent, or -1 to force a send. */
let sentHistoryVersion = -1;
/** Tick of the tree last sent, or -1 to force a send. */
let sentTreeTick = -1;
let windowStart = 0;
let windowTicks = 0;
let measuredTps = 0;

function post(message: FromWorker, transfer: Transferable[] = []): void {
  self.postMessage(message, { transfer });
}

/** Select the creature nearest (x, y) within `radius`, or clear the selection. */
function pick(world: World, x: number, y: number, radius: number): void {
  const { creatures: c, config } = world;
  let best = radius * radius;
  selectedId = 0;
  for (let i = 0; i < c.count; i++) {
    const dx = wrappedDelta(x, c.x[i]!, config.worldWidth);
    const dy = wrappedDelta(y, c.y[i]!, config.worldHeight);
    const d2 = dx * dx + dy * dy;
    if (d2 <= best) {
      best = d2;
      selectedId = c.id[i]!;
    }
  }
}

function inspect(world: World, i: number): Inspection {
  const { creatures: c, config } = world;
  const brain = c.brain[i]!;
  const cell = cellIndexAt(world.plants, c.x[i]!, c.y[i]!);
  const temperature = temperatureAt(world.plants, cell, world.climate.warmth, config, world.climate.dayWarmth);
  return {
    index: i,
    id: c.id[i]!,
    parentId: c.parentId[i]!,
    generation: c.generation[i]!,
    age: c.age[i]!,
    energy: c.energy[i]!,
    maxEnergy: maxEnergyFor(c.size[i]!, config),
    size: c.size[i]!,
    speed: c.speed[i]!,
    sensorRange: c.sensorRange[i]!,
    diet: c.diet[i]!,
    health: c.health[i]!,
    hydration: c.hydration[i]!,
    sick: c.sick[i]!,
    hue: c.hue[i]!,
    fur: c.fur[i]!,
    defense: c.defense[i]!,
    held: c.held[i]!,
    heldEnergy: c.heldEnergy[i]!,
    temperature,
    temperatureStress: temperatureStress(temperature, c.size[i]!, c.fur[i]!, config),
    biome: world.plants.biome[cell]!,
    mutationRate: c.mutationRate[i]!,
    hiddenNeurons: brain.hiddenIds.length,
    links: enabledLinks(brain),
    inputs: Array.from(brain.activation.subarray(0, INPUT_COUNT)),
    outputs: Array.from(brain.activation.subarray(INPUT_COUNT, INPUT_COUNT + OUTPUT_COUNT)),
    species: c.species[i]!,
    brain: {
      hiddenCount: brain.hiddenIds.length,
      activation: Array.from(brain.activation),
      linkFrom: Array.from(brain.linkFrom),
      linkTo: Array.from(brain.linkTo),
      linkWeight: Array.from(brain.linkWeight),
    },
  };
}

/** Tally the living members of each species, largest first. */
function speciesViews(world: World): SpeciesView[] {
  const { creatures: c } = world;
  const tallies = new Map<number, { count: number; size: number; speed: number; diet: number }>();
  for (let i = 0; i < c.count; i++) {
    let tally = tallies.get(c.species[i]!);
    if (!tally) {
      tally = { count: 0, size: 0, speed: 0, diet: 0 };
      tallies.set(c.species[i]!, tally);
    }
    tally.count++;
    tally.size += c.size[i]!;
    tally.speed += c.speed[i]!;
    tally.diet += c.diet[i]!;
  }
  const bornTicks = new Map(world.species.species.map((record) => [record.id, record.bornTick]));
  return [...tallies]
    .map(([id, tally]) => ({
      id,
      count: tally.count,
      bornTick: bornTicks.get(id) ?? world.tick,
      meanSize: tally.size / tally.count,
      meanSpeed: tally.speed / tally.count,
      meanDiet: tally.diet / tally.count,
    }))
    .sort((a, b) => b.count - a.count || a.id - b.id)
    .slice(0, SPECIES_SHOWN);
}

function sendSnapshot(now: number): void {
  if (!runner) return;
  const { world } = runner;
  const { config, creatures: c, plants: p } = world;

  const creatures = new Float32Array(rendering ? c.count * CREATURE_STRIDE : 0);
  let sizeTotal = 0;
  let speedTotal = 0;
  let senseTotal = 0;
  let dietTotal = 0;
  let furTotal = 0;
  let defenseTotal = 0;
  const holding = { branch: 0, stone: 0, food: 0, block: 0 };
  let meatEaters = 0;
  let infected = 0;
  let maxGeneration = 0;
  let selected: Inspection | null = null;
  for (let i = 0; i < c.count; i++) {
    const size = c.size[i]!;
    if (rendering) {
      const o = i * CREATURE_STRIDE;
      creatures[o] = c.x[i]!;
      creatures[o + 1] = c.y[i]!;
      creatures[o + 2] = c.heading[i]!;
      creatures[o + 3] = c.energy[i]! / maxEnergyFor(size, config);
      creatures[o + 4] = config.creatureRadius * size;
      creatures[o + 5] = c.hue[i]!;
      creatures[o + 6] = c.diet[i]!;
      creatures[o + 7] = Math.sign(c.sick[i]!);
      creatures[o + 8] = c.species[i]!;
      creatures[o + 9] = c.calling[i]!;
      creatures[o + 10] = c.defense[i]!;
      creatures[o + 11] = c.id[i]!;
    }
    if (c.sick[i]! > 0) infected++;
    dietTotal += c.diet[i]!;
    furTotal += c.fur[i]!;
    defenseTotal += c.defense[i]!;
    if (c.held[i] === Held.Branch) holding.branch++;
    else if (c.held[i] === Held.Stone) holding.stone++;
    else if (c.held[i] === Held.Block) holding.block++;
    else if (c.held[i] !== Held.Nothing) holding.food++;
    if (c.diet[i]! > 0.5) meatEaters++;
    sizeTotal += size;
    speedTotal += c.speed[i]!;
    senseTotal += c.sensorRange[i]!;
    if (selectedId !== 0 && c.id[i] === selectedId) selected = inspect(world, i);
    if (c.generation[i]! > maxGeneration) maxGeneration = c.generation[i]!;
  }

  const cells = rendering ? p.energy.length : 0;
  const plants = new Uint8Array(cells);
  const meat = new Uint8Array(cells);
  const scent = new Uint8Array(cells);
  const temperature = new Uint8Array(cells);
  const fire = new Uint8Array(cells);
  const ash = new Uint8Array(cells);
  const items = new Uint8Array(cells);
  const blocks = new Uint8Array(cells);
  const blockSpecies = new Uint32Array(cells);
  let blockTotal = 0;
  let blockBuilt = 0;
  for (let i = 0; i < p.blocks.length; i++) {
    blockTotal += p.blocks[i]!;
    blockBuilt += p.blockBuilt[i]!;
  }
  for (let i = 0; i < cells; i++) {
    // 1 block, 2 moved by a creature, 3 heavy, 4 heavy and moved.
    blocks[i] = p.blocks[i] === 0 ? 0 : p.blockHeavy[i]! * 2 + 1 + p.blockBuilt[i]!;
    blockSpecies[i] = p.blockSpecies[i]!;
    fire[i] = p.fire[i]! > 0 ? 1 : 0;
    ash[i] = p.ash[i]! * 255;
    items[i] = (p.branches[i]! > 0 ? 1 : 0) | (p.stones[i]! > 0 ? 2 : 0) | (p.store[i]! >= 1 ? 4 : 0);
    const heat = temperatureAt(p, i, world.climate.warmth, config, world.climate.dayWarmth);
    temperature[i] = Math.max(0, Math.min(1, (heat + 1.5) / 3)) * 255;
    // Rich biomes hold more than the plain capacity; they draw as fully grown.
    plants[i] = Math.min(1, p.energy[i]! / config.plantCapacity) * 255;
    meat[i] = Math.min(1, p.meat[i]! / config.meatScale) * 255;
    scent[i] = Math.min(1, p.scent[i]!) * 255;
  }
  let plantEnergy = 0;
  for (let i = 0; i < p.energy.length; i++) plantEnergy += p.energy[i]!;

  const snapshot: Snapshot = {
    config,
    tick: world.tick,
    running: runner.running,
    speed: runner.speed,
    measuredTps: runner.running ? measuredTps : 0,
    population: c.count,
    creatures,
    meanSize: c.count > 0 ? sizeTotal / c.count : 0,
    meanSpeed: c.count > 0 ? speedTotal / c.count : 0,
    meanSensorRange: c.count > 0 ? senseTotal / c.count : 0,
    meanDiet: c.count > 0 ? dietTotal / c.count : 0,
    meanFur: c.count > 0 ? furTotal / c.count : 0,
    meanDefense: c.count > 0 ? defenseTotal / c.count : 0,
    meatEaters,
    maxGeneration,
    plantCols: p.cols,
    plantRows: p.rows,
    plants,
    plantFill: world.plantCapacityTotal > 0 ? plantEnergy / world.plantCapacityTotal : 0,
    meat,
    scent,
    walls: rendering ? p.walls.slice() : new Uint8Array(0),
    water: rendering ? p.water.slice() : new Uint8Array(0),
    temperature,
    biome: rendering ? p.biome.slice() : new Uint8Array(0),
    fire,
    ash,
    items,
    fires: { ...world.fires },
    blocks,
    blockSpecies,
    blockInfo: {
      total: blockTotal,
      built: blockBuilt,
      pushed: world.blockTally.pushed,
      setDown: world.blockTally.setDown,
      longestLine: world.history.count > 0 ? world.history.longestBuiltLine[world.history.count - 1]! : 0,
    },
    holding,
    carry: { ...world.carry },
    environment: {
      season: world.climate.season,
      yearFraction: config.seasonLength > 0 ? (world.tick % config.seasonLength) / config.seasonLength : 0,
      daylight: daylightAt(world.tick, config),
      growth: world.climate.growth,
      cost: world.climate.cost,
      warmth: world.climate.warmth,
      active: world.environment.active.map((event) => ({
        kind: event.kind,
        remaining: event.endTick - world.tick,
      })),
      randomEvents: world.environment.randomEvents,
      infected,
      log: world.environment.log.slice(),
    },
    births: world.births,
    reseeded: world.reseeded,
    social: { ...world.social },
    deaths: { ...world.deaths },
    selected,
    rendered: rendering,
    species: speciesViews(world),
  };
  post({ type: 'snapshot', snapshot }, [creatures.buffer, plants.buffer, meat.buffer, scent.buffer, temperature.buffer, fire.buffer, ash.buffer, items.buffer, blocks.buffer, blockSpecies.buffer]);
  lastSnapshotTime = now;
}

/** The per-species series with the largest totals, largest first, and the rest summed under id 0. */
function topSeries(
  perSpecies: Map<number, Float32Array>,
  count: number,
  shown: number,
): { id: number; counts: Float32Array }[] {
  const ranked = [...perSpecies]
    .map(([id, series]) => {
      let total = 0;
      for (let k = 0; k < count; k++) total += series[k]!;
      return { id, series, total };
    })
    .sort((a, b) => b.total - a.total || a.id - b.id);
  const top = ranked.slice(0, shown).map((entry) => ({ id: entry.id, counts: entry.series.slice(0, count) }));
  if (ranked.length > shown) {
    const others = new Float32Array(count);
    for (const entry of ranked.slice(shown)) for (let k = 0; k < count; k++) others[k]! += entry.series[k]!;
    top.push({ id: 0, counts: others });
  }
  return top;
}

/** Send the history if it changed since it was last sent. */
function sendHistory(now: number): void {
  if (!runner) return;
  const h = runner.world.history;
  if (h.version === sentHistoryVersion) return;
  const history: HistoryData = {
    tick: h.tick.slice(0, h.count),
    population: h.population.slice(0, h.count),
    plantPercent: h.plantFill.slice(0, h.count).map((fill) => fill * 100),
    meanSize: h.meanSize.slice(0, h.count),
    meanSpeed: h.meanSpeed.slice(0, h.count),
    meanSensorRange: h.meanSensorRange.slice(0, h.count),
    meanDiet: h.meanDiet.slice(0, h.count),
    meanFur: h.meanFur.slice(0, h.count),
    meanDefense: h.meanDefense.slice(0, h.count),
    toolHolders: h.toolHolders.slice(0, h.count),
    foodHolders: h.foodHolders.slice(0, h.count),
    meatEaters: h.meatEaters.slice(0, h.count),
    speciesCount: h.speciesCount.slice(0, h.count),
    meanLinks: h.meanLinks.slice(0, h.count),
    meanNeurons: h.meanNeurons.slice(0, h.count),
    parentSize: h.parentSize.slice(0, h.count),
    parentSpeed: h.parentSpeed.slice(0, h.count),
    parentSensorRange: h.parentSensorRange.slice(0, h.count),
    parentDiet: h.parentDiet.slice(0, h.count),
    diversity: h.diversity.slice(0, h.count),
    spreadSize: h.spreadSize.slice(0, h.count),
    spreadSpeed: h.spreadSpeed.slice(0, h.count),
    spreadSensorRange: h.spreadSensorRange.slice(0, h.count),
    spreadDiet: h.spreadDiet.slice(0, h.count),
    spreadFur: h.spreadFur.slice(0, h.count),
    spreadDefense: h.spreadDefense.slice(0, h.count),
    deathsStarved: h.deathsStarved.slice(0, h.count),
    deathsOldAge: h.deathsOldAge.slice(0, h.count),
    deathsKilled: h.deathsKilled.slice(0, h.count),
    deathsTemperature: h.deathsTemperature.slice(0, h.count),
    deathsThirst: h.deathsThirst.slice(0, h.count),
    deathsOther: h.deathsOther.slice(0, h.count),
    flowPlantsToPlantEaters: h.flowPlantsToPlantEaters.slice(0, h.count),
    flowPlantsToMeatEaters: h.flowPlantsToMeatEaters.slice(0, h.count),
    flowMeatToPlantEaters: h.flowMeatToPlantEaters.slice(0, h.count),
    flowMeatToMeatEaters: h.flowMeatToMeatEaters.slice(0, h.count),
    lifespan: h.lifespan.slice(0, h.count),
    firstBirthAge: h.firstBirthAge.slice(0, h.count),
    offspring: h.offspring.slice(0, h.count),
    generationLength: h.generationLength.slice(0, h.count),
    shareResting: h.shareResting.slice(0, h.count),
    shareForaging: h.shareForaging.slice(0, h.count),
    shareChasing: h.shareChasing.slice(0, h.count),
    shareFleeing: h.shareFleeing.slice(0, h.count),
    blockMoveRate: h.blockMoveRate.slice(0, h.count),
    longestBuiltLine: h.longestBuiltLine.slice(0, h.count),
    builtBlocks: h.builtBlocks.slice(0, h.count),
    shelteredShare: h.shelteredShare.slice(0, h.count),
    blockHolders: h.blockHolders.slice(0, h.count),
    meanPlasticity: h.meanPlasticity.slice(0, h.count),
    plasticLinkShare: h.plasticLinkShare.slice(0, h.count),
    meanTau: h.meanTau.slice(0, h.count),
    slowNeuronShare: h.slowNeuronShare.slice(0, h.count),
    wiringLive: h.wiringLive.slice(0, h.count),
    wiringShadowLive: h.wiringShadowLive.slice(0, h.count),
    wiringActivity: h.wiringActivity.slice(0, h.count),
    wiringShadowActivity: h.wiringShadowActivity.slice(0, h.count),
    wiringSurvival: h.wiringSurvival.slice(0, h.count),
    wiringShadowSurvival: h.wiringShadowSurvival.slice(0, h.count),
    recurrentShare: h.recurrentShare.slice(0, h.count),
    blockMoves: [],
    species: [],
  };
  history.blockMoves = topSeries(h.blockMoves, h.count, BLOCK_SPECIES);
  // The species with the most member-samples are drawn separately; the rest are summed.
  const ranked = [...h.species]
    .map(([id, series]) => {
      let total = 0;
      for (let k = 0; k < h.count; k++) total += series[k]!;
      return { id, series, total };
    })
    .sort((a, b) => b.total - a.total || a.id - b.id);
  const others = new Float32Array(h.count);
  ranked.forEach((entry, rank) => {
    if (rank < STREAM_SPECIES) history.species.push({ id: entry.id, counts: entry.series.slice(0, h.count) });
    else for (let k = 0; k < h.count; k++) others[k]! += entry.series[k]!;
  });
  if (ranked.length > STREAM_SPECIES) history.species.push({ id: 0, counts: others });
  post({ type: 'history', history });
  sentHistoryVersion = h.version;
  lastHistoryTime = now;
}

/** Send the family tree if the world has moved on since it was last sent. */
function sendTree(now: number): void {
  if (!runner) return;
  const { world } = runner;
  if (world.tick === sentTreeTick) return;
  const nodes = [...world.lineage.all()];
  const indexOf = new Map(nodes.map((node, k) => [node.id, k]));
  const tree: TreeData = {
    tick: world.tick,
    parent: new Int32Array(nodes.length),
    birthTick: new Float64Array(nodes.length),
    deathTick: new Float64Array(nodes.length),
    hue: new Float32Array(nodes.length),
    species: new Uint32Array(nodes.length),
    id: new Uint32Array(nodes.length),
    founder: new Uint32Array(nodes.length),
  };
  const founderOf = new Map<number, number>();
  for (let i = 0; i < world.creatures.count; i++) founderOf.set(world.creatures.id[i]!, world.creatures.founder[i]!);
  nodes.forEach((node, k) => {
    tree.id[k] = node.id;
    tree.founder[k] = founderOf.get(node.id) ?? 0;
    tree.parent[k] = indexOf.get(node.parentId) ?? -1;
    tree.birthTick[k] = node.birthTick;
    tree.deathTick[k] = node.deathTick;
    tree.hue[k] = node.hue;
    tree.species[k] = node.species;
  });
  post({ type: 'tree', tree }, [
    tree.parent.buffer,
    tree.birthTick.buffer,
    tree.deathTick.buffer,
    tree.hue.buffer,
    tree.species.buffer,
    tree.id.buffer,
    tree.founder.buffer,
  ]);
  sentTreeTick = world.tick;
  lastTreeTime = now;
  // Profiles change as slowly as the tree does, so they go out together.
  sendProfiles();
}

/** Send brain profiles for plant-eaters, meat-eaters and the largest species. */
function sendProfiles(): void {
  if (!runner) return;
  const { creatures: c } = runner.world;
  const plants: number[] = [];
  const meat: number[] = [];
  const bySpecies = new Map<number, number[]>();
  for (let i = 0; i < c.count; i++) {
    (c.diet[i]! > 0.5 ? meat : plants).push(i);
    const members = bySpecies.get(c.species[i]!);
    if (members) members.push(i);
    else bySpecies.set(c.species[i]!, [i]);
  }
  const largest = [...bySpecies].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]).slice(0, SPECIES_SHOWN);
  const groups: ProfileGroup[] = [
    { id: 'plants', speciesId: 0, profile: brainProfile(c, plants) },
    { id: 'meat', speciesId: 0, profile: brainProfile(c, meat) },
    ...largest.map(([speciesId, members]) => ({
      id: `species-${speciesId}`,
      speciesId,
      profile: brainProfile(c, members),
    })),
  ];
  post({ type: 'profiles', groups });
  sendLab();
}

/** Send the numbers only the Lab view shows: which founders' descendants are alive. */
function sendLab(): void {
  if (!runner) return;
  const { world } = runner;
  const { creatures: c } = world;
  const tallies = new Map<number, { count: number; hueX: number; hueY: number; diet: number }>();
  for (let i = 0; i < c.count; i++) {
    let tally = tallies.get(c.founder[i]!);
    if (!tally) {
      tally = { count: 0, hueX: 0, hueY: 0, diet: 0 };
      tallies.set(c.founder[i]!, tally);
    }
    tally.count++;
    // Hue is a circle, so it is averaged as a direction.
    tally.hueX += Math.cos(c.hue[i]! * Math.PI * 2);
    tally.hueY += Math.sin(c.hue[i]! * Math.PI * 2);
    tally.diet += c.diet[i]!;
  }
  const land = new Array<number>(BIOME_COUNT).fill(0);
  const { plants: p } = world;
  for (let cell = 0; cell < p.biome.length; cell++) if (p.water[cell] === 0) land[p.biome[cell]!]!++;
  const landTotal = Math.max(1, land.reduce((a, b) => a + b, 0));
  const biomes = land.map((cells) => ({
    land: cells / landTotal,
    count: 0,
    meanSize: 0,
    meanSpeed: 0,
    meanFur: 0,
    meanDefense: 0,
    meanDiet: 0,
  }));
  for (let i = 0; i < c.count; i++) {
    const biome = biomes[p.biome[cellIndexAt(p, c.x[i]!, c.y[i]!)]!]!;
    biome.count++;
    biome.meanSize += c.size[i]!;
    biome.meanSpeed += c.speed[i]!;
    biome.meanFur += c.fur[i]!;
    biome.meanDefense += c.defense[i]!;
    biome.meanDiet += c.diet[i]!;
  }
  for (const biome of biomes) {
    const count = Math.max(1, biome.count);
    biome.meanSize /= count;
    biome.meanSpeed /= count;
    biome.meanFur /= count;
    biome.meanDefense /= count;
    biome.meanDiet /= count;
  }
  const dietBins = new Array<number>(DIET_BINS).fill(0);
  for (let i = 0; i < c.count; i++) dietBins[Math.min(DIET_BINS - 1, Math.floor(c.diet[i]! * DIET_BINS))]!++;
  const density = world.history.density;
  const lab: LabData = {
    dietBins,
    behaviour: {
      dietBins: BEHAVIOUR_DIET_BINS,
      speedBins: BEHAVIOUR_SPEED_BINS,
      cells: world.history.behaviour.cells.map((counts) => {
        let samples = 0;
        let species = 0;
        let most = 0;
        for (const [id, n] of counts) {
          samples += n;
          if (n > most) {
            most = n;
            species = id;
          }
        }
        return { species, share: samples > 0 ? most / samples : 0, samples };
      }),
    },
    density: { grid: DENSITY_GRID, frames: density.frames.map((frame) => frame.slice()), ticks: density.ticks.slice() },
    biomes,
    tick: world.tick,
    population: c.count,
    foundersEver: world.config.initialCreatures + world.reseeded,
    foundersLiving: tallies.size,
    founders: [...tallies]
      .sort((a, b) => b[1].count - a[1].count || a[0] - b[0])
      .slice(0, FOUNDERS_SHOWN)
      .map(([id, tally]) => ({
        id,
        count: tally.count,
        hue: (Math.atan2(tally.hueY, tally.hueX) / (Math.PI * 2) + 1) % 1,
        meanDiet: tally.diet / tally.count,
      })),
  };
  post({ type: 'lab', lab });
}

function loop(): void {
  loopTimer = null;
  if (!runner || !runner.running) return;

  const now = performance.now();
  const budget = rendering ? TICK_BUDGET_MS : TICK_BUDGET_UNDRAWN_MS;
  windowTicks += runner.advance(now, () => performance.now(), budget);

  const after = performance.now();
  if (after - windowStart >= TPS_WINDOW_MS) {
    measuredTps = (windowTicks * 1000) / (after - windowStart);
    windowStart = after;
    windowTicks = 0;
  }
  const snapshotInterval = rendering ? SNAPSHOT_INTERVAL_MS : SNAPSHOT_INTERVAL_UNDRAWN_MS;
  if (after - lastSnapshotTime >= snapshotInterval) sendSnapshot(after);
  if (after - lastHistoryTime >= HISTORY_INTERVAL_MS) sendHistory(after);
  if (after - lastTreeTime >= TREE_INTERVAL_MS) sendTree(after);

  loopTimer = setTimeout(loop, 0);
}

function startLoop(): void {
  windowStart = performance.now();
  windowTicks = 0;
  if (loopTimer === null) loopTimer = setTimeout(loop, 0);
}

/** Forget everything tied to the previous world. */
function worldReplaced(): void {
  sentHistoryVersion = -1;
  sentTreeTick = -1;
  selectedId = 0;
}

self.onmessage = (event: MessageEvent<ToWorker>) => {
  const message = event.data;
  if (message.type === 'init') {
    const wasRunning = runner?.running ?? false;
    const speed = runner?.speed ?? 1;
    // The random-events switch belongs to the user, so it survives a restart.
    const randomEvents = runner?.world.environment.randomEvents ?? message.config.randomEvents;
    runner = new SimRunner(message.config);
    runner.world.environment.randomEvents = randomEvents;
    runner.setSpeed(speed);
    worldReplaced();
    if (wasRunning) {
      runner.play();
      startLoop();
    }
  } else if (!runner) {
    return;
  } else if (message.type === 'play') {
    runner.play();
    startLoop();
  } else if (message.type === 'pause') {
    runner.pause();
  } else if (message.type === 'step') {
    runner.stepTicks(message.ticks);
  } else if (message.type === 'setSpeed') {
    runner.setSpeed(message.speed);
  } else if (message.type === 'pick') {
    pick(runner.world, message.x, message.y, message.radius);
  } else if (message.type === 'event') {
    triggerWorldEvent(runner.world, message.kind);
    // While paused, run one tick so the event's deaths show at once.
    if (!runner.running) runner.stepTicks(1);
  } else if (message.type === 'tool') {
    applyTool(runner.world, message.tool, message.x, message.y, message.fromX, message.fromY);
    // While paused, run one tick so a meteor's deaths show at once.
    if (message.tool === 'meteor' && !runner.running) runner.stepTicks(1);
  } else if (message.type === 'clearWalls') {
    clearWorldWalls(runner.world);
  } else if (message.type === 'setRandomEvents') {
    runner.world.environment.randomEvents = message.enabled;
  } else if (message.type === 'setRendering') {
    rendering = message.enabled;
  } else if (message.type === 'setConfig') {
    const config = runner.world.config as unknown as Record<string, unknown>;
    for (const [key, value] of Object.entries(message.changes)) {
      if (!RESTART_KEYS.has(key as keyof SimConfig)) config[key] = value;
    }
  } else if (message.type === 'save') {
    const { world } = runner;
    post({ type: 'saved', json: JSON.stringify(saveWorld(world)), tick: world.tick, seed: world.config.seed });
    return;
  } else if (message.type === 'load') {
    try {
      runner.setWorld(loadWorld(JSON.parse(message.json) as SavedWorld));
      worldReplaced();
    } catch (error) {
      const reason = error instanceof SyntaxError ? 'This file is not a saved world.' : (error as Error).message;
      post({ type: 'error', message: `Could not load: ${reason}` });
      return;
    }
  }
  const now = performance.now();
  sendSnapshot(now);
  sendHistory(now);
  sendTree(now);
};
