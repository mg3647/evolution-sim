<script lang="ts">
  import { onMount } from 'svelte';
  import type uPlot from 'uplot';
  import { WorldRenderer } from '../render/renderer';
  import { defaultConfig, type SimConfig } from '../sim/config';
  import { presetConfig, RESTART_KEYS, type Preset } from '../sim/presets';
  import { EVENT_LABELS, type TimedEventKind } from '../sim/environment';
  import type { ToolKind } from '../sim/world';
  import { SimClient } from '../worker/client';
  import type { HistoryData, ProfileGroup, Snapshot, Speed, TreeData } from '../worker/protocol';
  import BrainCompare from './BrainCompare.svelte';
  import Chart, { type ChartSeries } from './Chart.svelte';
  import EnvironmentPanel from './EnvironmentPanel.svelte';
  import Inspector from './Inspector.svelte';
  import LineageTree from './LineageTree.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import SpeciesList from './SpeciesList.svelte';

  type Tab = 'world' | 'creature' | 'evolution' | 'settings';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'world', label: 'World' },
    { id: 'creature', label: 'Creature' },
    { id: 'evolution', label: 'Evolution' },
    { id: 'settings', label: 'Settings' },
  ];

  const SPEEDS: { label: string; value: Speed }[] = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '4x', value: 4 },
    { label: '16x', value: 16 },
    { label: 'Max', value: 'max' },
  ];

  /** Events that affect the whole world at once. The rest are applied by hand with tools. */
  const CLIMATE_EVENTS: TimedEventKind[] = ['drought', 'iceAge', 'foodBoom'];
  const EVENT_HINTS: Record<TimedEventKind, string> = {
    drought: 'Plants grow at 15% of normal for 3,000 ticks',
    iceAge: 'Plants grow at 40% and living costs 40% more, for 8,000 ticks',
    foodBoom: 'Plants grow three times as fast for 3,000 ticks',
  };

  const TOOLS: { id: ToolKind; label: string; hint: string }[] = [
    { id: 'meteor', label: 'Meteor', hint: 'Click to strike: kills everything and burns the ground inside the ring' },
    { id: 'plague', label: 'Plague', hint: 'Click to infect the creatures inside the ring; it then spreads by contact' },
    { id: 'wall', label: 'Wall', hint: 'Drag to draw a wall that creatures cannot cross' },
    { id: 'erase', label: 'Erase wall', hint: 'Drag over a wall to remove that part of it' },
    { id: 'fertilise', label: 'Fertilise', hint: 'Drag to make land fully fertile; plants then grow there' },
    { id: 'blight', label: 'Blight', hint: 'Drag to make land barren; plants there die' },
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
  const DIET_SERIES: ChartSeries[] = [
    { label: 'Plant-eaters', color: '#4caf50' },
    { label: 'Meat-eaters', color: '#e0566a' },
  ];
  const BRAIN_SERIES: ChartSeries[] = [
    { label: 'Mean links', color: '#e8c468' },
    { label: 'Mean hidden neurons', color: '#6cb6ff', axis: 'right' },
  ];
  const SPECIES_SERIES: ChartSeries[] = [{ label: 'Species', color: '#7fd6c2' }];

  let host: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let client: SimClient | undefined;
  let renderer: WorldRenderer | undefined;
  let snapshot = $state.raw<Snapshot | null>(null);
  let history = $state.raw<HistoryData | null>(null);
  let tree = $state.raw<TreeData | null>(null);
  let profiles = $state.raw<ProfileGroup[]>([]);
  let seed = $state(defaultConfig.seed);
  /** The settings in force. Restart-only ones take effect at the next restart. */
  let settings = $state<SimConfig>({ ...defaultConfig });
  /** Set when a world is loaded from a file, so the settings follow the file's. */
  let adoptLoadedSettings = false;
  let tab = $state<Tab>('world');
  let showScent = $state(false);
  let colorBySpecies = $state(false);
  let drawWorld = $state(true);
  let follow = $state(false);
  let errorMessage = $state('');
  /** The tool in hand, or null for plain selecting and panning. */
  let tool = $state<ToolKind | null>(null);
  /** Id of the creature the panel last switched to, so a new pick opens the Creature tab once. */
  let shownCreature = 0;

  const populationData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.population, history.plantPercent],
  );
  const traitData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanSize, history.meanSpeed, history.meanSensorRange],
  );
  const dietData = $derived.by<uPlot.AlignedData | null>(() => {
    if (!history) return null;
    const { population, meatEaters } = history;
    return [history.tick, population.map((count, k) => count - meatEaters[k]!), meatEaters];
  });
  const brainData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanLinks, history.meanNeurons],
  );
  const speciesData = $derived<uPlot.AlignedData | null>(history && [history.tick, history.speciesCount]);

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
          if (adoptLoadedSettings) {
            adoptLoadedSettings = false;
            settings = { ...s.config };
            seed = s.config.seed;
          }
          r.update(s);
          const picked = s.selected?.id ?? 0;
          if (picked !== 0 && picked !== shownCreature) tab = 'creature';
          shownCreature = picked;
        },
        onHistory: (h) => (history = h),
        onTree: (t) => (tree = t),
        onProfiles: (groups) => (profiles = groups),
        onSaved: download,
        onError: (message) => {
          adoptLoadedSettings = false;
          errorMessage = message;
        },
      });
      client.init({ ...settings, seed });
      r.onPick = (x, y, radius) => client?.pick(x, y, radius);
      r.onTool = (kind, x, y, fromX, fromY) => client?.applyTool(kind, x, y, fromX, fromY);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') pickTool(null);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
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
    client?.init({ ...settings, seed });
  }

  function changeSetting(key: keyof SimConfig, value: number) {
    settings = { ...settings, [key]: value };
    if (!RESTART_KEYS.has(key)) client?.setConfig({ [key]: value });
  }

  function applyPreset(preset: Preset) {
    settings = presetConfig(preset, seed);
    client?.init({ ...settings });
    client?.setRandomEvents(settings.randomEvents);
  }

  function pickTool(next: ToolKind | null) {
    tool = next;
    renderer?.setTool(next);
  }

  function applyViewOptions() {
    if (!renderer) return;
    renderer.showScent = showScent;
    renderer.colorBy = colorBySpecies ? 'species' : 'family';
    renderer.follow = follow;
    renderer.redraw();
  }

  function toggleDrawing() {
    client?.setRendering(drawWorld);
  }

  /** Hand the saved world to the browser as a file download. */
  function download(json: string, tick: number, savedSeed: string) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `evolution-sim-${savedSeed.replace(/[^\w-]+/g, '_')}-tick${tick}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function loadFile() {
    const file = fileInput.files?.[0];
    fileInput.value = '';
    if (!file) return;
    errorMessage = '';
    adoptLoadedSettings = true;
    client?.load(await file.text());
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

    <div class="group">
      <button
        title="Download this world as a file you can load later"
        onclick={() => client?.save()}
        disabled={!snapshot}
      >
        Save
      </button>
      <button title="Replace this world with one from a saved file" onclick={() => fileInput.click()} disabled={!snapshot}>
        Load
      </button>
      <input class="file" type="file" accept=".json,application/json" bind:this={fileInput} onchange={loadFile} />
    </div>

    <div class="stats">
      <span>Tick <b>{count(snapshot?.tick)}</b></span>
      <span><b>{count(snapshot ? Math.round(snapshot.measuredTps) : undefined)}</b> ticks/s</span>
    </div>

    <button onclick={() => renderer?.fitToView()} disabled={!snapshot}>Fit view</button>
  </header>

  <div class="events">
    <span class="label" title="Pick a tool, then click or drag on the world. Press Esc to put it down.">Tools</span>
    <div class="group" role="group" aria-label="Tools">
      <button
        class:active={tool === null}
        title="Drag to move the view, click a creature to inspect it"
        onclick={() => pickTool(null)}
      >
        Select
      </button>
      {#each TOOLS as t (t.id)}
        <button class:active={tool === t.id} title={t.hint} onclick={() => pickTool(t.id)} disabled={!snapshot}>
          {t.label}
        </button>
      {/each}
      <button title="Remove every wall" onclick={() => client?.clearWalls()} disabled={!snapshot}>
        Clear walls
      </button>
    </div>

    <span class="label view">Climate</span>
    <div class="group">
      {#each CLIMATE_EVENTS as kind (kind)}
        <button title={EVENT_HINTS[kind]} onclick={() => client?.triggerEvent(kind)} disabled={!snapshot}>
          {EVENT_LABELS[kind]}
        </button>
      {/each}
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

    <span class="label view">View</span>
    <label title="Tint the ground purple where creatures have left scent">
      <input type="checkbox" bind:checked={showScent} onchange={applyViewOptions} />
      Show scent
    </label>
    <label title="Colour creatures by the species they are grouped into, instead of by family colour">
      <input type="checkbox" bind:checked={colorBySpecies} onchange={applyViewOptions} />
      Colour by species
    </label>
    <label title="Untick to stop drawing the world while it runs. The charts and numbers keep updating.">
      <input type="checkbox" bind:checked={drawWorld} onchange={toggleDrawing} />
      Draw world
    </label>
  </div>

  {#if errorMessage}
    <div class="error" role="alert">
      <span>{errorMessage}</span>
      <button onclick={() => (errorMessage = '')}>Dismiss</button>
    </div>
  {/if}

  <div class="main">
    <div class="world" class:paused-drawing={!drawWorld} class:tool={tool !== null} bind:this={host}>
      {#if !drawWorld}
        <div class="notice">Drawing is off. The world is still running; tick "Draw world" to see it.</div>
      {/if}
    </div>

    <aside>
      <div class="tabs" role="tablist">
        {#each TABS as t (t.id)}
          <button role="tab" aria-selected={tab === t.id} class:active={tab === t.id} onclick={() => (tab = t.id)}>
            {t.label}
          </button>
        {/each}
      </div>

      {#if tab === 'world'}
        <dl>
          <div><dt>Creatures</dt><dd>{count(snapshot?.population)}</dd></div>
          <div><dt>Plants</dt><dd>{snapshot ? Math.round(snapshot.plantFill * 100) : '-'}%</dd></div>
          <div title="Creatures whose diet gene is above 0.5; drawn as pointed shapes">
            <dt>Meat-eaters</dt>
            <dd>{count(snapshot?.meatEaters)}</dd>
          </div>
          <div><dt>Species</dt><dd>{count(history?.speciesCount.at(-1))}</dd></div>
          <div><dt>Births</dt><dd>{count(snapshot?.births)}</dd></div>
          <div><dt>Generation</dt><dd>{count(snapshot?.maxGeneration)}</dd></div>
          <div><dt>Starved</dt><dd>{count(snapshot?.deaths.starved)}</dd></div>
          <div><dt>Killed</dt><dd>{count(snapshot?.deaths.killed)}</dd></div>
          <div><dt>Died of thirst</dt><dd>{count(snapshot?.deaths.thirst)}</dd></div>
          <div title="Deaths from plague and meteors">
            <dt>Died in disasters</dt>
            <dd>{count(snapshot?.deaths.disaster)}</dd>
          </div>
          <div><dt>Died of old age</dt><dd>{count(snapshot?.deaths.oldAge)}</dd></div>
          <div title="Parentless creatures added because the population fell below the minimum">
            <dt>Reseeded</dt>
            <dd>{count(snapshot?.reseeded)}</dd>
          </div>
        </dl>

        <EnvironmentPanel environment={snapshot?.environment ?? null} />

        <Chart title="Population" series={POPULATION_SERIES} data={populationData} />
        <Chart
          title="Diet"
          note="How many creatures digest plants better (drawn as discs) and how many digest meat better (drawn as pointed shapes). Red ground is meat left by the dead."
          series={DIET_SERIES}
          data={dietData}
        />
      {:else if tab === 'creature'}
        <label class="follow" title="Keep the selected creature in the middle of the view">
          <input type="checkbox" bind:checked={follow} onchange={applyViewOptions} />
          Follow the selected creature
        </label>
        <Inspector creature={snapshot?.selected ?? null} />
      {:else if tab === 'settings'}
        <SettingsPanel config={settings} onChange={changeSetting} onPreset={applyPreset} />
      {:else}
        <dl>
          <div><dt>Mean size</dt><dd>{decimal(snapshot?.meanSize)}</dd></div>
          <div><dt>Mean speed</dt><dd>{decimal(snapshot?.meanSpeed)}</dd></div>
          <div><dt>Mean sensor range</dt><dd>{decimal(snapshot?.meanSensorRange)}</dd></div>
          <div title="Creatures that digest plants better than meat">
            <dt>Plant-eaters</dt>
            <dd>{count(snapshot ? snapshot.population - snapshot.meatEaters : undefined)}</dd>
          </div>
        </dl>

        <LineageTree {tree} bySpecies={colorBySpecies} />
        <SpeciesList species={snapshot?.species ?? []} tick={snapshot?.tick ?? 0} />
        <BrainCompare groups={profiles} />
        <Chart
          title="Number of species"
          note="Rises when families drift apart, falls when a species dies out."
          series={SPECIES_SERIES}
          data={speciesData}
        />
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
      {/if}
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

  .label {
    color: var(--muted);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .label.view {
    margin-left: 12px;
  }

  .events input,
  .follow input {
    width: auto;
    padding: 0;
  }

  .group {
    display: flex;
    flex-wrap: wrap;
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

  .file {
    display: none;
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

  .error {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 6px 14px;
    background: #3a1d22;
    border-bottom: 1px solid #7a3340;
    color: #ffd7dc;
  }

  .main {
    flex: 1;
    min-height: 0;
    display: flex;
  }

  .world {
    position: relative;
    flex: 1;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
  }

  .world:active {
    cursor: grabbing;
  }

  .world.tool,
  .world.tool:active {
    cursor: crosshair;
  }

  .world.paused-drawing :global(canvas) {
    opacity: 0.35;
  }

  .notice {
    position: absolute;
    top: 16px;
    left: 50%;
    transform: translateX(-50%);
    z-index: 1;
    padding: 6px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    pointer-events: none;
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

  /* The tabs stay at the top of the panel while its contents scroll beneath. */
  .tabs {
    position: sticky;
    top: -12px;
    z-index: 2;
    display: flex;
    gap: 4px;
    margin: -12px -12px -8px;
    padding: 12px 12px 8px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .tabs button {
    flex: 1;
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
