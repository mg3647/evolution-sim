<script lang="ts">
  import { defaultConfig, type SimConfig } from '../sim/config';
  import {
    KEY_SETTINGS,
    KEY_TAG_HINTS,
    PRESETS,
    RESTART_KEYS,
    SETTING_GROUPS,
    type Preset,
    type SettingInfo,
  } from '../sim/presets';

  let {
    config,
    onChange,
    onPreset,
    running,
    onRestart,
    onReset,
  }: {
    /** The settings in force, or about to be on the next restart. */
    config: SimConfig;
    /** Called when one setting is changed. */
    onChange: (key: keyof SimConfig, value: number) => void;
    /** Called when a preset is chosen; it replaces every setting and restarts the world. */
    onPreset: (preset: Preset) => void;
    /** The settings the running world was made with, or null before there is one. */
    running: SimConfig | null;
    /** Called to start a new world with the settings as they stand. */
    onRestart: () => void;
    /** Called to put every setting back to its default. */
    onReset: () => void;
  } = $props();

  /** Whether the user has been asked to confirm replacing their changes with a preset, or resetting them. */
  let confirming = $state<'preset' | 'reset' | null>(null);

  /** A setting that only takes effect at a restart, and whose value here is not the running world's. */
  const isWaiting = (key: keyof SimConfig) => running !== null && RESTART_KEYS.has(key) && config[key] !== running[key];
  /** Every setting, with or without a slider, that is waiting for a restart. */
  const waitingTotal = $derived(
    running === null ? 0 : [...RESTART_KEYS].filter((key) => key !== 'seed' && config[key] !== running[key]).length,
  );
  /** Every setting, with or without a slider, that is off its default. */
  const changedEverywhere = $derived(
    (Object.keys(defaultConfig) as (keyof SimConfig)[]).filter(
      (key) => key !== 'seed' && config[key] !== defaultConfig[key],
    ).length,
  );

  function loadPreset() {
    if (changedEverywhere > 0 && confirming !== 'preset') {
      confirming = 'preset';
      return;
    }
    confirming = null;
    onPreset(preset);
  }

  function resetAll() {
    if (confirming !== 'reset') {
      confirming = 'reset';
      return;
    }
    confirming = null;
    onReset();
  }

  let presetId = $state(PRESETS[0]!.id);
  const preset = $derived(PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!);

  /** What is typed in the search box. */
  let query = $state('');
  /** Show only settings moved off their defaults. */
  let onlyChanged = $state(false);
  /** Show only the few settings that matter most. */
  let onlyKey = $state(false);
  /** The setting whose explainer is open, if any. */
  let explained = $state<keyof SimConfig | null>(null);
  /** Groups folded shut by the user. */
  let folded = $state<Record<string, boolean>>({});

  /** Every numeric setting, for the full list. */
  const allKeys = (Object.keys(defaultConfig) as (keyof SimConfig)[]).filter(
    (key) => typeof defaultConfig[key] === 'number',
  );

  /** "plantGrowthRate" becomes "Plant growth rate". */
  function humanise(key: string): string {
    const words = key.replace(/([A-Z])/g, ' $1').toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }

  function format(value: number): string {
    return Number.isInteger(value) ? value.toLocaleString() : String(Number(value.toPrecision(4)));
  }

  function changed(key: keyof SimConfig, event: Event) {
    const value = Number((event.currentTarget as HTMLInputElement).value);
    if (Number.isFinite(value)) onChange(key, value);
  }

  const isChanged = (key: keyof SimConfig) => config[key] !== defaultConfig[key];

  /** Whether a setting matches what is typed: every word must appear in its name, hint, explainer or group. */
  function matches(setting: SettingInfo, groupTitle: string, words: string[]): boolean {
    const text = `${setting.label} ${setting.hint} ${setting.more ?? ''} ${groupTitle} ${humanise(setting.key)}`.toLowerCase();
    return words.every((word) => text.includes(word));
  }

  const words = $derived(query.toLowerCase().split(/\s+/).filter(Boolean));
  const filtering = $derived(words.length > 0 || onlyChanged || onlyKey);
  /** The groups with the settings that pass the search and the changed-only switch. */
  const shown = $derived(
    SETTING_GROUPS.map((group) => ({
      group,
      changed: group.settings.filter((setting) => isChanged(setting.key)).length,
      settings: group.settings.filter(
        (setting) =>
          matches(setting, group.title, words) &&
          (!onlyChanged || isChanged(setting.key)) &&
          (!onlyKey || KEY_SETTINGS[setting.key] !== undefined),
      ),
    })).filter((entry) => entry.settings.length > 0),
  );
  const changedTotal = $derived(
    SETTING_GROUPS.reduce((sum, group) => sum + group.settings.filter((s) => isChanged(s.key)).length, 0),
  );
