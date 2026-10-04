<script lang="ts">
  import { defaultConfig, type SimConfig } from '../sim/config';
  import { PRESETS, RESTART_KEYS, SETTING_GROUPS, type Preset } from '../sim/presets';

  let {
    config,
    onChange,
    onPreset,
  }: {
    /** The settings in force, or about to be on the next restart. */
    config: SimConfig;
    /** Called when one setting is changed. */
    onChange: (key: keyof SimConfig, value: number) => void;
    /** Called when a preset is chosen; it replaces every setting and restarts the world. */
    onPreset: (preset: Preset) => void;
  } = $props();

  let presetId = $state(PRESETS[0]!.id);
  const preset = $derived(PRESETS.find((p) => p.id === presetId) ?? PRESETS[0]!);

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
</script>

<section>
  <h2>Presets</h2>
  <div class="preset">
    <select bind:value={presetId} aria-label="Preset">
      {#each PRESETS as p (p.id)}
        <option value={p.id}>{p.label}</option>
      {/each}
    </select>
    <button onclick={() => onPreset(preset)} title="Replace every setting with this preset and start a new world">
      Apply and restart
    </button>
  </div>
  <p>{preset.description}</p>
</section>

<p class="note">
  Most settings take effect at once, in the running world. Those in the last group shape the world when it
  is made, so they apply the next time you press Restart.
</p>

{#each SETTING_GROUPS as group (group.title)}
  <section>
    <h2>{group.title}</h2>
    {#each group.settings as setting (setting.key)}
      <label title={setting.hint}>
        <span class="name">{setting.label}</span>
        <input
          type="range"
          min={setting.min}
          max={setting.max}
          step={setting.step}
          value={config[setting.key]}
          oninput={(event) => changed(setting.key, event)}
        />
        <span class="value" class:changed={config[setting.key] !== defaultConfig[setting.key]}>
          {format(config[setting.key] as number)}
        </span>
      </label>
    {/each}
  </section>
{/each}

<details>
  <summary>Every setting ({allKeys.length})</summary>
  <p class="note">
    All of the sim's constants, by their internal names. Values outside sensible ranges can break a world;
    apply the Balanced preset to recover.
  </p>
  {#each allKeys as key (key)}
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

  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .note {
    margin: 0;
  }

  .preset {
    display: flex;
    gap: 6px;
  }

  select {
    flex: 1;
    font: inherit;
    color: var(--text);
    background: #1b2530;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
  }

  label {
    display: grid;
    grid-template-columns: 9.5em 1fr 4em;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    line-height: 1.9;
  }

  label.raw {
    grid-template-columns: 1fr 7em;
  }

  .name {
    color: var(--text);
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

  summary {
    cursor: pointer;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-bottom: 6px;
  }
</style>
