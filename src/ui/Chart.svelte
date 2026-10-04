<script module lang="ts">
  export interface ChartSeries {
    label: string;
    color: string;
    /** Which y axis the series is measured on. Defaults to the left one. */
    axis?: 'left' | 'right';
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  const HEIGHT = 170;
  const AXIS_COLOR = '#8a9aa9';
  const GRID_COLOR = 'rgba(138, 154, 169, 0.14)';

  let {
    title,
    series,
    data,
  }: { title: string; series: ChartSeries[]; data: uPlot.AlignedData | null } = $props();

  let host: HTMLDivElement;
  let plot: uPlot | undefined;

  onMount(() => {
    const axis = (extra: Partial<uPlot.Axis> = {}): uPlot.Axis => ({
      stroke: AXIS_COLOR,
      grid: { stroke: GRID_COLOR, width: 1 },
      ticks: { stroke: GRID_COLOR, width: 1 },
      font: '11px system-ui, sans-serif',
      size: 44,
      ...extra,
    });
    const hasRight = series.some((s) => s.axis === 'right');

    plot = new uPlot(
      {
        width: host.clientWidth,
        height: HEIGHT,
        scales: { x: { time: false } },
        legend: { live: false },
        cursor: { drag: { x: false, y: false } },
        series: [
          { label: 'Tick' },
          ...series.map((s) => ({
            label: s.label,
            stroke: s.color,
            width: 1.5,
            scale: s.axis === 'right' ? 'right' : 'y',
          })),
        ],
        axes: [
          axis({ size: 28 }),
          axis(),
          ...(hasRight ? [axis({ scale: 'right', side: 1, grid: { show: false } })] : []),
        ],
      },
      data ?? [[]],
      host,
    );

    const observer = new ResizeObserver(() => {
      plot?.setSize({ width: host.clientWidth, height: HEIGHT });
    });
    observer.observe(host);
    return () => {
      observer.disconnect();
      plot?.destroy();
      plot = undefined;
    };
  });

  $effect(() => {
    if (data) plot?.setData(data);
  });
</script>

<section>
  <h2>{title}</h2>
  <div bind:this={host}></div>
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

  section :global(.u-legend) {
    font-size: 12px;
    color: var(--text);
  }
</style>
