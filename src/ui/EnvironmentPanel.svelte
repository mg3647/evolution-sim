<script lang="ts">
  import type { EnvironmentView } from '../worker/protocol';
  import YearDial from './YearDial.svelte';

  /** Log entries shown, newest first. */
  const LOG_SHOWN = 6;

  let {
    environment,
    yearLength = 0,
  }: {
    environment: EnvironmentView | null;
    /** Ticks in a year; 0 if seasons are off. */
    yearLength?: number;
  } = $props();

  const recent = $derived(environment ? environment.log.slice(-LOG_SHOWN).reverse() : []);
</script>

<section>
  <h2>Environment</h2>
  {#if environment}
    <YearDial
      yearFraction={environment.yearFraction}
      daylight={environment.daylight}
      {yearLength}
      active={environment.active}
    />
    <dl>
      <div title="Plant growth relative to normal, from the season and any events together">
        <dt>Plant growth</dt>
        <dd>{Math.round(environment.growth * 100)}%</dd>
      </div>
      {#if environment.cost !== 1}
        <div title="Cold makes staying alive cost more energy">
          <dt>Cost of living</dt>
          <dd>{Math.round(environment.cost * 100)}%</dd>
        </div>
      {/if}
    </dl>

    {#if environment.infected > 0}
      <ul class="active">
        {#if environment.infected > 0}
          <li class="plague">
            <b>Plague</b>
            <span>{environment.infected.toLocaleString()} infected</span>
          </li>
        {/if}

      </ul>
    {/if}

    {#if recent.length > 0}
      <ul class="log">
        {#each recent as entry (entry.tick + entry.text)}
          <li><span>{entry.tick.toLocaleString()}</span> {entry.text}</li>
        {/each}
      </ul>
    {:else}
      <p>No events yet. Use the tools and climate buttons above the world, or switch on random events.</p>
    {/if}
  {/if}
</section>

<style>
  h2 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    margin: 6px 0 0;
    padding: 0;
    font-size: 12px;
    line-height: 1.5;
  }

  .active li {
    display: flex;
    justify-content: space-between;
    padding: 2px 8px;
    margin-bottom: 2px;
    background: #2a2233;
    border-left: 3px solid #b08cff;
    border-radius: 2px;
  }

  .active .plague {
    background: #26301a;
    border-left-color: #b6ff3c;
  }

  .active span,
  .log span,
  p {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
  }
</style>
