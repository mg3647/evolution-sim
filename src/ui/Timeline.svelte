<script lang="ts">
  import type { HistoryData } from '../worker/protocol';
  import { speciesColor, speciesName } from './speciesColors';

  let {
    history,
    events,
    tick,
    onOpenLab,
  }: {
    history: HistoryData | null;
    /** Disasters and climate events from the world's own log. */
    events: { tick: number; label: string }[];
    tick: number;
    onOpenLab: () => void;
  } = $props();

  interface Milestone {
    tick: number;
    kind: 'born' | 'gone' | 'dieoff' | 'event';
    text: string;
    color: string;
  }

  const HEIGHT = 74;
  const TOP = 14;
  const BASE = HEIGHT - 6;
  /** A species counts as a milestone only once it has had at least this many members at once. */
  const MIN_PEAK = 25;
  /** A fall of this share of the population within WINDOW samples is a die-off. */
  const DIEOFF = 0.3;
  const WINDOW = 12;

  let width = $state(600);
  let hover = $state<number | null>(null);

  const n = $derived(history?.tick.length ?? 0);
  const last = $derived(n > 0 ? history!.tick[n - 1]! : 0);

  /** Things worth marking: new and vanished species, steep falls in population, and events. */
  const milestones = $derived.by<Milestone[]>(() => {
    if (!history || n < 3) return [];
    const out: Milestone[] = [];
    for (const species of history.species) {
      if (species.id === 0) continue;
      const counts = species.counts;
      let first = -1;
      let lastSeen = -1;
      let peak = 0;
      for (let k = 0; k < n; k++) {
        const c = counts[k] ?? 0;
        if (c > 0) {
          if (first < 0) first = k;
          lastSeen = k;
          if (c > peak) peak = c;
        }
      }
      if (peak < MIN_PEAK || first < 0) continue;
      const color = speciesColor(species.id);
      if (first > 0) {
        out.push({ tick: history.tick[first]!, kind: 'born', text: `${speciesName(species.id)} appears`, color });
      }
      if (lastSeen < n - 3) {
        out.push({ tick: history.tick[lastSeen]!, kind: 'gone', text: `${speciesName(species.id)} dies out`, color });
      }
    }
    // Die-offs: find the steepest falls, then keep one per stretch.
    let k = WINDOW;
    while (k < n) {
      const before = Math.max(...Array.from(history.population.subarray(k - WINDOW, k)));
      const now = history.population[k]!;
      if (before > 100 && now < before * (1 - DIEOFF)) {
        out.push({
          tick: history.tick[k]!,
          kind: 'dieoff',
          text: `Population falls ${Math.round((1 - now / before) * 100)}% (${Math.round(before).toLocaleString()} to ${Math.round(now).toLocaleString()})`,
          color: '#e0566a',
        });
        k += WINDOW * 2;
      } else {
        k++;
      }
    }
    for (const event of events) out.push({ tick: event.tick, kind: 'event', text: event.label, color: '#ffc470' });
    return out.sort((a, b) => a.tick - b.tick);
  });

  const x = (t: number) => (last > 0 ? 4 + (t / last) * (width - 8) : 4);

  const area = $derived.by(() => {
    if (!history || n < 2) return { fill: '', line: '' };
    let top = 1;
    for (let k = 0; k < n; k++) top = Math.max(top, history.population[k]!);
    const step = Math.max(1, Math.ceil(n / Math.max(60, width / 2)));
    const pts: string[] = [];
    for (let k = 0; k < n; k += step) {
      pts.push(`${x(history.tick[k]!).toFixed(1)} ${(BASE - (history.population[k]! / top) * (BASE - TOP)).toFixed(1)}`);
    }
    pts.push(`${x(history.tick[n - 1]!).toFixed(1)} ${(BASE - (history.population[n - 1]! / top) * (BASE - TOP)).toFixed(1)}`);
    const line = 'M' + pts.join(' L');
    return { line, fill: `${line} L${x(history.tick[n - 1]!).toFixed(1)} ${BASE} L${x(history.tick[0]!).toFixed(1)} ${BASE} Z` };
  });

  /** The index of the sample nearest a position along the strip. */
  function indexAt(px: number): number {
    if (!history || n === 0) return 0;
    const t = ((px - 4) / (width - 8)) * last;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (history.tick[mid]! < t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  const near = $derived.by(() => {
    if (hover === null || !history || n === 0) return null;
    const k = indexAt(hover);
    const t = history.tick[k]!;
    const marks = milestones.filter((m) => Math.abs(x(m.tick) - hover!) < 7);
    return { k, t, marks };
  });

  function year(t: number): string {
    return t.toLocaleString();
  }
</script>

<div class="strip" bind:clientWidth={width}>
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <svg
    {width}
    height={HEIGHT}
    role="img"
    aria-label="Population over time, with marks for notable events"
    onmousemove={(e) => (hover = e.clientX - e.currentTarget.getBoundingClientRect().left)}
    onmouseleave={() => (hover = null)}
    onclick={onOpenLab}
    onkeydown={() => {}}
  >
    {#if area.fill}
      <path d={area.fill} fill="#e8c468" opacity="0.16" />
      <path d={area.line} fill="none" stroke="#e8c468" stroke-width="1.4" />
    {/if}
    {#each milestones as m, i (i)}
      {@const cx = x(m.tick)}
      {#if m.kind === 'born'}
        <circle {cx} cy={TOP - 5} r="4" fill={m.color} stroke="#0b0f14" stroke-width="1" />
      {:else if m.kind === 'gone'}
        <path d="M{cx - 3.5} {TOP - 8.5} l7 7 m0 -7 l-7 7" stroke={m.color} stroke-width="1.8" />
      {:else if m.kind === 'dieoff'}
        <path d="M{cx - 4.5} {TOP - 9} h9 l-4.5 8 z" fill={m.color} />
      {:else}
        <path d="M{cx} {TOP - 9} l4 4 l-4 4 l-4 -4 z" fill={m.color} />
      {/if}
      <line x1={cx} x2={cx} y1={TOP} y2={BASE} stroke={m.color} stroke-width="1" opacity="0.28" />
    {/each}
    {#if near}
      <line x1={x(near.t)} x2={x(near.t)} y1="0" y2={HEIGHT} stroke="#dbe4ec" stroke-width="1" opacity="0.5" />
    {/if}
  </svg>

  {#if near && history}
    <div class="tip" style="left: {Math.min(Math.max(x(near.t), 120), width - 120)}px">
      <b>Tick {year(near.t)}</b> · {Math.round(history.population[near.k]!).toLocaleString()} creatures
      {#each near.marks as m (m.tick + m.text)}
        <div style="color: {m.color}">{m.text}</div>
      {/each}
    </div>
  {/if}

  <div class="legend">
    <span class="title">Run so far · {year(tick)} ticks</span>
    <span><i class="line"></i>population</span>
    <span><i class="dot rainbow"></i>new species, in its colour</span>
    <span><i class="x">✕</i>species gone</span>
    <span><i class="tri"></i>big die-off</span>
    <span><i class="dia"></i>event</span>
    <span class="more">Click for the Lab</span>
  </div>
</div>

<style>
  .strip {
    position: relative;
    flex-shrink: 0;
    border-top: 1px solid var(--border);
    background: var(--panel);
  }

  svg {
    display: block;
    cursor: pointer;
  }

  .tip {
    position: absolute;
    bottom: 100%;
    transform: translateX(-50%);
    margin-bottom: 4px;
    padding: 5px 9px;
    background: rgba(0, 0, 0, 0.88);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    pointer-events: none;
    z-index: 3;
  }

  .legend {
    display: flex;
    gap: 14px;
    align-items: center;
    padding: 2px 10px 4px;
    font-size: 11px;
    color: var(--muted);
  }

  .legend .title {
    color: var(--text);
    font-weight: 600;
  }

  .legend .more {
    margin-left: auto;
  }

  .line {
    display: inline-block;
    width: 12px;
    height: 2px;
    margin-right: 4px;
    vertical-align: middle;
    background: #e8c468;
  }

  .dot {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 50%;
  }

  .rainbow {
    background: conic-gradient(#e69f00, #56b4e9, #f0e442, #cc79a7, #1fc08f, #e69f00);
  }

  .x {
    margin-right: 3px;
    font-style: normal;
    color: #b08cff;
  }

  .tri {
    display: inline-block;
    margin-right: 4px;
    border-left: 4px solid transparent;
    border-right: 4px solid transparent;
    border-bottom: 7px solid #e0566a;
  }

  .dia {
    display: inline-block;
    width: 7px;
    height: 7px;
    margin-right: 4px;
    background: #ffc470;
    transform: rotate(45deg);
  }
</style>
