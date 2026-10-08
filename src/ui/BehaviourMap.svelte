<script lang="ts">
  /**
   * A grid of body types: diet along the bottom, speed up the side. Each cell is coloured by the species
   * that has filled it most often over the run and fades when few creatures were ever there.
   */
  import { speciesColor } from './speciesColors';

  let {
    dietBins,
    speedBins,
    cells,
  }: {
    dietBins: number;
    speedBins: number;
    /** Row by row from the slowest speed, plants first in each row. */
    cells: { species: number; share: number; samples: number }[];
  } = $props();

  const busiest = $derived(cells.reduce((most, cell) => Math.max(most, cell.samples), 0));
  const filled = $derived(cells.filter((cell) => cell.samples > 0).length);
  let hovered = $state<number | null>(null);

  /** Rows are drawn fastest at the top. */
  const order = $derived(
    Array.from({ length: speedBins }, (_, row) => speedBins - 1 - row).flatMap((v) =>
      Array.from({ length: dietBins }, (_, d) => v * dietBins + d),
    ),
  );
  const cell = $derived(hovered === null ? null : cells[hovered]!);
</script>

<div class="map" style="grid-template-columns: repeat({dietBins}, 1fr)">
  {#each order as at (at)}
    {@const c = cells[at]!}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="cell"
      style="background: {c.samples > 0 ? speciesColor(c.species) : 'transparent'}; opacity: {c.samples > 0
        ? 0.25 + 0.75 * Math.sqrt(c.samples / Math.max(1, busiest))
        : 1}"
      onmouseenter={() => (hovered = at)}
      onmouseleave={() => (hovered = null)}
    ></div>
  {/each}
</div>
<div class="axis"><span>Plant-eaters</span><span>Meat-eaters</span></div>
<p class="readout">
  {#if cell && cell.samples > 0}
    {cell.species === 0 ? 'The smaller species' : `Species ${cell.species}`} filled this type of creature{' '}
    <b>{Math.round(cell.share * 100)}%</b> of the time. Speed runs from slow at the bottom to fast at the top.
  {:else}
    {filled} of {cells.length} kinds of creature (diet by speed) have been seen. Colour is the species that filled
    each most; paler means fewer creatures.
  {/if}
</p>

<style>
  .map {
    display: grid;
    gap: 1px;
    width: 320px;
    max-width: 100%;
    aspect-ratio: 1;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--border);
    overflow: hidden;
  }

  .cell {
    min-height: 0;
  }

  .axis {
    display: flex;
    justify-content: space-between;
    width: 320px;
    max-width: 100%;
    margin-top: 4px;
    font-size: 11px;
    color: var(--muted);
  }

  .readout {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }

  .readout b {
    color: var(--text);
  }
</style>
