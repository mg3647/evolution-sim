<script lang="ts">
  import { BIOME_LABELS } from '../sim/biomes';
  import { HELD_LABELS } from '../sim/creatures';
  import { INPUT_LABELS, OUTPUT_LABELS } from '../sim/brain';
  import { speciesHue } from '../render/renderer';
  import type { Inspection } from '../worker/protocol';
  import BrainGraph from './BrainGraph.svelte';
  import { INPUT_GROUPS, SENSE_GROUP_HINTS, SENSE_GROUPS } from './senseGroups';
  import { Input } from '../sim/brain';

  let { creature }: { creature: Inspection | null } = $props();

  /** A reading weaker than this is left out of the bars. */
  const SHOWN = 0.005;

  /** What it senses right now, by group, strongest first. The bias never changes, so it is left out. */
  const sensed = $derived(
    SENSE_GROUPS.map((group) => ({
      group,
      readings: creature
        ? creature.inputs
            .map((value, input) => ({ value, input, label: INPUT_LABELS[input]! }))
            .filter((r) => INPUT_GROUPS[r.input] === group && r.input !== Input.Bias && Math.abs(r.value) >= SHOWN)
            .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        : [],
    })),
  );
  /** What it is doing right now, strongest first; actions that do nothing here go last. */
  const doing = $derived(
    creature
      ? creature.outputs
          .map((value, k) => ({ value, label: OUTPUT_LABELS[k]!, idle: creature.idleOutputs[k] ?? null }))
          .sort((a, b) => Number(a.idle !== null) - Number(b.idle !== null) || Math.abs(b.value) - Math.abs(a.value))
      : [],
  );

  function dietName(diet: number): string {
    if (diet < 0.25) return 'plants';
    if (diet > 0.75) return 'meat';
    return 'both';
  }

  /** Width and offset of a bar for a value in [-1, 1], drawn from a centre line. */
  function bar(value: number): string {
    const clamped = Math.max(-1, Math.min(1, value));
    const half = Math.abs(clamped) * 50;
    return `left: ${clamped < 0 ? 50 - half : 50}%; width: ${half}%;`;
  }
</script>

