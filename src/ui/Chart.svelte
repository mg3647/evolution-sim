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
    note,
    series,
    data,
    events = [],
  }: {
    title: string;
    /** Optional line under the title explaining what the chart shows. */
    note?: string;
    series: ChartSeries[];
    data: uPlot.AlignedData | null;
    /** Event marks to draw on the chart (tick position and label). */
    events?: Array<{ tick: number; label: string; color?: string }>;
  } = $props();

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
        legend: { live: true },
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
        plugins: [
          {
            hooks: {
              drawClear: (u) => {
                // Draw event lines
                if (!data || !data[0] || data[0].length === 0) return;
                const xMin = (data[0][0] as number) ?? 0;
                const xMax = (data[0][data[0].length - 1] as number) ?? 0;

                for (const event of events) {
                  if (event.tick < xMin || event.tick > xMax) continue;

                  const xPos = u.valToPos(event.tick, 'x');
                  const color = event.color || '#8a9aa9';

                  const ctx = u.ctx;
                  ctx.save();
                  ctx.strokeStyle = color;
                  ctx.lineWidth = 1;
                  ctx.setLineDash([4, 4]);
                  ctx.beginPath();
                  ctx.moveTo(xPos, 0);
                  ctx.lineTo(xPos, u.bbox.height);
                  ctx.stroke();
                  ctx.restore();
                }
              },
            },
          },
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
  {#if note}<p>{note}</p>{/if}
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

  p {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  section :global(.u-legend) {
    font-size: 12px;
    color: var(--text);
  }
</style>
