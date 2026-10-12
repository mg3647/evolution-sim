<script lang="ts">
  import { PATHWAY_COUNT } from '../sim/associations';
  import type { LabData } from '../worker/protocol';
  import { habitLabel, percent } from './habits';
  import Sparkline from './Sparkline.svelte';

  /** A habit must reach this share at one end of the window to be listed. */
  const MIN_SHARE = 0.05;

  let {
    adoption,
    shown = 6,
    compact = false,
    onPick,
  }: {
    adoption: LabData['adoption'] | null;
    /** Rows in each list. */
    shown?: number;
    /** Only the rising list, for the side panel. */
    compact?: boolean;
    onPick?: (pathway: number) => void;
  } = $props();

  /** Compare with the start of the run, or with a quarter of the run ago. */
  let span = $state<'recent' | 'run'>('recent');

  const lists = $derived.by(() => {
    const shares = adoption?.shares ?? [];
    const n = shares.length;
    if (n < 2) return null;
    const from = span === 'run' ? 0 : Math.max(0, n - 1 - Math.ceil(n / 4));
    const then = shares[from]!;
    const now = shares[n - 1]!;
    const moves: { pathway: number; then: number; now: number; change: number }[] = [];
    for (let p = 0; p < PATHWAY_COUNT; p++) {
      if (Math.max(then[p]!, now[p]!) < MIN_SHARE) continue;
      moves.push({ pathway: p, then: then[p]!, now: now[p]!, change: now[p]! - then[p]! });
    }
    const line = (p: number) => shares.slice(from).map((s) => s[p]!);
    const rising = moves
      .filter((m) => m.change >= 0.02)
      .sort((a, b) => b.change - a.change)
      .slice(0, shown)
      .map((m) => ({ ...m, line: line(m.pathway) }));
    const fading = moves
      .filter((m) => m.change <= -0.02)
      .sort((a, b) => a.change - b.change)
      .slice(0, shown)
      .map((m) => ({ ...m, line: line(m.pathway) }));
    return { rising, fading, fromTick: adoption!.ticks[from]! };
  });
</script>

<div class="trends" class:compact>
  {#if !compact}
    <div class="span" role="radiogroup" aria-label="Compare with">
      <button class:on={span === 'recent'} role="radio" aria-checked={span === 'recent'} onclick={() => (span = 'recent')}>Lately</button>
      <button class:on={span === 'run'} role="radio" aria-checked={span === 'run'} onclick={() => (span = 'run')}>Whole run</button>
      {#if lists}<span class="since">since tick {lists.fromTick.toLocaleString()}</span>{/if}
    </div>
  {/if}
  {#if !lists}
    <p class="empty">Habits are sampled as the world runs; come back in a few hundred ticks.</p>
  {:else}
    <div class="lists">
      {#each compact ? [{ title: 'Spreading', rows: lists.rising, color: '#7fd6c2' }] : [{ title: 'Spreading', rows: lists.rising, color: '#7fd6c2' }, { title: 'Fading', rows: lists.fading, color: '#ff8f6b' }] as list (list.title)}
        <div>
          {#if !compact}<h3>{list.title}</h3>{/if}
          {#if list.rows.length === 0}
            <p class="empty">Nothing has {list.title === 'Spreading' ? 'spread' : 'faded'} much.</p>
          {:else}
            <ul>
              {#each list.rows as row (row.pathway)}
                <li>
                  <button class="link" onclick={() => onPick?.(row.pathway)} title="{habitLabel(row.pathway)}: show this habit on the map">
                    {habitLabel(row.pathway)}
                  </button>
                  <span class="spark" style="width: {compact ? 60 : 90}px"><Sparkline values={row.line} width={compact ? 60 : 90} height={20} zero color={list.color} /></span>
                  <span class="change">{percent(row.then)} → <b>{percent(row.now)}</b></span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .span {
    display: flex;
    align-items: center;
    gap: 4px;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .span button {
    margin: 0;
    padding: 2px 8px;
    font-size: 12px;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 12px;
  }

  .span button.on {
    color: var(--text);
    border-color: var(--accent, #6cb6ff);
  }

  .since {
    margin-left: 6px;
    color: var(--muted);
  }

  .lists {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
    gap: 6px 18px;
  }

  h3 {
    margin: 0 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  li {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto 78px;
    gap: 8px;
    align-items: center;
    padding: 3px 0;
    border-top: 1px solid var(--border);
    font-size: 12px;
  }

  .compact li {
    grid-template-columns: minmax(0, 1fr) auto 70px;
  }

  .link {
    margin: 0;
    padding: 0;
    border: 0;
    background: none;
    color: var(--text);
    font: inherit;
    text-align: left;
    cursor: pointer;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .link:hover {
    text-decoration: underline;
  }

  .spark {
    display: block;
    height: 20px;
  }

  .change {
    text-align: right;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .change b {
    color: var(--text);
  }

  .empty {
    margin: 4px 0;
    font-size: 12px;
    color: var(--muted);
  }
</style>
