<script lang="ts">
  /** A small line of values over time, with an optional band around it. No axes: it shows shape, not numbers. */
  let {
    values,
    spread,
    color = '#e8c468',
    width = 120,
    height = 28,
    zero = false,
  }: {
    values: ArrayLike<number>;
    /** If given, a band from each value minus this to the value plus it. */
    spread?: ArrayLike<number>;
    color?: string;
    width?: number;
    height?: number;
    /** Start the scale at zero, so heights can be compared between sparklines. */
    zero?: boolean;
  } = $props();

  /** Points drawn at most, so a long history costs no more than a short one. */
  const POINTS = 80;

  const shape = $derived.by(() => {
    const n = values.length;
    if (n < 2) return null;
    const step = Math.max(1, Math.ceil(n / POINTS));
    const at: number[] = [];
    for (let k = 0; k < n; k += step) at.push(k);
    if (at[at.length - 1] !== n - 1) at.push(n - 1);
    let low = zero ? 0 : Infinity;
    let high = -Infinity;
    for (const k of at) {
      const band = spread ? (spread[k] ?? 0) : 0;
      low = Math.min(low, values[k]! - band);
      high = Math.max(high, values[k]! + band);
    }
    const range = high > low ? high - low : 1;
    const x = (k: number) => (k / (n - 1)) * width;
    const y = (value: number) => height - 1 - ((value - low) / range) * (height - 2);
    const line = at.map((k, j) => `${j === 0 ? 'M' : 'L'}${x(k).toFixed(1)} ${y(values[k]!).toFixed(1)}`).join(' ');
    let band = '';
    if (spread) {
      const upper = at.map((k, j) => `${j === 0 ? 'M' : 'L'}${x(k).toFixed(1)} ${y(values[k]! + (spread[k] ?? 0)).toFixed(1)}`);
      const lower = [...at].reverse().map((k) => `L${x(k).toFixed(1)} ${y(values[k]! - (spread[k] ?? 0)).toFixed(1)}`);
      band = `${upper.join(' ')} ${lower.join(' ')} Z`;
    }
    return { line, band };
  });
</script>

<svg viewBox="0 0 {width} {height}" preserveAspectRatio="none" aria-hidden="true">
  {#if shape}
    {#if shape.band}<path d={shape.band} fill={color} opacity="0.22" />{/if}
    <path d={shape.line} fill="none" stroke={color} stroke-width="1.3" vector-effect="non-scaling-stroke" />
  {/if}
</svg>

<style>
  svg {
    display: block;
    width: 100%;
    height: 100%;
  }
</style>
