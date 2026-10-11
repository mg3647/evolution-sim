<script lang="ts">
  import { onMount } from 'svelte';
  import type uPlot from 'uplot';
  import { BIOME_GROUND, RESOURCE_KINDS, resourcesIn, WorldRenderer, type ResourceKind } from '../render/renderer';
  import { BIOME_LABELS } from '../sim/biomes';
  import { defaultConfig, type SimConfig } from '../sim/config';
  import { presetConfig, RESTART_KEYS, WILDFIRE_LEVELS, wildfireLevel, type Preset } from '../sim/presets';
  import { EVENT_LABELS, type TimedEventKind } from '../sim/environment';
  import type { ToolKind } from '../sim/world';
  import { SimClient } from '../worker/client';
  import type { HistoryData, LabData, ProfileGroup, ReportSummary, Snapshot, Speed, TreeData } from '../worker/protocol';
  import Chart, { type ChartEvent, type ChartSeries } from './Chart.svelte';
  import EnvironmentPanel from './EnvironmentPanel.svelte';
  import Inspector from './Inspector.svelte';
  import LabView from './LabView.svelte';
  import ReportDialog from './ReportDialog.svelte';
  import LineageTree from './LineageTree.svelte';
  import SettingsPanel from './SettingsPanel.svelte';
  import SpeciesList from './SpeciesList.svelte';
  import { streamSeries } from './speciesColors';
  import Sparkline from './Sparkline.svelte';
  import Timeline from './Timeline.svelte';
  import TraitCards from './TraitCards.svelte';


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
    { id: 'block', label: 'Block', hint: 'Click or drag to place blocks: solid like a wall, but creatures can push, carry and set them down' },
    { id: 'erase', label: 'Erase', hint: 'Drag over walls or blocks to remove them' },
    { id: 'fertilise', label: 'Fertilise', hint: 'Drag to make land fully fertile; plants then grow there' },
    { id: 'blight', label: 'Blight', hint: 'Drag to make land barren; plants there die' },
    { id: 'fire', label: 'Fire', hint: 'Click or drag to set light to land that has plants or branches on it' },
    { id: 'rain', label: 'Rain', hint: 'Click or drag to put out every fire inside the ring' },
  ];

  /** What each biome gives and takes, shown when its name in the map key is pointed at. */
  const BIOME_HINTS = [
    'Grassland: steady food and open sight, but nowhere to hide',
    'Forest: half again as many plants, and cover (creatures in it are seen from 40% less far), but moving costs 20% more',
    'Rainforest: twice the plants, half the thirst and the deepest cover, but hot, which is hard on big bodies',
    'Desert: creatures see half again as far, but few plants, two and a half times the thirst, hot days and cold nights',
    'Tundra: meat rots four times slower and summer brings a bloom, but it is cold and nothing grows in autumn and winter',
  ];

  const POPULATION_SERIES: ChartSeries[] = [
    { label: 'Creatures', color: '#e8c468' },
    { label: 'Plants %', color: '#4caf50', axis: 'right' },
  ];
  const DIET_SERIES: ChartSeries[] = [
    { label: 'Plant-eaters %', color: '#4caf50' },
    { label: 'Meat-eaters %', color: '#e0566a' },
  ];
  const BRAIN_SERIES: ChartSeries[] = [
    { label: 'Mean links', color: '#e8c468' },
    { label: 'Mean hidden neurons', color: '#6cb6ff', axis: 'right' },
  ];

  let host: HTMLDivElement;
  let fileInput: HTMLInputElement;
  let client: SimClient | undefined;
  let renderer: WorldRenderer | undefined;
  let snapshot = $state.raw<Snapshot | null>(null);
  let history = $state.raw<HistoryData | null>(null);
  let tree = $state.raw<TreeData | null>(null);
  let profiles = $state.raw<ProfileGroup[]>([]);
  let lab = $state.raw<LabData | null>(null);
  /** Whether the full-screen Lab view is open. */
  let showLab = $state(false);
  let showReport = $state(false);
  let report = $state.raw<{ json: string; fileName: string; summary: ReportSummary } | null>(null);
  /** Where the settings are kept between visits. */
  const SETTINGS_STORE = 'evolution-sim.settings';

  /**
   * The settings left by the last visit, over today's defaults. Only values
   * that differ from the defaults are kept, so a default that changes in a
   * later version reaches everyone who never touched it.
   */
  function rememberedSettings(): SimConfig {
    const settings = { ...defaultConfig };
    try {
      const kept = JSON.parse(localStorage.getItem(SETTINGS_STORE) ?? '{}') as Record<string, unknown>;
      const known = settings as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(kept)) {
        // Anything unknown, or of the wrong kind, is left behind.
        if (key in known && typeof value === typeof known[key]) known[key] = value;
      }
    } catch {
      // Nothing remembered, or the browser will not say: start from the defaults.
    }
    return settings;
  }

  function rememberSettings(settings: SimConfig): void {
    const changed: Record<string, unknown> = {};
    for (const key of Object.keys(defaultConfig) as (keyof SimConfig)[]) {
      if (settings[key] !== defaultConfig[key]) changed[key] = settings[key];
    }
    try {
      localStorage.setItem(SETTINGS_STORE, JSON.stringify(changed));
    } catch {
      // A browser that will not store them just forgets them.
    }
  }

  const remembered = rememberedSettings();
  let seed = $state(remembered.seed);
  /** The settings in force. Restart-only ones take effect at the next restart. */
  let settings = $state<SimConfig>(remembered);
  $effect(() => rememberSettings({ ...settings, seed }));
  /** Set when a world is loaded from a file, so the settings follow the file's. */
  let adoptLoadedSettings = false;
  let showScent = $state(false);
  let showTemperature = $state(false);
  let showResources = $state(false);
  let colorBySpecies = $state(false);
  let drawWorld = $state(true);
  let follow = $state(false);
  let errorMessage = $state('');
  /** The tool in hand, or null for plain selecting and panning. */
  let tool = $state<ToolKind | null>(null);
  /** Id of the creature the panel last switched to, so a new pick opens the Creature tab once. */
  let shownCreature = 0;
  /** Panel width in pixels for U1 (resizable panel) */
  let panelWidth = $state<number>(380);
  let isResizing = $state(false);
  type Tab = 'world' | 'creature' | 'evolution' | 'charts';
  const TABS: { id: Tab; label: string }[] = [
    { id: 'world', label: 'World' },
    { id: 'creature', label: 'Creature' },
    { id: 'evolution', label: 'Evolution' },
    { id: 'charts', label: 'Charts' },
  ];
  /** The panel shows one tab at a time. */
  let activeTab = $state<Tab>('world');

  /** The welcome note over the map, until it has been dismissed once. */
  const HINT_STORE = 'evolution-sim.welcomeSeen';
  let welcomeSeen = $state(false);
  try {
    welcomeSeen = localStorage.getItem(HINT_STORE) === '1';
  } catch {
    // Browser will not say: the note shows once per visit.
  }
  function dismissWelcome() {
    welcomeSeen = true;
    try {
      localStorage.setItem(HINT_STORE, '1');
    } catch {
      // Not remembered.
    }
  }

  /** How a headline number has moved over about the last stretch of the run. */
  function trend(values: ArrayLike<number> | undefined): { arrow: string; tone: string } {
    const n = values?.length ?? 0;
    if (!values || n < 8) return { arrow: '', tone: '' };
    const now = values[n - 1]!;
    const before = values[Math.max(0, n - 21)]!;
    const change = before === 0 ? (now === 0 ? 0 : 1) : (now - before) / Math.abs(before);
    if (Math.abs(change) < 0.03) return { arrow: '→', tone: 'flat' };
    return change > 0 ? { arrow: '▲', tone: 'up' } : { arrow: '▼', tone: 'down' };
  }
  const meatShare = $derived(
    history ? Float32Array.from(history.population, (p, k) => (p > 0 ? (history!.meatEaters[k]! / p) * 100 : 0)) : undefined,
  );

  const DEATH_CAUSES = [
    { key: 'starved', label: 'Starved', color: '#e8c468' },
    { key: 'killed', label: 'Killed', color: '#e0566a' },
    { key: 'temperature', label: 'Heat or cold', color: '#6cb6ff' },
    { key: 'thirst', label: 'Thirst', color: '#7fd6c2' },
    { key: 'disaster', label: 'Disasters', color: '#b08cff' },
    { key: 'oldAge', label: 'Old age', color: '#8a9aa9' },
  ] as const;
  const deathTotal = $derived(
    snapshot ? DEATH_CAUSES.reduce((sum, c) => sum + (snapshot!.deaths[c.key] ?? 0), 0) : 0,
  );
  /** U5: Settings drawer state */
  let showSettingsDrawer = $state(false);

  const populationData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.population, history.plantPercent],
  );
  /** Plant-eaters and meat-eaters as shares of everyone, so the two always add up to 100. */
  const dietData = $derived.by<uPlot.AlignedData | null>(() => {
    if (!history) return null;
    const { population, meatEaters } = history;
    const meat = population.map((count, k) => (count > 0 ? (meatEaters[k]! / count) * 100 : 0));
    return [history.tick, meat.map((share, k) => (population[k]! > 0 ? 100 - share : 0)), meat];
  });
  const brainData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanLinks, history.meanNeurons],
  );
  /** The species stream, as in the Lab. The chart is rebuilt when the set of species drawn changes. */
  const streamKey = $derived(history ? history.species.map((s) => s.id).join(',') : '');
  const streamData = $derived<uPlot.AlignedData | null>(
    history && history.species.length > 0 ? [history.tick, ...history.species.map((s) => s.counts)] : null,
  );

  /** A species kept picked out on the map by a click, and one picked out while the pointer is on its row. */
  let pinnedSpecies = $state<number | null>(null);
  let hoveredSpecies = $state<number | null>(null);
  /** The living members of a family-tree branch picked out by a click. */
  let pickedBranch = $state.raw<Set<number> | null>(null);
  /** The selection chart the Lab should open at, set by clicking a trait card. */
  let labFocus = $state<string | null>(null);

  $effect(() => {
    // Read first, so the effect runs again when any of them changes.
    const species = hoveredSpecies ?? pinnedSpecies;
    const branch = pickedBranch;
    if (!renderer) return;
    renderer.highlight = species !== null ? { species } : branch ? { ids: branch } : null;
    renderer.redraw();
  });
  /** Cells holding each kind of resource, counted only while the Resources view is on. */
  const resourceCounts = $derived.by<Record<ResourceKind, number> | null>(() => {
    if (!showResources || !snapshot || !snapshot.rendered) return null;
    const counts: Record<ResourceKind, number> = { block: 0, built: 0, meat: 0, branch: 0, store: 0, stone: 0 };
    const { items, meat, blocks } = snapshot;
    for (let i = 0; i < items.length; i++) {
      const here = resourcesIn(items[i]!, meat[i]!, blocks[i]!);
      if (here.block) counts.block++;
      if (here.built) counts.built++;
      if (here.meat) counts.meat++;
      if (here.branch) counts.branch++;
      if (here.store) counts.store++;
      if (here.stone) counts.stone++;
    }
    return counts;
  });

  /** Recent events, marked on every chart. */
  const chartEvents = $derived<ChartEvent[]>(
    (snapshot?.environment.log ?? []).map((entry) => ({ tick: entry.tick, label: entry.text })),
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
          if (adoptLoadedSettings) {
            adoptLoadedSettings = false;
            settings = { ...s.config };
            seed = s.config.seed;
          }
          r.update(s);
          const picked = s.selected?.id ?? 0;
          if (picked !== 0 && picked !== shownCreature) activeTab = 'creature';
          if (s.tick > 0 && !welcomeSeen) dismissWelcome();
          shownCreature = picked;
        },
        onHistory: (h) => (history = h),
        onTree: (t) => (tree = t),
        onProfiles: (groups) => (profiles = groups),
        onLab: (data) => (lab = data),
        onSaved: download,
        onReport: (json, fileName, summary) => (report = { json, fileName, summary }),
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
      if (event.key !== 'Escape') return;
      if (showLab) showLab = false;
      else pickTool(null);
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
    if ((snapshot?.tick ?? 0) > 3000 && !confirm(`Restart? This world is ${count(snapshot?.tick)} ticks old and the run so far will be lost. Use Save first to keep it.`)) {
      return;
    }
    client?.init({ ...settings, seed });
  }

  function changeSetting(key: keyof SimConfig, value: number) {
    settings = { ...settings, [key]: value };
    if (!RESTART_KEYS.has(key)) client?.setConfig({ [key]: value });
  }

  function restartWorld() {
    client?.init({ ...settings, seed });
  }

  /** Put every setting back to its default. Those a running world can take are applied at once. */
  function resetSettings() {
    settings = { ...defaultConfig, seed };
    const live: Partial<SimConfig> = {};
    for (const key of Object.keys(defaultConfig) as (keyof SimConfig)[]) {
      if (!RESTART_KEYS.has(key)) (live as Record<string, unknown>)[key] = defaultConfig[key];
    }
    client?.setConfig(live);
  }

  /** Set the Wildfire switch: both fire sliders at once, in the running world. */
  function setWildfire(level: (typeof WILDFIRE_LEVELS)[number]) {
    changeSetting('fireChance', level.fireChance);
    changeSetting('fireSpread', level.fireSpread);
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
    renderer.showTemperature = showTemperature;
    renderer.showResources = showResources;
    renderer.colorBy = colorBySpecies ? 'species' : 'family';
    renderer.follow = follow;
    renderer.redraw();
  }

  function toggleDrawing() {
    client?.setRendering(drawWorld);
  }

  /** Hand the saved world to the browser as a file download. */
  function download(json: string, tick: number, savedSeed: string) {
    downloadFile(json, `evolution-sim-${savedSeed.replace(/[^\w-]+/g, '_')}-tick${tick}.json`);
  }

  function downloadFile(json: string, fileName: string) {
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
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

  function startResizing(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('resize-handle')) {
      isResizing = true;
    }
  }

  function stopResizing() {
    isResizing = false;
  }

  function onMouseMove(e: MouseEvent) {
    if (!isResizing) return;
    // Calculate new panel width from mouse position (from right edge)
    const newWidth = window.innerWidth - e.clientX;
    // Constrain between 300px and 900px
    panelWidth = Math.max(300, Math.min(900, newWidth));
  }

  onMount(() => {
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', stopResizing);
    return () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', stopResizing);
    };
  });
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
      <button
        title="Make a small summary of this run to keep in the repository for later analysis"
        onclick={() => {
          report = null;
          showReport = true;
        }}
        disabled={!snapshot}
      >
        Report
      </button>
    </div>

    <div class="stats">
      <span>Tick <b>{count(snapshot?.tick)}</b></span>
      <span><b>{count(snapshot ? Math.round(snapshot.measuredTps) : undefined)}</b> ticks/s</span>
    </div>

    <button onclick={() => renderer?.fitToView()} disabled={!snapshot}>Fit view</button>
    <button
      title="Open the Lab: full-screen charts and tables about how the population is evolving. The world keeps running."
      onclick={() => (showLab = true)}
      disabled={!snapshot}
    >
      Lab
    </button>
  </header>

  <div class="events">
    <div class="group" role="group" aria-label="Climate">
      <span class="label">Climate</span>
      {#each CLIMATE_EVENTS as kind (kind)}
        <button title={EVENT_HINTS[kind]} onclick={() => client?.triggerEvent(kind)} disabled={!snapshot}>
          {EVENT_LABELS[kind]}
        </button>
      {/each}
    </div>

    <div class="group wildfire" role="group" aria-label="Wildfire">
      <span class="label" title="How often lightning starts fires and how readily they spread">Wildfire</span>
      {#each WILDFIRE_LEVELS as level (level.id)}
        <button class:active={wildfireLevel(settings) === level.id} title={level.hint} onclick={() => setWildfire(level)}>
          {level.label}
        </button>
      {/each}
      {#if wildfireLevel(settings) === null}
        <span class="custom" title="The Lightning and Fire spread sliders in Settings are set to something else">Custom</span>
      {/if}
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

    <details class="menu view">
      <summary class="label">View ▾</summary>
      <div class="popover">
        <label title="Tint the ground purple where creatures have left scent">
          <input type="checkbox" bind:checked={showScent} onchange={applyViewOptions} />
          Show scent
        </label>
        <label title="Tint the ground blue where it is cold and red where it is hot, as it is right now">
          <input type="checkbox" bind:checked={showTemperature} onchange={applyViewOptions} />
          Show temperature
        </label>
        <label title="Grey out the ground and mark stones, branches, food stores and meat in bright colours, with counts in the map key">
          <input type="checkbox" bind:checked={showResources} onchange={applyViewOptions} />
          Show resources
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
    </details>

    <button class="settings" onclick={() => (showSettingsDrawer = true)} title="Open settings drawer">⚙️ Settings</button>
  </div>

  {#if errorMessage}
    <div class="error" role="alert">
      <span>{errorMessage}</span>
      <button onclick={() => (errorMessage = '')}>Dismiss</button>
    </div>
  {/if}

  <!-- U5: Settings drawer -->
  {#if showSettingsDrawer}
    <button class="drawer-overlay" onclick={() => (showSettingsDrawer = false)} type="button" aria-label="Close settings"></button>
    <div class="drawer">
      <div class="drawer-header">
        <h2>Settings</h2>
        <button class="drawer-close" onclick={() => (showSettingsDrawer = false)} type="button" aria-label="Close settings">✕</button>
      </div>
      <SettingsPanel
        config={settings}
        running={snapshot?.config ?? null}
        onChange={changeSetting}
        onPreset={applyPreset}
        onRestart={restartWorld}
        onReset={resetSettings}
      />
    </div>
  {/if}

  {#if showReport}
    <ReportDialog
      {report}
      onPrepare={(question, notes) => client?.report(question, notes, __APP_VERSION__)}
      onClose={() => (showReport = false)}
      onDownload={downloadFile}
    />
  {/if}

  {#if showLab}
    <LabView
      {history}
      {profiles}
      {lab}
      events={chartEvents}
      focus={labFocus}
      onClose={() => {
        showLab = false;
        labFocus = null;
      }}
    />
  {/if}

  <div class="main">
    <nav class="rail" aria-label="Tools" title="Pick a tool, then click or drag on the world. Press Esc to put it down.">
      <span class="label">Tools</span>
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
      <button title="Remove every wall" onclick={() => client?.clearWalls()} disabled={!snapshot}>Clear walls</button>
    </nav>

    <div class="center">
    <div class="world" class:paused-drawing={!drawWorld} class:tool={tool !== null} bind:this={host}>
      {#if !drawWorld}
        <div class="notice">Drawing is off. The world is still running; tick "Draw world" to see it.</div>
      {/if}
      <!-- U4: Floating creature card -->
      {#if snapshot?.selected && activeTab !== 'creature'}
        <div class="floating-card">
          <div class="creature-info">
            <div class="creature-name">Creature #{snapshot.selected.id}</div>
            <div class="creature-stats">
              <div><span class="label">Gen:</span> <span>{snapshot.selected.generation}</span></div>
              <div><span class="label">Age:</span> <span>{snapshot.selected.age}</span></div>
              <div><span class="label">Energy:</span> <span>{Math.round((snapshot.selected.energy / snapshot.selected.maxEnergy) * 100)}%</span></div>
              <div><span class="label">Health:</span> <span>{Math.round(snapshot.selected.health * 100)}%</span></div>
            </div>
          </div>
        </div>
      {/if}

      {#if !welcomeSeen && snapshot && snapshot.tick === 0}
        <div class="welcome">
          <b>Welcome.</b> Press <b>Play</b> to start the world. Click any creature to look inside its brain. Pick a
          tool on the left to change the world by hand.
          <button onclick={dismissWelcome}>Got it</button>
        </div>
      {/if}

      <!-- U6: Map legend -->
      <details class="map-legend" title="Click to open the map key">
        <summary>Map key</summary>
        <div class="legend-items">
          {#if showResources}
            <div class="legend-heading">Resources (cells holding each)</div>
            {#each [...RESOURCE_KINDS].reverse() as kind (kind.id)}
              <div class="legend-item">
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <rect x="3" y="3" width="14" height="14" fill="rgb({kind.color.join(',')})" />
                </svg>
                <span>{kind.label}</span>
                <b class="legend-count">{count(resourceCounts?.[kind.id])}</b>
              </div>
            {/each}
            <div class="legend-item" title="Creatures holding something right now">
              <span class="legend-note">
                Held: {count(snapshot?.holding.stone)} stone, {count(snapshot?.holding.branch)} branch,
                {count(snapshot?.holding.food)} food, {count(snapshot?.holding.block)} block
              </span>
            </div>
            <div class="legend-heading">Everything else</div>
          {/if}
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="6" fill="#e8c468" opacity="0.8"/>
            </svg>
            <span>Plant-eaters</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <polygon points="10,4 16,16 4,16" fill="#e8c468" opacity="0.8"/>
            </svg>
            <span>Meat-eaters</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="6" fill="none" stroke="#6db3ff" stroke-width="2"/>
            </svg>
            <span>Calling</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <circle cx="10" cy="10" r="5" fill="#e8c468" opacity="0.8"/>
              <circle cx="10" cy="10" r="8" fill="none" stroke="#ffffff" stroke-width="1.5"/>
            </svg>
            <span>Has defenses</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <rect width="20" height="20" fill="#8b4444"/>
            </svg>
            <span>Meat (food)</span>
          </div>
          <div class="legend-item">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <rect width="20" height="20" fill="#7b4a7b" opacity="0.6"/>
            </svg>
            <span>Scent mark</span>
          </div>
          <div class="legend-item" title="Fire hurts creatures in it, warms the land around it and leaves ash">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#ff9628"/></svg>
            <span>Fire</span>
          </div>
          <div class="legend-item" title="Plants regrow faster on fresh ash">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#3a3634"/></svg>
            <span>Ash</span>
          </div>
          <div class="legend-item" title="Branches lie in forests; a branch keeps a fire burning">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#926436"/></svg>
            <span>Branch</span>
          </div>
          <div class="legend-item" title="Stones lie in deserts">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#b0b0b6"/></svg>
            <span>Stone</span>
          </div>
          <div class="legend-item" title="A block is solid like a wall, but creatures can push it, pick it up and set it down. Being beside one is shelter from heat and cold.">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <rect x="2" y="2" width="16" height="16" fill="#4e4840" />
              <rect x="2" y="2" width="13" height="13" fill="#cfc7bc" />
              <rect x="5" y="5" width="10" height="10" fill="#9a9086" />
            </svg>
            <span>Block</span>
          </div>
          <div class="legend-item" title="A block that a creature has moved takes the colour of that creature's species">
            <svg width="20" height="20" viewBox="0 0 20 20">
              <rect x="2" y="2" width="16" height="16" fill="#5a3a7a" />
              <rect x="2" y="2" width="13" height="13" fill="#e0c4ff" />
              <rect x="5" y="5" width="10" height="10" fill="#b888e0" />
            </svg>
            <span>Block a creature moved</span>
          </div>
          <div class="legend-item" title="Plant food a creature carried here and set down; it spoils slowly">
            <svg width="20" height="20" viewBox="0 0 20 20"><rect width="20" height="20" fill="#e8d678"/></svg>
            <span>Stored food</span>
          </div>
          {#if (snapshot?.config.temperatureStrength ?? 0) > 0}
            {#each BIOME_LABELS as label, k (label)}
              {@const ground = BIOME_GROUND[k]!}
              <div class="legend-item" title={BIOME_HINTS[k]}>
                <svg width="20" height="20" viewBox="0 0 20 20">
                  <rect width="20" height="10" fill="rgb({ground.plant.join(',')})" />
                  <rect y="10" width="20" height="10" fill="rgb({ground.soil.join(',')})" />
                </svg>
                <span>{label}</span>
              </div>
            {/each}
          {/if}
        </div>
      </details>

      <!-- U3: Stats overlay on map -->
      <div class="stats-overlay">
        <div class="stat-item">
          <span class="stat-label">Creatures</span>
          <span class="stat-value">{count(snapshot?.population)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Hunters</span>
          <span class="stat-value">{count(snapshot?.meatEaters)}</span>
        </div>
        <div class="stat-item">
          <span class="stat-label">Species</span>
          <span class="stat-value">{count(history?.speciesCount.at(-1))}</span>
        </div>
        {#if snapshot?.environment}
          <div class="stat-item">
            <span class="stat-label">Season</span>
            <span class="stat-value">
              {#if snapshot.environment.yearFraction < 0.125 || snapshot.environment.yearFraction >= 0.875}
                🌱 Spring
              {:else if snapshot.environment.yearFraction < 0.375}
                ☀️ Summer
              {:else if snapshot.environment.yearFraction < 0.625}
                🍂 Autumn
              {:else}
                ❄️ Winter
              {/if}
            </span>
          </div>
          <div class="stat-item">
            <span class="stat-label">Time</span>
            <span class="stat-value">
              {#if snapshot.environment.daylight > 0.7}
                🌞 Day
              {:else if snapshot.environment.daylight < 0.3}
                🌙 Night
              {:else}
                🌅 Twilight
              {/if}
            </span>
          </div>
        {/if}
      </div>
    </div>

    <Timeline
      history={history}
      events={chartEvents}
      tick={snapshot?.tick ?? 0}
      onOpenLab={() => (showLab = true)}
    />
    </div>

    <button class="resize-handle" onmousedown={startResizing} type="button" title="Drag to resize the panel" aria-label="Resize panel"></button>
    <aside style={`width: ${panelWidth}px`}>
      <div class="tabs" role="tablist">
        {#each TABS as t (t.id)}
          <button
            role="tab"
            aria-selected={activeTab === t.id}
            class:on={activeTab === t.id}
            onclick={() => (activeTab = t.id)}
          >
            {t.label}{#if t.id === 'creature' && snapshot?.selected}<i class="pip"></i>{/if}
          </button>
        {/each}
      </div>

      <div class="body">
        {#if activeTab === 'world'}
          <div class="headline">
            <div class="stat" title="">
              <span class="k">Creatures</span>
              <span class="v">{count(snapshot?.population)}<em class={trend(history?.population).tone}>{trend(history?.population).arrow}</em></span>
              {#if history?.population}<div class="spark"><Sparkline values={history?.population} color="#e8c468" width={120} height={22} /></div>{/if}
            </div>
            <div class="stat" title="How full of plants the world is">
              <span class="k">Plants</span>
              <span class="v">{(snapshot ? Math.round(snapshot.plantFill * 100) : '-') + '%'}<em class={trend(history?.plantPercent).tone}>{trend(history?.plantPercent).arrow}</em></span>
              {#if history?.plantPercent}<div class="spark"><Sparkline values={history?.plantPercent} color="#4caf50" width={120} height={22} /></div>{/if}
            </div>
            <div class="stat" title="Creatures whose diet gene is above 0.5; drawn as pointed shapes">
              <span class="k">Meat-eaters</span>
              <span class="v">{count(snapshot?.meatEaters)}<em class={trend(meatShare).tone}>{trend(meatShare).arrow}</em></span>
              {#if meatShare}<div class="spark"><Sparkline values={meatShare} color="#e0566a" width={120} height={22} /></div>{/if}
            </div>
            <div class="stat" title="">
              <span class="k">Species</span>
              <span class="v">{count(history?.speciesCount.at(-1))}<em class={trend(history?.speciesCount).tone}>{trend(history?.speciesCount).arrow}</em></span>
              {#if history?.speciesCount}<div class="spark"><Sparkline values={history?.speciesCount} color="#6cb6ff" width={120} height={22} /></div>{/if}
            </div>
            <div class="stat" title="Average rules connecting a sense to an action">
              <span class="k">Brain links</span>
              <span class="v">{history ? history.meanLinks.at(-1)?.toFixed(1) : '-'}<em class={trend(history?.meanLinks).tone}>{trend(history?.meanLinks).arrow}</em></span>
              {#if history?.meanLinks}<div class="spark"><Sparkline values={history?.meanLinks} color="#b08cff" width={120} height={22} /></div>{/if}
            </div>
            <div class="stat" title="The longest line of descent so far">
              <span class="k">Generation</span>
              <span class="v">{count(snapshot?.maxGeneration)}</span>
              
            </div>
          </div>

          {#if deathTotal > 0}
            <div class="deaths" title="Everything that has died since the world began, by cause">
              <span class="k">Deaths so far · {count(deathTotal)}</span>
              <div class="bar">
                {#each DEATH_CAUSES as c (c.key)}
                  {#if (snapshot?.deaths[c.key] ?? 0) > 0}
                    <span
                      style="flex: {snapshot?.deaths[c.key]}; background: {c.color}"
                      title="{c.label}: {count(snapshot?.deaths[c.key])} ({Math.round(((snapshot?.deaths[c.key] ?? 0) / deathTotal) * 100)}%)"
                    ></span>
                  {/if}
                {/each}
              </div>
              <div class="key">
                {#each DEATH_CAUSES as c (c.key)}
                  {#if (snapshot?.deaths[c.key] ?? 0) > 0}
                    <span><i style="background: {c.color}"></i>{c.label} {Math.round(((snapshot?.deaths[c.key] ?? 0) / deathTotal) * 100)}%</span>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}

          <div class="env"><EnvironmentPanel environment={snapshot?.environment ?? null} yearLength={snapshot?.config.seasonLength ?? 0} /></div>

          <details class="more">
            <summary>More numbers</summary>
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
          <div title="Creatures that ran out of energy while too hot or too cold">
            <dt>Died of heat or cold</dt>
            <dd>{count(snapshot?.deaths.temperature)}</dd>
          </div>
          <div title="Deaths from plague, meteors and fire">
            <dt>Died in disasters</dt>
            <dd>{count(snapshot?.deaths.disaster)}</dd>
          </div>
          <div><dt>Died of old age</dt><dd>{count(snapshot?.deaths.oldAge)}</dd></div>
          <div title="Parentless creatures added because the population fell below the minimum">
            <dt>Reseeded</dt>
            <dd>{count(snapshot?.reseeded)}</dd>
          </div>
          <div title="Wildfires started by lightning or by hand since the world began">
            <dt>Fires</dt>
            <dd>{count(snapshot?.fires.started)}</dd>
          </div>
          <div title="Cells of land burning right now">
            <dt>Burning now</dt>
            <dd>{count(snapshot?.fires.burning)}</dd>
          </div>
          <div title="Creatures holding a stone (stronger bite) or a branch (takes part of bites aimed at them) right now">
            <dt>Holding a tool</dt>
            <dd>{snapshot ? `${count(snapshot.holding.stone)} stone, ${count(snapshot.holding.branch)} branch` : '-'}</dd>
          </div>
          <div title="Blocks a creature has moved, out of all the blocks in the world">
            <dt>Blocks moved</dt>
            <dd>{snapshot ? `${count(snapshot.blockInfo.built)} of ${count(snapshot.blockInfo.total)}` : '-'}</dd>
          </div>
          <div title="The longest straight run of touching blocks that creatures have moved, in cells. A run of several is the start of a wall.">
            <dt>Longest built line</dt>
            <dd>{count(snapshot?.blockInfo.longestLine)}</dd>
          </div>
          <div title="Creatures carrying a block right now">
            <dt>Carrying a block</dt>
            <dd>{count(snapshot?.holding.block)}</dd>
          </div>
          <div title="Creatures holding a load of food right now">
            <dt>Holding food</dt>
            <dd>{count(snapshot?.holding.food)}</dd>
          </div>
          <div title="How far, on average, a load of food was carried before it was set down">
            <dt>Food carried</dt>
            <dd>
              {snapshot && snapshot.carry.plantsDropped + snapshot.carry.meatDropped > 0
                ? `${Math.round(snapshot.carry.haul / (snapshot.carry.plantsDropped + snapshot.carry.meatDropped))} units`
                : '-'}
            </dd>
          </div>
          <div title="Creatures making a call right now; each is drawn with a pale blue ring">
            <dt>Calling now</dt>
            <dd>{count(snapshot?.social.calling)}</dd>
          </div>
          <div title="Energy creatures have handed to one another since the world began">
            <dt>Energy given</dt>
            <dd>{count(snapshot ? Math.round(snapshot.social.given) : undefined)}</dd>
          </div>
          <div title="Share of the energy given that went to a creature of nearly the same colour, so probably a relative">
            <dt>Given to relatives</dt>
            <dd>
              {snapshot && snapshot.social.given > 0
                ? `${Math.round((snapshot.social.givenToKin / snapshot.social.given) * 100)}%`
                : '-'}
            </dd>
          </div>
        </dl>
          </details>
        {:else if activeTab === 'creature'}
          <label class="follow" title="Keep the selected creature in the middle of the view">
            <input type="checkbox" bind:checked={follow} onchange={applyViewOptions} />
            Follow the selected creature
          </label>
          <Inspector creature={snapshot?.selected ?? null} />
        {:else if activeTab === 'evolution'}
          <TraitCards
            {history}
            onOpen={(selection) => {
              labFocus = selection;
              showLab = true;
            }}
          />
          <LineageTree
            {tree}
            bySpecies={colorBySpecies}
            yearLength={snapshot?.config.seasonLength ?? 0}
            picked={pickedBranch !== null}
            onPick={(ids) => {
              pickedBranch = ids && ids.size > 0 ? ids : null;
              if (pickedBranch) pinnedSpecies = null;
            }}
          />
          <SpeciesList
            species={snapshot?.species ?? []}
            tick={snapshot?.tick ?? 0}
            {history}
            pinned={pinnedSpecies}
            onHover={(id) => (hoveredSpecies = id)}
            onPin={(id) => {
              pinnedSpecies = pinnedSpecies === id ? null : id;
              if (pinnedSpecies !== null) pickedBranch = null;
            }}
          />
          <p class="lab-hint">Brain comparisons and more are in the <button class="link" onclick={() => (showLab = true)}>Lab</button>.</p>
        {:else}
          <Chart syncKey="panel" events={chartEvents} title="Population" series={POPULATION_SERIES} data={populationData} />
          <Chart
            syncKey="panel"
            events={chartEvents}
            stacked
            title="Diet"
            note="The share of creatures that digest plants better (drawn as discs) and the share that digest meat better (drawn as pointed shapes). Together they are everyone."
            series={DIET_SERIES}
            data={dietData}
          />
          {#if streamData}
            {#key streamKey}
              <Chart
            syncKey="panel"
                events={chartEvents}
                stacked
                title="Species"
                note="Members of each species, piled up, so the top edge is the population. A band splitting off is a new species; a band pinching out is an extinction. The Lab has the large version."
                series={streamSeries(history)}
                data={streamData}
              />
            {/key}
          {/if}
          <Chart
            syncKey="panel"
            events={chartEvents}
            title="Brains"
            note="Average brain wiring. Links are rules connecting a sense to an action; hidden neurons combine senses. Both cost energy, so brains grow only when the extra wiring pays for itself."
            series={BRAIN_SERIES}
            data={brainData}
          />

        {/if}
      </div>
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

  .center {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .rail {
    flex-shrink: 0;
    width: 104px;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px 8px;
    overflow-y: auto;
    background: var(--panel);
    border-right: 1px solid var(--border);
  }

  .rail .label {
    margin-bottom: 2px;
  }

  .rail button {
    text-align: left;
  }

  .events .settings {
    margin-left: auto;
  }

  .menu.view {
    position: relative;
  }

  .menu.view summary {
    cursor: pointer;
    list-style: none;
    padding: 4px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: #1b2530;
  }

  .menu.view summary::-webkit-details-marker {
    display: none;
  }

  .popover {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 10px 12px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
    white-space: nowrap;
  }

  .welcome {
    position: absolute;
    left: 50%;
    bottom: 24px;
    transform: translateX(-50%);
    z-index: 3;
    display: flex;
    align-items: center;
    gap: 14px;
    max-width: 640px;
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid var(--accent);
    border-radius: 6px;
  }

  .tabs {
    display: flex;
    flex-shrink: 0;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }

  .tabs button {
    flex: 1;
    padding: 10px 4px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--muted);
    font-weight: 600;
  }

  .tabs button.on {
    color: var(--text);
    border-bottom-color: var(--accent);
  }

  .pip {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-left: 5px;
    border-radius: 50%;
    background: var(--accent);
    vertical-align: middle;
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 14px;
    box-sizing: border-box;
  }

  .headline {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }

  .stat {
    padding: 8px 10px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid var(--border);
    border-radius: 6px;
    min-width: 0;
  }

  .stat .k,
  .deaths .k {
    display: block;
    font-size: 11px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat .v {
    display: flex;
    align-items: baseline;
    gap: 5px;
    font-size: 20px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .stat em {
    font-size: 11px;
    font-style: normal;
  }

  .stat em.up {
    color: #6fcf7a;
  }

  .stat em.down {
    color: #ff8f6b;
  }

  .stat em.flat {
    color: var(--muted);
  }

  .stat .spark {
    height: 22px;
    margin-top: 2px;
  }

  .deaths {
    margin-top: 12px;
  }

  .deaths .bar {
    display: flex;
    height: 10px;
    margin: 4px 0;
    overflow: hidden;
    border-radius: 5px;
  }

  .deaths .bar span {
    min-width: 2px;
  }

  .deaths .key {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    font-size: 11px;
    color: var(--muted);
  }

  .deaths .key i {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
  }

  .env {
    margin-top: 16px;
  }

  .more {
    margin-top: 12px;
  }

  .more summary {
    cursor: pointer;
    color: var(--muted);
    font-size: 12px;
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

  .stats-overlay {
    position: absolute;
    top: 16px;
    right: 16px;
    z-index: 1;
    display: flex;
    gap: 12px;
    padding: 8px 12px;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 13px;
    pointer-events: none;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .stat-label {
    font-size: 10px;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .map-legend {
    position: absolute;
    top: 16px;
    left: 16px;
    z-index: 1;
    padding: 8px;
    background: rgba(0, 0, 0, 0.7);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
  }

  .map-legend summary {
    cursor: pointer;
    padding: 4px;
    font-weight: 600;
    user-select: none;
    list-style: none;
  }

  .map-legend summary::-webkit-details-marker {
    display: none;
  }

  .map-legend summary::before {
    content: '▼ ';
    font-size: 10px;
    color: var(--muted);
  }

  .map-legend[open] summary::before {
    content: '▲ ';
  }

  .legend-items {
    margin-top: 8px;
    padding-left: 4px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .legend-item {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .legend-heading {
    margin-top: 2px;
    color: var(--muted);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .legend-count {
    margin-left: auto;
    padding-left: 10px;
    font-variant-numeric: tabular-nums;
  }

  .legend-note {
    color: var(--muted);
    font-size: 11px;
  }

  .legend-item svg {
    flex-shrink: 0;
  }

  .floating-card {
    position: absolute;
    bottom: 16px;
    left: 16px;
    z-index: 2;
    width: 200px;
    padding: 12px;
    background: rgba(0, 0, 0, 0.85);
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font-size: 12px;
    pointer-events: auto;
  }

  .creature-name {
    font-weight: 600;
    margin-bottom: 8px;
    color: var(--text);
  }

  .creature-stats {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px;
  }

  .creature-stats div {
    display: flex;
    justify-content: space-between;
    gap: 4px;
  }

  .creature-stats .label {
    color: var(--muted);
  }

  .creature-stats span {
    font-variant-numeric: tabular-nums;
  }

  .drawer-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    z-index: 10;
    background: rgba(0, 0, 0, 0.5);
    border: none;
    padding: 0;
    margin: 0;
    cursor: default;
  }

  .drawer {
    position: fixed;
    top: 0;
    right: 0;
    width: 400px;
    height: 100%;
    z-index: 11;
    background: var(--panel);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    overflow-y: auto;
    animation: slideIn 0.3s ease-out;
  }

  @keyframes slideIn {
    from {
      transform: translateX(100%);
    }
    to {
      transform: translateX(0);
    }
  }

  .drawer-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 16px;
    border-bottom: 1px solid var(--border);
  }

  .drawer-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
  }

  .drawer-close {
    width: 32px;
    height: 32px;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 20px;
    color: var(--muted);
  }

  .drawer-close:hover {
    color: var(--text);
  }


  .resize-handle {
    width: 8px;
    flex-shrink: 0;
    cursor: col-resize;
    background: transparent;
    border: none;
    border-left: 1px solid var(--border);
    user-select: none;
    padding: 0;
    margin: 0;
  }

  .resize-handle:hover {
    background: rgba(255, 255, 255, 0.1);
  }

  .resize-handle:focus {
    outline: 2px solid var(--border);
    outline-offset: -1px;
  }

  aside {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 0;
    padding: 0;
    overflow-y: auto;
    background: var(--panel);
    border-left: 1px solid var(--border);
    max-width: 1200px;
  }









  .wildfire {
    padding: 0 0 6px;
  }

  .wildfire .label {
    margin-right: 4px;
  }

  .custom {
    color: var(--muted);
    font-size: 12px;
  }

  .lab-hint {
    margin: 10px 0 0;
    font-size: 12px;
    color: var(--muted);
  }

  .link {
    padding: 0;
    background: none;
    border: none;
    color: var(--accent);
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
  }

  dl {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    gap: 4px 16px;
    margin: 8px 0 0;
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
    text-align: right;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }




  @media (max-width: 800px) {
    .main {
      flex-direction: column;
    }

    .resize-handle {
      display: none;
    }

    .rail {
      display: none;
    }

    aside {
      width: auto !important;
      max-height: 45%;
      border-left: none;
      border-top: 1px solid var(--border);
    }
  }
</style>
