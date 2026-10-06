<script module lang="ts">
  export interface ChartSeries {
    label: string;
    color: string;
    /** Which y axis the series is measured on. Defaults to the left one. */
    axis?: 'left' | 'right';
  }

  /** Something that happened at a tick, drawn as a dashed line across the chart. */
  export interface ChartEvent {
    tick: number;
    label: string;
  }
</script>

<script lang="ts">
  import { onMount } from 'svelte';
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';

  const HEIGHT = 170;
  const AXIS_COLOR = '#8a9aa9';
  const GRID_COLOR = 'rgba(138, 154, 169, 0.14)';
  const EVENT_COLOR = 'rgba(255, 196, 112, 0.75)';
  /** How solid a stacked band is filled. */
  const FILL_ALPHA = '99';

  let {
    title,
    note,
    series,
    data,
    events = [],
    stacked = false,
  }: {
    title: string;
    /** Optional line under the title explaining what the chart shows. */
    note?: string;
    series: ChartSeries[];
    data: uPlot.AlignedData | null;
    /** Events to mark on the chart. Each is a dashed line with its name at the top. */
    events?: ChartEvent[];
    /** Draw the series as bands piled on top of one another, so the top edge is their total. */
    stacked?: boolean;
  } = $props();

  let host: HTMLDivElement;
  let plot: uPlot | undefined;
  /** The values as given, which the hover readout shows even when the chart draws them piled up. */
  let given: uPlot.AlignedData | null = null;

  /** Pile each series on the ones before it. */
  function pile(input: uPlot.AlignedData): uPlot.AlignedData {
    const out: (number | null | undefined)[][] = [input[0] as number[]];
    const total = new Float64Array(input[0].length);
    for (let s = 1; s < input.length; s++) {
      const values = input[s]!;
      const piled = new Array<number>(total.length);
      for (let k = 0; k < total.length; k++) {
        total[k]! += (values[k] as number | null | undefined) ?? 0;
        piled[k] = total[k]!;
      }
      out.push(piled);
    }
    return out as uPlot.AlignedData;
  }

  function show(input: uPlot.AlignedData): void {
    given = input;
    plot?.setData(stacked ? pile(input) : input);
  }

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
          ...series.map((s, k) => ({
            label: s.label,
            stroke: s.color,
            width: stacked ? 1 : 1.5,
            scale: s.axis === 'right' ? 'right' : 'y',
            ...(stacked
              ? {
                  fill: s.color + FILL_ALPHA,
                  // The readout gives the series' own value, not the height of the pile.
                  value: (_u: uPlot, _piled: number | null, _series: number, index: number | null) => {
                    const own = index === null ? null : (given?.[k + 1]?.[index] as number | null | undefined);
                    return own === null || own === undefined ? '--' : Number(own.toPrecision(3)).toLocaleString();
                  },
                }
              : {}),
          })),
        ],
        // Each band is filled down to the one below it.
        bands: stacked ? series.slice(1).map((_, k) => ({ series: [k + 2, k + 1] as [number, number] })) : undefined,
        axes: [
          axis({ size: 28 }),
          axis(),
          ...(hasRight ? [axis({ scale: 'right', side: 1, grid: { show: false } })] : []),
        ],
        hooks: {
          draw: [
            (u) => {
              const xs = u.data[0];
              if (events.length === 0 || xs.length === 0) return;
              const first = xs[0]!;
              const last = xs[xs.length - 1]!;
              const { ctx, bbox } = u;
              ctx.save();
              ctx.strokeStyle = EVENT_COLOR;
              ctx.fillStyle = EVENT_COLOR;
              ctx.lineWidth = devicePixelRatio;
              ctx.setLineDash([4 * devicePixelRatio, 4 * devicePixelRatio]);
              ctx.font = `${10 * devicePixelRatio}px system-ui, sans-serif`;
              ctx.textBaseline = 'top';
              let lastLabelEnd = -Infinity;
              for (const event of events) {
                if (event.tick < first || event.tick > last) continue;
                const x = u.valToPos(event.tick, 'x', true);
                ctx.beginPath();
                ctx.moveTo(x, bbox.top);
                ctx.lineTo(x, bbox.top + bbox.height);
                ctx.stroke();
                // Name it, unless that would run over the name before or off the chart.
                const width = ctx.measureText(event.label).width;
                const at = x + 3 * devicePixelRatio;
                if (at > lastLabelEnd && at + width < bbox.left + bbox.width) {
                  ctx.fillText(event.label, at, bbox.top + 2 * devicePixelRatio);
                  lastLabelEnd = at + width + 6 * devicePixelRatio;
                }
              }
              ctx.restore();
            },
          ],
        },
      },
      // One empty column per series, so an empty chart still has every scale to draw.
      [[], ...series.map(() => [])] as uPlot.AlignedData,
      host,
    );
    if (data) show(data);

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
    if (data) show(data);
  });

  $effect(() => {
    // Redraw when the list of events changes.
    void events.length;
    if (given && given[0].length > 1) plot?.redraw(false);
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
