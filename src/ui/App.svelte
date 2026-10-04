<script lang="ts">
  import { onMount } from 'svelte';
  import type uPlot from 'uplot';
  import { WorldRenderer } from '../render/renderer';
  import { defaultConfig } from '../sim/config';
  import { EVENT_KINDS, EVENT_LABELS, type EventKind } from '../sim/environment';
  import { SimClient } from '../worker/client';
  import type { HistoryData, Snapshot, Speed } from '../worker/protocol';
  import Chart, { type ChartSeries } from './Chart.svelte';
  import EnvironmentPanel from './EnvironmentPanel.svelte';
  import Inspector from './Inspector.svelte';

  const SPEEDS: { label: string; value: Speed }[] = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '4x', value: 4 },
    { label: '16x', value: 16 },
    { label: 'Max', value: 'max' },
  ];

  const EVENT_HINTS: Record<EventKind, string> = {
    drought: 'Plants grow at 15% of normal for 3,000 ticks',
    iceAge: 'Plants grow at 40% and living costs 40% more, for 8,000 ticks',
    foodBoom: 'Plants grow three times as fast for 3,000 ticks',
    plague: 'Kills about 90% of one colour family, chosen at random',
    meteor: 'Kills everything and burns the ground within a circle at a random spot',
    wall: 'Raises a wall that creatures cannot cross, at a random place',
  };

  const POPULATION_SERIES: ChartSeries[] = [
    { label: 'Creatures', color: '#e8c468' },
    { label: 'Plants %', color: '#4caf50', axis: 'right' },
  ];
  const TRAIT_SERIES: ChartSeries[] = [
    { label: 'Mean size', color: '#6cb6ff' },
    { label: 'Mean speed', color: '#ff8f6b' },
    { label: 'Mean sensor range', color: '#b08cff' },
  ];
  const DIET_SERIES: ChartSeries[] = [
    { label: 'Meat-eaters', color: '#e0566a' },
    { label: 'Mean diet', color: '#b08cff', axis: 'right' },
  ];
  const BRAIN_SERIES: ChartSeries[] = [
    { label: 'Mean links', color: '#e8c468' },
    { label: 'Mean hidden neurons', color: '#6cb6ff', axis: 'right' },
  ];

  let host: HTMLDivElement;
  let client: SimClient | undefined;
  let renderer: WorldRenderer | undefined;
  let snapshot = $state.raw<Snapshot | null>(null);
  let history = $state.raw<HistoryData | null>(null);
  let seed = $state(defaultConfig.seed);
  let showScent = $state(false);

  const populationData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.population, history.plantPercent],
  );
  const traitData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanSize, history.meanSpeed, history.meanSensorRange],
  );
  const dietData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meatEaters, history.meanDiet],
  );
  const brainData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanLinks, history.meanNeurons],
  );

  onMount(() => {
    let disposed = false;
    const r = new WorldRenderer();
    r.init(host).then(() => {
      if (disposed) {
        r.destroy();
        return;
      }
      renderer = r;
      client = new SimClient({
        onSnapshot: (s) => {
          snapshot = s;
          r.update(s);
        },
        onHistory: (h) => (history = h),
      });
      client.init({ ...defaultConfig, seed });
      r.onPick = (x, y, radius) => client?.pick(x, y, radius);
    });
    return () => {
      disposed = true;
      client?.destroy();
      renderer?.destroy();
    };
  });

  function togglePlay() {
    if (snapshot?.running) client?.pause();
    else client?.play();
  }

  function restart(event: SubmitEvent) {
    event.preventDefault();
    client?.init({ ...defaultConfig, seed });
  }

  function toggleScent() {
    if (!renderer) return;
    renderer.showScent = showScent;
    renderer.redraw();
  }

  function count(value: number | undefined): string {
    return value === undefined ? '-' : value.toLocaleString();
  }

  function decimal(value: number | undefined): string {
    return value === undefined ? '-' : value.toFixed(2);
  }
</script>

