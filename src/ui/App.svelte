<script lang="ts">
  import { onMount } from 'svelte';
  import type uPlot from 'uplot';
  import { WorldRenderer } from '../render/renderer';
  import { defaultConfig } from '../sim/config';
  import { SimClient } from '../worker/client';
  import type { HistoryData, Snapshot, Speed } from '../worker/protocol';
  import Chart, { type ChartSeries } from './Chart.svelte';
  import Inspector from './Inspector.svelte';

  const SPEEDS: { label: string; value: Speed }[] = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '4x', value: 4 },
    { label: '16x', value: 16 },
    { label: 'Max', value: 'max' },
  ];

  const POPULATION_SERIES: ChartSeries[] = [
    { label: 'Creatures', color: '#e8c468' },
    { label: 'Plants %', color: '#4caf50', axis: 'right' },
  ];
  const TRAIT_SERIES: ChartSeries[] = [
    { label: 'Mean size', color: '#6cb6ff' },
    { label: 'Mean speed', color: '#ff8f6b' },
    { label: 'Mean sensor range', color: '#b08cff' },
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

  const populationData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.population, history.plantPercent],
  );
  const traitData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanSize, history.meanSpeed, history.meanSensorRange],
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

  <div class="main">
    <div class="world" bind:this={host}></div>

    <aside>
      <dl>
        <div><dt>Creatures</dt><dd>{count(snapshot?.population)}</dd></div>
        <div><dt>Plants</dt><dd>{snapshot ? Math.round(snapshot.plantFill * 100) : '-'}%</dd></div>
        <div><dt>Mean size</dt><dd>{decimal(snapshot?.meanSize)}</dd></div>
        <div><dt>Mean speed</dt><dd>{decimal(snapshot?.meanSpeed)}</dd></div>
        <div><dt>Mean sensor range</dt><dd>{decimal(snapshot?.meanSensorRange)}</dd></div>
        <div><dt>Generation</dt><dd>{count(snapshot?.maxGeneration)}</dd></div>
        <div><dt>Births</dt><dd>{count(snapshot?.births)}</dd></div>
        <div><dt>Starved</dt><dd>{count(snapshot?.deaths.starved)}</dd></div>
        <div><dt>Died of old age</dt><dd>{count(snapshot?.deaths.oldAge)}</dd></div>
        <div
          title="Parentless creatures added because the population fell below the minimum"
        >
          <dt>Reseeded</dt>
          <dd>{count(snapshot?.reseeded)}</dd>
        </div>
      </dl>

      <Chart title="Population" series={POPULATION_SERIES} data={populationData} />
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
