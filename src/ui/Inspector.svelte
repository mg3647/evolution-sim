<script lang="ts">
  import { INPUT_LABELS, OUTPUT_LABELS } from '../sim/brain';
  import { speciesHue } from '../render/renderer';
  import type { Inspection } from '../worker/protocol';
  import BrainGraph from './BrainGraph.svelte';

  let { creature }: { creature: Inspection | null } = $props();

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
      <div title="Sick creatures move slower, burn more energy and may die; survivors are immune for a while">
        <dt>Plague</dt>
        <dd>{creature.sick > 0 ? 'sick' : creature.sick < 0 ? 'immune' : 'healthy'}</dd>
      </div>
      <div title="0 eats only plants, 1 eats only meat">
        <dt>Diet</dt>
        <dd>{creature.diet.toFixed(2)} ({dietName(creature.diet)})</dd>
      </div>
      <div><dt>Sensor range</dt><dd>{creature.sensorRange.toFixed(2)}</dd></div>
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
    <BrainGraph brain={creature.brain} />

    <h3>Brain outputs: what it is doing now</h3>
    <p class="note">
      Turn: left of centre is left, right is right. Thrust: far left is standing still, far right is full
      speed. Reproduce: right of centre means it splits once it has enough energy. Attack: right of centre
      means it bites the nearest creature in reach. Emit scent: right of centre means it leaves a scent on
      the ground that others can smell.
    </p>
    <ul>
      {#each OUTPUT_LABELS as label, k (label)}
        <li>
          <span>{label}</span>
          <span class="track"><span class="fill out" style={bar(creature.outputs[k] ?? 0)}></span></span>
          <span class="value">{(creature.outputs[k] ?? 0).toFixed(2)}</span>
        </li>
      {/each}
    </ul>

    <h3>Brain inputs: what it senses now</h3>
    <p class="note">
      For the nearest creature on each ray: &ldquo;Creature&rdquo; is how close it is, &ldquo;Kin&rdquo; is how
      closely its colour matches (relatives read high), &ldquo;Bigger&rdquo; is right of centre if it is
      larger, and &ldquo;Sick&rdquo; is whether it has the plague. &ldquo;Wall&rdquo; reads higher the nearer a
      wall is on that ray.
    </p>
    <ul>
      {#each INPUT_LABELS as label, k (label)}
        <li>
          <span>{label}</span>
          <span class="track"><span class="fill" style={bar(creature.inputs[k] ?? 0)}></span></span>
          <span class="value">{(creature.inputs[k] ?? 0).toFixed(2)}</span>
        </li>
      {/each}
    </ul>
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