</script>

<section class="apply">
  <button class="primary" onclick={onRestart} title="Start a new world using the settings as they stand in this panel">
    Restart with these settings
  </button>
  <p>
    {#if waitingTotal > 0}
      <b class="waiting-count">{waitingTotal}</b>
      {waitingTotal === 1 ? 'setting is' : 'settings are'} waiting for a restart. The running world still uses the
      old {waitingTotal === 1 ? 'value' : 'values'}.
    {:else}
      Nothing is waiting: the running world already uses every setting shown here.
    {/if}
  </p>
  <p>Your settings are remembered in this browser and come back when you reopen the page.</p>
  <div class="reset">
    <button onclick={resetAll} disabled={changedEverywhere === 0}>Reset all to defaults</button>
    {#if confirming === 'reset'}
      <span class="confirm">
        This puts your {changedEverywhere} changed {changedEverywhere === 1 ? 'setting' : 'settings'} back to default.
        <button onclick={resetAll}>Reset</button>
        <button onclick={() => (confirming = null)}>Cancel</button>
      </span>
    {/if}
  </div>
</section>

<section>
  <h2>Presets</h2>
  <div class="preset">
    <select bind:value={presetId} aria-label="Preset" onchange={() => (confirming = null)}>
      {#each PRESETS as p (p.id)}
        <option value={p.id}>{p.label}</option>
      {/each}
    </select>
    <button onclick={loadPreset} title="Replace every setting with this preset and start a new world">
      Load preset
    </button>
  </div>
  {#if confirming === 'preset'}
    <p class="confirm">
      This replaces your {changedEverywhere} changed {changedEverywhere === 1 ? 'setting' : 'settings'} and starts a new
      world.
      <button onclick={loadPreset}>Replace them</button>
      <button onclick={() => (confirming = null)}>Cancel</button>
    </p>
  {/if}
  <p>{preset.description}</p>
</section>

<section class="find">
  <input
    type="search"
    placeholder="Search settings, e.g. fire, breed, thirst"
    bind:value={query}
    aria-label="Search settings"
  />
  <label class="switch" title="Show only the settings you have moved off their defaults">
    <input type="checkbox" bind:checked={onlyChanged} />
    Only changed ({changedTotal})
  </label>
  <label class="switch" title="Show only the settings that make the biggest difference, each tagged with the kind of difference it makes">
    <input type="checkbox" bind:checked={onlyKey} />
    Key settings ({Object.keys(KEY_SETTINGS).length})
  </label>
  <p class="note">
    Click <span class="info-demo">i</span> beside a setting for what it does. Most settings take effect at once;
    those marked <span class="restart">restart</span> apply to the next world, and show
    <span class="restart waiting">waiting for restart</span> until you restart. A value in
    <span class="accent">colour</span> has been moved off its default.
  </p>
</section>

{#each shown as { group, settings, changed: groupChanged } (group.title)}
  {@const open = filtering || !folded[group.title]}
  <section class="group">
    <button class="group-head" onclick={() => (folded[group.title] = !folded[group.title])} aria-expanded={open}>
      <span class="chevron">{open ? '▾' : '▸'}</span>
      <span class="group-title">{group.title}</span>
      {#if groupChanged > 0}<span class="badge" title="Settings in this group moved off their defaults">{groupChanged}</span>{/if}
    </button>
    {#if open}
      <p class="about">{group.about}</p>
      {#each settings as setting (setting.key)}
        {@const restart = RESTART_KEYS.has(setting.key)}
        {@const key = KEY_SETTINGS[setting.key]}
        <div class="row" title={setting.hint}>
          <button
            class="info"
            class:on={explained === setting.key}
            onclick={() => (explained = explained === setting.key ? null : setting.key)}
            aria-label="Explain {setting.label}"
            aria-expanded={explained === setting.key}
          >
            i
          </button>
          <span class="name">
            {setting.label}{#if key}<span class="tag tag-{key.tag.toLowerCase()}" title="{KEY_TAG_HINTS[key.tag]}. {key.why}">{key.tag}</span>{/if}{#if isWaiting(setting.key)}<span
                class="restart waiting"
                title="The running world still uses {format(running?.[setting.key] as number)}. Press Restart with these settings to use {format(config[setting.key] as number)}."
                >waiting for restart</span
              >{:else if restart}<span class="restart">restart</span>{/if}
          </span>
          <input
            type="range"
            min={setting.min}
            max={setting.max}
            step={setting.step}
            value={config[setting.key]}
            aria-label={setting.label}
            oninput={(event) => changed(setting.key, event)}
          />
          <span class="value" class:changed={isChanged(setting.key)}>
            {format(config[setting.key] as number)}
          </span>
        </div>
        {#if explained === setting.key}
          <div class="explainer">
            <p>{setting.hint}.</p>
            {#if setting.more}<p>{setting.more}</p>{/if}
            {#if key}
              <p><span class="tag tag-{key.tag.toLowerCase()}">{key.tag}</span> {key.why}</p>
            {/if}
            <p class="facts">
              Default {format(defaultConfig[setting.key] as number)} · slider from {format(setting.min)} to
              {format(setting.max)} ·
              {restart ? 'applies on the next restart' : 'applies at once'}
            </p>
            {#if isWaiting(setting.key)}
              <p class="facts waiting-note">
                Waiting for a restart: the running world still uses {format(running?.[setting.key] as number)}.
              </p>
            {/if}
            {#if isChanged(setting.key)}
              <button onclick={() => onChange(setting.key, defaultConfig[setting.key] as number)}>
                Back to default
              </button>
            {/if}
          </div>
        {/if}
      {/each}
    {/if}
  </section>
{/each}

{#if shown.length === 0}
  <p class="note">
    {onlyChanged && words.length === 0
      ? 'Every setting is at its default.'
      : 'No setting matches. Try a different word, or look in "Every setting" below.'}
  </p>
{/if}

<details>
  <summary>Every setting, by internal name ({allKeys.length})</summary>
  <p class="note">
    All of the sim's constants, including those without a slider above. Values outside sensible ranges can
    break a world; apply the Balanced preset to recover.
  </p>
  {#each allKeys.filter((key) => words.every((word) => humanise(key).toLowerCase().includes(word))) as key (key)}
    <label class="raw" title={RESTART_KEYS.has(key) ? 'Applies on the next restart' : 'Applies at once'}>
      <span class="name">{humanise(key)}{RESTART_KEYS.has(key) ? ' *' : ''}</span>
      <input type="number" step="any" value={config[key]} onchange={(event) => changed(key, event)} />
    </label>
  {/each}
  <p class="note">* applies on the next restart.</p>
</details>

<style>
  h2 {
    margin: 0 0 6px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  section {
    padding: 10px 14px;
    border-bottom: 1px solid var(--border);
  }

  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .note {
    margin: 6px 0 0;
    padding: 0 14px;
  }

  .find .note {
    padding: 0;
  }

  .preset {
    display: flex;
    gap: 6px;
  }

  select,
  input[type='search'] {
    flex: 1;
    font: inherit;
    color: var(--text);
    background: #1b2530;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
  }

  input[type='search'] {
    width: 100%;
    box-sizing: border-box;
  }

  .switch {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
  }

  .switch input {
    width: auto;
  }

  .group {
    padding: 0;
  }

  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 9px 14px;
    background: none;
    border: none;
    color: var(--text);
    font: inherit;
    font-size: 13px;
    font-weight: 600;
    text-align: left;
    cursor: pointer;
  }

  .group-head:hover {
    background: rgba(255, 255, 255, 0.05);
  }

  .chevron {
    width: 12px;
    color: var(--muted);
  }

  .group-title {
    flex: 1;
  }

  .badge {
    padding: 0 6px;
    border-radius: 8px;
    background: var(--accent);
    color: #0b0f14;
    font-size: 11px;
  }

  .about {
    margin: 0 14px 6px 32px;
  }

  .row {
    display: grid;
    grid-template-columns: 18px minmax(0, 10.5em) 1fr 4em;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    font-size: 12px;
    line-height: 1.9;
  }

  .info,
  .info-demo {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: 1px solid var(--muted);
    border-radius: 50%;
    background: none;
    color: var(--muted);
    font: italic 600 11px Georgia, serif;
    line-height: 1;
  }

  .info {
    cursor: pointer;
  }

  .info:hover,
  .info.on {
    border-color: var(--accent);
    color: var(--accent);
  }

  .name {
    color: var(--text);
    line-height: 1.3;
  }

  .restart {
    margin-left: 5px;
    padding: 0 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--muted);
    font-size: 10px;
    white-space: nowrap;
  }

  .accent {
    color: var(--accent);
    font-weight: 600;
  }

  .tag {
    margin-left: 5px;
    padding: 0 5px;
    border-radius: 3px;
    color: #0b0f14;
    font-size: 10px;
    font-weight: 600;
    white-space: nowrap;
  }

  .explainer .tag {
    margin-left: 0;
    margin-right: 4px;
  }

  .tag-speed {
    background: #6cb6ff;
  }

  .tag-outcome {
    background: #e0566a;
    color: #fff;
  }

  .tag-pace {
    background: #e8c468;
  }

  .tag-nature {
    background: #4caf50;
  }

  .restart.waiting {
    border-color: #e8c468;
    color: #e8c468;
  }

  .waiting-count,
  .explainer .waiting-note {
    color: #e8c468;
  }

  .primary {
    width: 100%;
    padding: 6px 10px;
    font-weight: 600;
  }

  .reset {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
    margin-top: 8px;
    font-size: 12px;
  }

  .confirm {
    color: var(--text);
    font-size: 12px;
  }

  .confirm button {
    margin-left: 4px;
    font-size: 12px;
  }

  .explainer {
    margin: 2px 14px 8px 40px;
    padding: 8px 10px;
    border-left: 2px solid var(--accent);
    background: rgba(255, 255, 255, 0.04);
    border-radius: 0 4px 4px 0;
  }

  .explainer p {
    margin: 0 0 4px;
    color: var(--text);
  }

  .explainer .facts {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .explainer button {
    margin-top: 4px;
    font-size: 12px;
  }

  label.raw {
    display: grid;
    grid-template-columns: 1fr 7em;
    align-items: center;
    gap: 8px;
    padding: 0 14px;
    font-size: 12px;
    line-height: 1.9;
  }

  input[type='range'] {
    width: 100%;
    padding: 0;
    accent-color: var(--accent);
  }

  input[type='number'] {
    width: 100%;
    padding: 1px 4px;
    font-size: 12px;
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
    color: var(--muted);
  }

  /* A value moved off its default stands out. */
  .value.changed {
    color: var(--accent);
    font-weight: 600;
  }

  details {
    padding: 10px 0;
  }

  summary {
    cursor: pointer;
    padding: 0 14px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
</style>
