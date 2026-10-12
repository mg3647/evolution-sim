<script module lang="ts">
  import type { HistoryData } from '../worker/protocol';

  /** A gene with its own small chart. */
  export interface Trait {
    id: string;
    label: string;
    mean: keyof HistoryData & `mean${string}`;
    spread: keyof HistoryData & `spread${string}`;
    color: string;
    /** What the number means, for the tooltip. */
    hint: string;
    /** The title of this gene's selection chart in the Lab, if it has one. */
    selection?: string;
    /** Show the value as a percentage, with this after it. */
    percent?: string;
  }

  export const TRAITS: Trait[] = [
    { id: 'size', label: 'Size', mean: 'meanSize', spread: 'spreadSize', color: '#6cb6ff', hint: 'Body size; the first creatures are 1', selection: 'Size' },
    { id: 'speed', label: 'Speed', mean: 'meanSpeed', spread: 'spreadSpeed', color: '#ff8f6b', hint: 'Top speed; the first creatures are 1', selection: 'Speed' },
    { id: 'sensor', label: 'Sensor range', mean: 'meanSensorRange', spread: 'spreadSensorRange', color: '#b08cff', hint: 'How far it sees; the first creatures are 1', selection: 'Sensor range' },
    { id: 'diet', label: 'Diet', mean: 'meanDiet', spread: 'spreadDiet', color: '#e0566a', hint: '0 eats only plants, 1 only meat', selection: 'Diet (0 plants, 1 meat)' },
    { id: 'fur', label: 'Fur', mean: 'meanFur', spread: 'spreadFur', color: '#f2f2f2', hint: 'Thickness of coat, from 0 (none) to 1' },
    { id: 'defense', label: 'Defenses', mean: 'meanDefense', spread: 'spreadDefense', color: '#e8c468', hint: 'Spines or poison, from 0 (none) to 1' },
    { id: 'investment', label: 'Gives each child', mean: 'meanInvestment', spread: 'spreadInvestment', color: '#7fd6a4', hint: 'Share of its energy a parent hands to each child', percent: '' },
    { id: 'readiness', label: 'Breeds at', mean: 'meanReadiness', spread: 'spreadReadiness', color: '#9fc4e8', hint: 'How full its energy store must be before it can breed', percent: ' full' },
  ];
</script>

<script lang="ts">
  import Sparkline from './Sparkline.svelte';

  let {
    history,
    onOpen,
  }: {
    history: HistoryData | null;
    /** Called with the title of a gene's selection chart when its card is clicked. */
    onOpen: (selection: string) => void;
  } = $props();

  /** Samples averaged at each end when working out the change since the start. */
  const EDGE = 5;
  type Trend = 'up' | 'down' | 'steady';
  /** A change smaller than this, as a share of the gene's spread, counts as steady. */
  const STEADY = 0.25;

  function average(values: Float32Array, from: number, to: number): number {
    let total = 0;
    for (let k = from; k < to; k++) total += values[k]!;
    return total / Math.max(1, to - from);
  }

  const cards = $derived(
    TRAITS.map((trait) => {
      const mean = history?.[trait.mean] as Float32Array | undefined;
      const spread = history?.[trait.spread] as Float32Array | undefined;
      if (!mean || !spread || mean.length < 2) return { trait, mean: null, trend: 'steady' as Trend };
      const n = mean.length;
      const edge = Math.min(EDGE, Math.floor(n / 2));
      const start = average(mean, 0, edge);
      const now = average(mean, n - edge, n);
      const change = now - start;
      // Whether the gene has moved lately, judged against how varied it is.
      const recentFrom = Math.max(0, n - Math.max(edge * 2, Math.floor(n / 5)));
      const recent = now - average(mean, recentFrom, Math.min(n, recentFrom + edge));
      const scale = Math.max(1e-6, spread[n - 1]!);
      const trend: Trend = recent > STEADY * scale ? 'up' : recent < -STEADY * scale ? 'down' : 'steady';
      return { trait, mean, spread, now: mean[n - 1]!, spreadNow: spread[n - 1]!, change, trend };
    }),
  );

  const signed = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(2)}`;
  const ARROWS = { up: '▲', down: '▼', steady: '▬' } as const;
  const TREND_WORDS = { up: 'rising lately', down: 'falling lately', steady: 'steady lately' } as const;
</script>

<section>
  <h2>Traits</h2>
  <p>
    One chart per gene. The line is the average, the band is how varied the gene is (one standard deviation
    either side), and the arrow says whether it has been rising or falling lately. Click a card for its
    selection chart in the Lab.
  </p>
  <div class="cards">
    {#each cards as card (card.trait.id)}
      {@const trait = card.trait}
      <button
        class="card"
        disabled={!trait.selection}
        title="{trait.hint}.{trait.selection ? ' Click to open its selection chart in the Lab.' : ''}"
        onclick={() => trait.selection && onOpen(trait.selection)}
      >
        <span class="head">
          <span class="label">{trait.label}</span>
          {#if card.mean}
            <span class="arrow {card.trend}" title={TREND_WORDS[card.trend]}>{ARROWS[card.trend]}</span>
          {/if}
        </span>
        {#if card.mean}
          {#if trait.percent !== undefined}
            <span class="now">{Math.round(card.now * 100)}%{trait.percent}<small> ±{Math.round(card.spreadNow * 100)}</small></span>
          {:else}
            <span class="now">{card.now.toFixed(2)}<small> ±{card.spreadNow.toFixed(2)}</small></span>
          {/if}
          <span class="spark"><Sparkline values={card.mean} spread={card.spread} color={trait.color} /></span>
          <span class="change">{trait.percent !== undefined ? `${card.change >= 0 ? "+" : "−"}${Math.round(Math.abs(card.change) * 100)} points` : signed(card.change)} since the start</span>
        {:else}
          <span class="change">No history yet</span>
        {/if}
      </button>
    {/each}
  </div>
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
    margin: 0 0 8px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 8px;
  }

  .card {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px;
    background: #0f151c;
    border: 1px solid var(--border);
    border-radius: 4px;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .card:disabled {
    cursor: default;
    opacity: 1;
  }

  .card:not(:disabled):hover {
    border-color: var(--accent);
  }

  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
  }

  .label {
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .arrow {
    font-size: 10px;
  }

  .arrow.up {
    color: #4caf50;
  }

  .arrow.down {
    color: #e0566a;
  }

  .arrow.steady {
    color: var(--muted);
  }

  .now {
    font-size: 16px;
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .now small {
    font-size: 11px;
    font-weight: 400;
    color: var(--muted);
  }

  .spark {
    height: 34px;
  }

  .change {
    font-size: 11px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }
</style>
