<script lang="ts">
  import type { HistoryData, SpeciesView } from '../worker/protocol';
  import Sparkline from './Sparkline.svelte';
  import { speciesColor } from './speciesColors';

  let {
    species,
    tick,
    history,
    pinned,
    onHover,
    onPin,
  }: {
    species: SpeciesView[];
    tick: number;
    /** For each row's line of members over time. */
    history: HistoryData | null;
    /** The species kept highlighted on the map, or null. */
    pinned: number | null;
    /** Called with a species id while the pointer is on its row, and null when it leaves. */
    onHover: (id: number | null) => void;
    /** Called when a row is clicked: keep that species highlighted, or let it go if it already is. */
    onPin: (id: number) => void;
  } = $props();

  function dietName(diet: number): string {
    if (diet < 0.25) return 'plants';
    if (diet > 0.75) return 'meat';
    return 'both';
  }

  const most = $derived(Math.max(1, ...species.map((s) => s.count)));
  const overTime = $derived(new Map((history?.species ?? []).map((s) => [s.id, s.counts])));
</script>

<section>
  <h2>Species</h2>
  <p>
    A species is a branch of the family tree that split off at least a year (6,000 ticks) ago and has since
    become clearly different from the group it left. Point at a row to pick that species out on the map; click
    to keep it picked out.
  </p>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="rows" onmouseleave={() => onHover(null)}>
    {#each species as s (s.id)}
      {@const counts = overTime.get(s.id)}
      <button
        class="row"
        class:pinned={pinned === s.id}
        title="Species {s.id}: eats {dietName(s.meanDiet)}, size {s.meanSize.toFixed(2)}, speed {s.meanSpeed.toFixed(2)}, first seen {(tick - s.bornTick).toLocaleString()} ticks ago"
        onmouseenter={() => onHover(s.id)}
        onfocus={() => onHover(s.id)}
        onblur={() => onHover(null)}
        onclick={() => onPin(s.id)}
      >
        <span class="swatch" style="background: {speciesColor(s.id)}"></span>
        <span class="count">{s.count.toLocaleString()}</span>
        <span class="bar"><span style="width: {(s.count / most) * 100}%; background: {speciesColor(s.id)}"></span></span>
        <span class="spark">
          {#if counts}<Sparkline values={counts} color={speciesColor(s.id)} zero />{/if}
        </span>
        <span class="eats">{dietName(s.meanDiet)}</span>
      </button>
    {/each}
  </div>
  <p class="caption">
    The bar is members now; the line is members over the whole run.
    {#if pinned !== null}<button class="link" onclick={() => onPin(pinned!)}>Show every species again</button>{/if}
  </p>
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

  p {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .caption {
    margin: 6px 0 0;
  }

  .rows {
    display: flex;
    flex-direction: column;
  }

  .row {
    display: grid;
    grid-template-columns: 12px 3.2em 1fr 84px 3.4em;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    background: none;
    border: none;
    border-top: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font: inherit;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
    text-align: left;
    cursor: pointer;
  }

  .row:hover,
  .row:focus-visible,
  .row.pinned {
    background: rgba(255, 255, 255, 0.07);
  }

  .row.pinned {
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }

  .count {
    text-align: right;
    font-weight: 600;
  }

  .bar {
    height: 8px;
    background: rgba(255, 255, 255, 0.06);
    border-radius: 2px;
    overflow: hidden;
  }

  .bar span {
    display: block;
    height: 100%;
    min-width: 2px;
    border-radius: 2px;
  }

  .spark {
    height: 18px;
  }

  .eats {
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
</style>