<section>
  <h2>Selected creature</h2>
  {#if creature}
    <dl>
      <div><dt>Id</dt><dd>{creature.id}</dd></div>
      <div><dt>Generation</dt><dd>{creature.generation}</dd></div>
      <div title="The group of alike creatures it belongs to; see the Evolution tab">
        <dt>Species</dt>
        <dd>
          <span class="swatch" style="background: hsl({speciesHue(creature.species) * 360}, 70%, 60%)"></span>
          {creature.species}
        </dd>
      </div>
      <div><dt>Age</dt><dd>{creature.age.toLocaleString()}</dd></div>
      <div>
        <dt>Energy</dt>
        <dd>{creature.energy.toFixed(1)} / {creature.maxEnergy.toFixed(0)}</dd>
      </div>
      <div><dt>Size</dt><dd>{creature.size.toFixed(2)}</dd></div>
      <div><dt>Speed</dt><dd>{creature.speed.toFixed(2)}</dd></div>
      <div><dt>Health</dt><dd>{Math.round(creature.health * 100)}%</dd></div>
      <div title="Water in its body. It drinks in or beside water, and dies of thirst at 0%">
        <dt>Water</dt>
        <dd>{Math.round(creature.hydration * 100)}%</dd>
      </div>
      <div title="Sick creatures move slower, burn more energy and may die; survivors are immune for a while">
        <dt>Plague</dt>
        <dd>{creature.sick > 0 ? 'sick' : creature.sick < 0 ? 'immune' : 'healthy'}</dd>
      </div>
      <div title="0 eats only plants, 1 eats only meat">
        <dt>Diet</dt>
        <dd>{creature.diet.toFixed(2)} ({dietName(creature.diet)})</dd>
      </div>
      <div><dt>Sensor range</dt><dd>{creature.sensorRange.toFixed(2)}</dd></div>
      <div title="Thickness of its coat, from 0 to 1. Fur keeps cold out, makes heat worse, and costs energy to grow.">
        <dt>Fur</dt>
        <dd>{creature.fur.toFixed(2)}</dd>
      </div>
      <div title="Spines or poison, from 0 to 1. Whatever bites it loses health in return. Costs energy to keep.">
        <dt>Defenses</dt>
        <dd>{creature.defense.toFixed(2)}</dd>
      </div>
      <div title="One thing at a time: a stone makes its bite stronger, a branch takes part of bites aimed at it, and food can be set down elsewhere as a store">
        <dt>Holding</dt>
        <dd>{HELD_LABELS[creature.held]}{creature.heldEnergy > 0 ? ` (${creature.heldEnergy.toFixed(1)})` : ''}</dd>
      </div>
      <div title="The kind of land it is standing on"><dt>Biome</dt><dd>{BIOME_LABELS[creature.biome]}</dd></div>
      <div title="How hot it is where it stands: -1 is freezing, 1 is scorching. It pays extra energy when this is beyond what its size and fur can bear.">
        <dt>Temperature</dt>
        <dd>
          {creature.temperature.toFixed(2)}
          ({creature.temperatureStress <= 0 ? 'comfortable' : creature.temperature < 0 ? 'too cold' : 'too hot'})
        </dd>
      </div>
      <div><dt>Mutation rate</dt><dd>{creature.mutationRate.toFixed(3)}</dd></div>
    </dl>

    <h3>Brain</h3>
    <p class="note">
      <b>{creature.links}</b>
      {creature.links === 1 ? 'link' : 'links'}: wires from a sense to an action, each a simple rule such as
      &ldquo;food on my right, turn right&rdquo;.
      <b>{creature.hiddenNeurons}</b>
      hidden {creature.hiddenNeurons === 1 ? 'neuron' : 'neurons'}: junctions that let it combine senses
      before acting. Children inherit the wiring with small random changes.
    </p>
    <BrainGraph brain={creature.brain} idle={creature.idleOutputs} live />

    <h3>What it is doing now</h3>
    <ul>
      {#each doing as action (action.label)}
        <li class:idle={action.idle !== null} title={action.idle ?? undefined}>
          <span>{action.label}{action.idle !== null ? ' (no effect)' : ''}</span>
          <span class="track"><span class="fill out" style={bar(action.value)}></span></span>
          <span class="value">{action.value.toFixed(2)}</span>
        </li>
      {/each}
    </ul>

    <h3>What it senses now</h3>
    <p class="note">Grouped, strongest first. Senses reading zero are left out.</p>
    {#each sensed as { group, readings } (group)}
      <div class="group" title={SENSE_GROUP_HINTS[group]}>
        <span class="group-name">{group}</span>
        {#if readings.length === 0}
          <span class="quiet">nothing</span>
        {:else}
          <ul>
            {#each readings as reading (reading.input)}
              <li>
                <span>{reading.label}</span>
                <span class="track"><span class="fill" style={bar(reading.value)}></span></span>
                <span class="value">{reading.value.toFixed(2)}</span>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    <details class="meanings">
      <summary>What the actions and senses mean</summary>
    <p class="note">
      Turn: left of centre is left, right is right. Thrust: far left is standing still, far right is full
      speed. Reproduce: right of centre means it splits once it has enough energy. Attack: right of centre
      means it bites the nearest creature in reach. Emit scent: right of centre means it leaves a scent on
      the ground that others can smell. Call: right of centre means it makes a sound others can hear from
      farther than they can see. Give: right of centre means it hands energy to the creature in front.
      Hold: right of centre means it picks up what is underfoot (a stone, a branch or a load of food), lifts
      a light block it faces while standing still, or pushes a block it walks into, and keeps hold; left of
      centre means it sets it down. Mate: right of centre means it is willing to breed with a willing
      creature in reach. Learn: speeds up, or below zero reverses, what its links learn. Eat: far left
      stops it eating. Display: right of centre shows a bright signal others can see, at a cost.
      Greyed-out actions do nothing for this creature in this world; hover one to see why.
    </p>
    <p class="note">
      Each of the three rays (left, ahead, right) reports the ground along it: plants, meat, water,
      wall, fire, stored food, a stone (right of centre) or branch (left), and a block (right of centre
      for a light one, left for a heavy one), each reading higher the more or the nearer it is. A ray
      stops at the first wall or block, so nothing behind one is seen. While swimming, water shows the
      way back to land.
    </p>
    <p class="note">
      Each ray also reports the nearest creature in its direction. &ldquo;Creature&rdquo; is how close it
      is. &ldquo;Kin&rdquo; is how closely its colour matches, so relatives read high. &ldquo;Bigger&rdquo;
      is right of centre if it is larger. &ldquo;Meat-eater&rdquo; is right of centre for a meat-eater
      and left for a plant-eater. &ldquo;Coming&rdquo; is right of centre if it is facing this way.
      &ldquo;Hurt&rdquo; rises as it is wounded, and &ldquo;Sick&rdquo; is on if it has the plague. The two colour senses give its actual colour:
      &ldquo;Red or cyan&rdquo; is right of centre for red, left for cyan; &ldquo;Green or violet&rdquo; is
      right for yellow-green, left for violet. All read zero when no creature is there.
    </p>
    <p class="note">
      &ldquo;Creature behind&rdquo; is how close the nearest creature out of sight is, &ldquo;Behind on
      the right&rdquo; which side it is on, and &ldquo;Meat-eater behind&rdquo; what it eats. &ldquo;Crowding&rdquo;
      counts creatures all around. &ldquo;Pain&rdquo; is how hard it was just bitten. &ldquo;Scent to the
      right&rdquo; is right of centre when scent is stronger on that side. &ldquo;Calls on the left&rdquo;
      and &ldquo;on the right&rdquo; are how loud other creatures' calls are on each side.
      &ldquo;Temperature&rdquo; is left of centre when cold and right when hot. &ldquo;Warmer ahead&rdquo; is
      right of centre if it is warmer straight ahead, and &ldquo;Warmer to the right&rdquo; if it is warmer
      on that side. &ldquo;Block in front&rdquo; is right of centre for a light block in the cell it faces
      (one it can lift) and left for a heavy one. &ldquo;Sheltered&rdquo; is on beside a block, where heat
      and cold cost less.
    </p>
    </details>
  {:else}
    <p>Click a creature in the world to inspect it.</p>
  {/if}
</section>

<style>
  h2,
  h3 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  h3 {
    margin-top: 10px;
    text-transform: none;
    letter-spacing: 0;
  }

  p {
    margin: 0;
    color: var(--muted);
  }

  .note {
    margin-bottom: 6px;
    font-size: 12px;
    line-height: 1.45;
  }

  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 4px;
    border-radius: 50%;
  }

  .note b {
    color: var(--text);
  }

  dl {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px 16px;
    margin: 0;
  }

  dl div {
    display: flex;
    justify-content: space-between;
    gap: 8px;
  }

  dt {
    color: var(--muted);
  }

  dd {
    margin: 0;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
    font-size: 12px;
  }

  li {
    display: grid;
    grid-template-columns: 8.5em 1fr 3em;
    align-items: center;
    gap: 8px;
    line-height: 1.5;
  }

  .group {
    margin-bottom: 6px;
    padding-left: 8px;
    border-left: 2px solid var(--border);
  }

  .group-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  li.idle {
    opacity: 0.45;
  }

  .quiet {
    margin-left: 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .meanings {
    margin-top: 8px;
  }

  .meanings summary {
    cursor: pointer;
    margin-bottom: 6px;
    font-size: 12px;
    color: var(--muted);
  }

  .track {
    position: relative;
    height: 6px;
    background: #1b2530;
    border-radius: 3px;
    /* Centre line marks zero. */
    background-image: linear-gradient(var(--border), var(--border));
    background-size: 1px 100%;
    background-position: center;
    background-repeat: no-repeat;
  }

  .fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: #6cb6ff;
    border-radius: 3px;
  }

  .fill.out {
    background: #e8c468;
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }
</style>
