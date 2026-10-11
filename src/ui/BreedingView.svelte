<script lang="ts">
  import type { BreedingLinks, BreedingSplit } from '../sim/associations';
  import { habitLabel, percent, TRAIT_HALVES, times } from './habits';

  /** Habits listed on each side. */
  const HABITS_SHOWN = 6;
  /** Bars run from a quarter to four times as many young, on a log scale. */
  const SCALE = Math.log(4);
  const MORE = '#7fd6c2';
  const FEWER = '#ff8f6b';

  let { breeding, onPick }: { breeding: BreedingLinks | null; onPick?: (pathway: number) => void } = $props();

  const ratio = (s: BreedingSplit) => (s.withoutRate > 0 ? s.withRate / s.withoutRate : s.withRate > 0 ? Infinity : 1);
  const clear = (s: BreedingSplit) => Math.abs(s.z) >= 2;

  /** Width and offset of a bar drawn out from the middle, for a ratio of young. */
  function bar(r: number): string {
    const along = Math.max(-1, Math.min(1, Math.log(Math.max(1e-6, r)) / SCALE));
    const half = Math.abs(along) * 50;
    return `left: ${along < 0 ? 50 - half : 50}%; width: ${half}%; background: ${along >= 0 ? MORE : FEWER};`;
  }

  const traits = $derived(
    (breeding?.traits ?? [])
      .map((t) => ({ ...t, r: ratio(t) }))
      .sort((a, b) => Math.abs(Math.log(b.r)) - Math.abs(Math.log(a.r))),
  );
  const habits = $derived.by(() => {
    const all = (breeding?.habits ?? []).filter(clear).map((h) => ({ ...h, r: ratio(h) }));
    return {
      helps: all.filter((h) => h.z > 0).sort((a, b) => b.z - a.z).slice(0, HABITS_SHOWN),
      hurts: all.filter((h) => h.z < 0).sort((a, b) => a.z - b.z).slice(0, HABITS_SHOWN),
    };
  });
</script>

{#if !breeding || breeding.adults < 16}
  <p class="empty">Not enough adults yet to compare.</p>
{:else}
  <p class="summary">
    {breeding.adults.toLocaleString()} adults (at least {breeding.minAge.toLocaleString()} ticks old) have on average
    <b>{breeding.meanRate.toFixed(2)}</b> young per 1,000 ticks lived.
  </p>
  <div class="columns">
    <div>
      <h3>Traits: upper half against lower half</h3>
      <ul>
        {#each traits as t (t.trait)}
          <li class:faint={!clear(t)} title="{t.withCount.toLocaleString()} in the upper half, {t.withoutCount.toLocaleString()} in the lower; {clear(t) ? 'a clear difference' : 'could be chance'}">
            <span class="label">{TRAIT_HALVES[t.trait][0]}</span>
            <span class="track"><span class="mid"></span><span class="fill" style={bar(t.r)}></span></span>
            <span class="value">{times(t.r)}</span>
          </li>
        {/each}
      </ul>
    </div>
    <div>
      <h3>Habits that go with more young</h3>
      {#if habits.helps.length === 0}
        <p class="empty">None stands out clearly.</p>
      {:else}
        <ul>
          {#each habits.helps as h (h.pathway)}
            <li title="{percent(h.withCount / breeding.adults)} of adults have it">
              <button class="label link" onclick={() => onPick?.(h.pathway)}>{habitLabel(h.pathway)}</button>
              <span class="track"><span class="mid"></span><span class="fill" style={bar(h.r)}></span></span>
              <span class="value">{times(h.r)}</span>
            </li>
          {/each}
        </ul>
      {/if}
      <h3>Habits that go with fewer</h3>
      {#if habits.hurts.length === 0}
        <p class="empty">None stands out clearly.</p>
      {:else}
        <ul>
          {#each habits.hurts as h (h.pathway)}
            <li title="{percent(h.withCount / breeding.adults)} of adults have it">
              <button class="label link" onclick={() => onPick?.(h.pathway)}>{habitLabel(h.pathway)}</button>
              <span class="track"><span class="mid"></span><span class="fill" style={bar(h.r)}></span></span>
              <span class="value">{times(h.r)}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
  <p class="caption">
    Each bar is how many young one side has for every one the other side has: right of the line, more. Traits split
    adults at the middle value; habits compare those with it to those without. Every comparison is made within each species and then
    pooled, so a habit gets no credit just for being common in a species that is thriving. Faint rows could be chance.
    These are associations among the living, not proof: a habit can ride along with another that matters.
  </p>
{/if}

<style>
  .summary {
    margin: 0 0 8px;
    font-size: 12px;
    color: var(--text);
  }

  .columns {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 6px 20px;
  }

  h3 {
    margin: 6px 0 4px;
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
    grid-template-columns: minmax(0, 1fr) 110px 40px;
    gap: 8px;
    align-items: center;
    padding: 2px 0;
    font-size: 12px;
  }

  li.faint {
    opacity: 0.45;
  }

  .label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  }

  .link:hover {
    text-decoration: underline;
  }

  .track {
    position: relative;
    height: 10px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.05);
  }

  .mid {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--muted);
  }

  .fill {
    position: absolute;
    top: 1px;
    bottom: 1px;
    border-radius: 2px;
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .caption,
  .empty {
    margin: 8px 0 0;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }
</style>