<div class="layout">
  <header>
    <strong>Evolution Sim</strong>

    <div class="group">
      <button onclick={togglePlay} disabled={!snapshot}>
        {snapshot?.running ? 'Pause' : 'Play'}
      </button>
      <button onclick={() => client?.step(1)} disabled={!snapshot || snapshot.running}>Step</button>
    </div>

    <div class="group" role="group" aria-label="Speed">
      {#each SPEEDS as option (option.label)}
        <button
          class:active={snapshot?.speed === option.value}
          onclick={() => client?.setSpeed(option.value)}
          disabled={!snapshot}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <form class="group" onsubmit={restart}>
      <label>
        Seed
        <input bind:value={seed} spellcheck="false" />
      </label>
      <button type="submit" disabled={!snapshot}>Restart</button>
    </form>

    <div class="stats">
      <span>Tick <b>{count(snapshot?.tick)}</b></span>
      <span><b>{count(snapshot ? Math.round(snapshot.measuredTps) : undefined)}</b> ticks/s</span>
    </div>

    <button onclick={() => renderer?.fitToView()} disabled={!snapshot}>Fit view</button>
  </header>

  <div class="events">
    <span class="label">Events</span>
    <div class="group">
      {#each EVENT_KINDS as kind (kind)}
        <button title={EVENT_HINTS[kind]} onclick={() => client?.triggerEvent(kind)} disabled={!snapshot}>
          {EVENT_LABELS[kind]}
        </button>
      {/each}
      <button
        title="Remove every wall"
        onclick={() => client?.clearWalls()}
        disabled={!snapshot || !snapshot.walls.includes(1)}
      >
        Clear walls
      </button>
    </div>
    <label title="Let events strike on their own, about once every 15,000 ticks">
      <input
        type="checkbox"
        checked={snapshot?.environment.randomEvents ?? false}
        onchange={(event) => client?.setRandomEvents(event.currentTarget.checked)}
        disabled={!snapshot}
      />
      Random events
    </label>
    <label title="Tint the ground purple where creatures have left scent">
      <input type="checkbox" bind:checked={showScent} onchange={toggleScent} />
      Show scent
    </label>
  </div>

  <div class="main">
    <div class="world" bind:this={host}></div>

    <aside>
      <dl>
        <div><dt>Creatures</dt><dd>{count(snapshot?.population)}</dd></div>
        <div><dt>Plants</dt><dd>{snapshot ? Math.round(snapshot.plantFill * 100) : '-'}%</dd></div>
        <div><dt>Mean size</dt><dd>{decimal(snapshot?.meanSize)}</dd></div>
        <div><dt>Mean speed</dt><dd>{decimal(snapshot?.meanSpeed)}</dd></div>
        <div><dt>Mean sensor range</dt><dd>{decimal(snapshot?.meanSensorRange)}</dd></div>
        <div title="Creatures whose diet gene is above 0.5; drawn as pointed shapes">
          <dt>Meat-eaters</dt>
          <dd>{count(snapshot?.meatEaters)}</dd>
        </div>
        <div title="0 eats only plants, 1 eats only meat">
          <dt>Mean diet</dt>
          <dd>{decimal(snapshot?.meanDiet)}</dd>
        </div>
        <div><dt>Generation</dt><dd>{count(snapshot?.maxGeneration)}</dd></div>
        <div><dt>Births</dt><dd>{count(snapshot?.births)}</dd></div>
        <div><dt>Starved</dt><dd>{count(snapshot?.deaths.starved)}</dd></div>
        <div><dt>Killed</dt><dd>{count(snapshot?.deaths.killed)}</dd></div>
        <div title="Deaths from plagues and meteors">
          <dt>Died in disasters</dt>
          <dd>{count(snapshot?.deaths.disaster)}</dd>
        </div>
        <div><dt>Died of old age</dt><dd>{count(snapshot?.deaths.oldAge)}</dd></div>
        <div
          title="Parentless creatures added because the population fell below the minimum"
        >
          <dt>Reseeded</dt>
          <dd>{count(snapshot?.reseeded)}</dd>
        </div>
      </dl>

      <EnvironmentPanel environment={snapshot?.environment ?? null} />

      <Chart title="Population" series={POPULATION_SERIES} data={populationData} />
      <Chart
        title="Diet"
        note="Meat-eaters are creatures that digest meat better than plants; they are drawn as pointed shapes. Mean diet runs from 0 (only plants) to 1 (only meat). Red ground is meat left by the dead."
        series={DIET_SERIES}
        data={dietData}
      />

      <Inspector creature={snapshot?.selected ?? null} />

      <Chart
        title="Traits"
        note="Average body genes. 1 is what the first generation starts with."
        series={TRAIT_SERIES}
        data={traitData}
      />
      <Chart
        title="Brains"
        note="Average brain wiring. Links are rules connecting a sense to an action; hidden neurons combine senses. Both cost energy, so brains grow only when the extra wiring pays for itself."
        series={BRAIN_SERIES}
        data={brainData}
      />
    </aside>
  </div>
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    padding: 8px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .events {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 16px;
    padding: 6px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .events .label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .events input {
    width: auto;
    padding: 0;
  }

  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  input {
    width: 9em;
  }

  .stats {
    display: flex;
    gap: 16px;
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .stats b {
    color: var(--text);
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .world {
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
  }

  .world:active {
    cursor: grabbing;
  }

  aside {
    width: 340px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 12px;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--border);
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

  @media (max-width: 800px) {
    .main {
      flex-direction: column;
    }

    aside {
      width: auto;
      max-height: 45%;
      border-left: none;
      border-top: 1px solid var(--border);
    }
  }
</style>
