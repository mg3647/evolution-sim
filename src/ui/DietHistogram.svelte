<script lang="ts">
  /** A bar per step of the diet gene, from only plants on the left to only meat on the right. */
  const PLANT_COLOR = '#4caf50';
  const MEAT_COLOR = '#e0566a';
  const WIDTH = 400;
  const HEIGHT = 150;
  const BASE = HEIGHT - 16;

  let { bins }: { bins: number[] } = $props();

  let hovered = $state<number | null>(null);
  const total = $derived(bins.reduce((sum, count) => sum + count, 0));
  const tallest = $derived(Math.max(1, ...bins));
  const step = $derived(WIDTH / Math.max(1, bins.length));

  function range(k: number): string {
    return `${(k / bins.length).toFixed(2)} to ${((k + 1) / bins.length).toFixed(2)}`;
  }
</script>

<svg viewBox="0 0 {WIDTH} {HEIGHT}" role="img" aria-label="How many creatures have each diet gene value">
  {#each bins as count, k (k)}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <rect
      x={k * step + 1}
      y={BASE - (count / tallest) * (BASE - 4)}
      width={step - 2}
      height={(count / tallest) * (BASE - 4)}
      fill={k >= bins.length / 2 ? MEAT_COLOR : PLANT_COLOR}
      opacity={hovered === null || hovered === k ? 1 : 0.55}
      onmouseenter={() => (hovered = k)}
      onmouseleave={() => (hovered = null)}
    />
  {/each}
  <line x1="0" y1={BASE} x2={WIDTH} y2={BASE} stroke="#8a9aa9" stroke-width="1" />
  <line x1={WIDTH / 2} y1="0" x2={WIDTH / 2} y2={BASE} stroke="#8a9aa9" stroke-width="1" stroke-dasharray="3 3" />
  <text x="0" y={HEIGHT - 3}>0: only plants</text>
  <text x={WIDTH / 2} y={HEIGHT - 3} text-anchor="middle">0.5</text>
  <text x={WIDTH} y={HEIGHT - 3} text-anchor="end">1: only meat</text>
</svg>
<p class="readout">
  {#if hovered !== null}
    Diet {range(hovered)}: <b>{bins[hovered]!.toLocaleString()}</b> creatures ({total > 0
      ? Math.round((bins[hovered]! / total) * 100)
      : 0}%)
  {:else}
    Point at a bar to read it. Green bars are plant-eaters, red bars meat-eaters.
  {/if}
</p>

<style>
  svg {
    display: block;
    width: 100%;
    height: auto;
  }

  text {
    fill: #8a9aa9;
    font-size: 10px;
  }

  .readout {
    margin: 6px 0 0;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .readout b {
    color: var(--text);
  }
</style>
