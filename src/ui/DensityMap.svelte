<script lang="ts">
  /** A heatmap of where creatures were during one stretch of the run, with a slider to pick the stretch. */
  const SIZE = 320;

  let {
    grid,
    frames,
    ticks,
  }: {
    /** Cells along each side of the grid. */
    grid: number;
    /** One grid of counts per stretch of the run, oldest first. */
    frames: Float32Array[];
    /** The tick each stretch ends at. */
    ticks: number[];
  } = $props();

  let canvas = $state<HTMLCanvasElement>();
  /** The stretch shown, or null to follow the latest. */
  let chosen = $state<number | null>(null);
  let hovered = $state<{ share: number } | null>(null);

  const index = $derived(Math.min(chosen ?? frames.length - 1, frames.length - 1));
  const frame = $derived(frames[index]);
  const total = $derived(frame ? frame.reduce((sum, count) => sum + count, 0) : 0);
  const from = $derived(index > 0 ? ticks[index - 1]! : 0);

  /** Dark blue through orange to pale yellow, for a share of the busiest cell. */
  function heat(t: number): [number, number, number] {
    const stops: [number, number, number][] = [
      [14, 20, 34],
      [58, 52, 128],
      [176, 62, 110],
      [244, 132, 60],
      [252, 236, 150],
    ];
    const at = Math.min(0.9999, Math.max(0, t)) * (stops.length - 1);
    const a = stops[Math.floor(at)]!;
    const b = stops[Math.floor(at) + 1]!;
    const f = at - Math.floor(at);
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  }

  $effect(() => {
    const ctx = canvas?.getContext('2d');
    if (!ctx || !frame) return;
    const image = ctx.createImageData(grid, grid);
    let most = 0;
    for (const count of frame) most = Math.max(most, count);
    for (let cell = 0; cell < frame.length; cell++) {
      // The square root keeps quiet places visible beside crowded ones.
      const [r, g, b] = heat(most > 0 ? Math.sqrt(frame[cell]! / most) : 0);
      image.data[cell * 4] = r;
      image.data[cell * 4 + 1] = g;
      image.data[cell * 4 + 2] = b;
      image.data[cell * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });

  function point(event: MouseEvent): void {
    if (!canvas || !frame || total === 0) return;
    const box = canvas.getBoundingClientRect();
    const gx = Math.min(grid - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * grid)));
    const gy = Math.min(grid - 1, Math.max(0, Math.floor(((event.clientY - box.top) / box.height) * grid)));
    hovered = { share: frame[gy * grid + gx]! / total };
  }
</script>

{#if frames.length > 0}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <canvas
    bind:this={canvas}
    width={grid}
    height={grid}
    style="width: {SIZE}px"
    onmousemove={point}
    onmouseleave={() => (hovered = null)}
  ></canvas>
  <label>
    <input
      type="range"
      min="0"
      max={frames.length - 1}
      step="1"
      value={index}
      oninput={(event) => {
        const value = Number(event.currentTarget.value);
        chosen = value >= frames.length - 1 ? null : value;
      }}
    />
    <span>Ticks {Math.round(from).toLocaleString()} to {Math.round(ticks[index] ?? 0).toLocaleString()}</span>
  </label>
  <p class="readout">
    {#if hovered}
      This spot held <b>{(hovered.share * 100).toFixed(1)}%</b> of the creatures counted in this stretch. An even
      spread would be {(100 / (grid * grid)).toFixed(1)}%.
    {:else}
      Brighter means more creatures spent time there. Drag the slider to go back in time; at the far right it
      follows the latest stretch.
    {/if}
  </p>
{:else}
  <p class="readout">The first map appears after a few hundred ticks.</p>
{/if}

<style>
  canvas {
    display: block;
    max-width: 100%;
    aspect-ratio: 1;
    image-rendering: pixelated;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 8px;
    font-size: 12px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  input {
    flex: 1;
    max-width: 220px;
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
