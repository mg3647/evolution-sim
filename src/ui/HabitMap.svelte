<script lang="ts">
  import { pathwayIndex, pathwayInput, pathwayOutput } from '../sim/associations';
  import { INPUT_LABELS, OUTPUT_COUNT, OUTPUT_LABELS, RAY_COUNT } from '../sim/brain';
  import { speciesHue } from '../render/renderer';
  import type { LabData, ProfileGroup } from '../worker/protocol';
  import {
    ACTION_SHORT,
    actionWord,
    DRIVES,
    groupName,
    habitLabel,
    HOLDS_BACK,
    percent,
    SENSE_ROWS,
    times,
  } from './habits';
  import { SENSE_GROUP_HINTS, SENSE_GROUPS } from './senseGroups';
  import Sparkline from './Sparkline.svelte';

  /** A row is shown when some cell in it reaches this share, unless every row is asked for. */
  const ROW_SHARE = 0.05;
  const MORE_IN_FIRST = '#7fd6c2';
  const MORE_IN_SECOND = '#c478ff';

  let {
    groups,
    lab,
    selected = $bindable(null),
  }: {
    groups: ProfileGroup[];
    lab: LabData | null;
    /** The sense-action pair picked, as a pathway index. */
    selected?: number | null;
  } = $props();

  let groupId = $state('all');
  /** A second group to compare against, or '' for none. */
  let compareId = $state('');
  let showAll = $state(false);

  const live = $derived(groups.filter((g) => g.profile.count > 0));
  const group = $derived(live.find((g) => g.id === groupId) ?? live[0]);
  const other = $derived(compareId ? live.find((g) => g.id === compareId && g.id !== group?.id) : undefined);

  /** Rows worth showing, most used first within each kind of sense. */
  const rows = $derived.by(() => {
    if (!group) return [];
    const peak = (inputs: number[]) => {
      let most = 0;
      for (const input of inputs) {
        for (let output = 0; output < OUTPUT_COUNT; output++) {
          const p = pathwayIndex(input, output);
          most = Math.max(most, group.pathways.share[p]!, other?.pathways.share[p] ?? 0);
        }
      }
      return most;
    };
    return SENSE_GROUPS.map((kind) => ({
      kind,
      rows: SENSE_ROWS.filter((row) => row.group === kind)
        .map((row) => ({ ...row, peak: peak(row.inputs) }))
        .filter((row) => showAll || row.peak >= ROW_SHARE)
        .sort((a, b) => b.peak - a.peak),
    })).filter((section) => section.rows.length > 0);
  });

  /** Fill of one cell: blue or orange by the habit's sign, or by which group has it more when comparing. */
  function fill(p: number): string {
    if (!group) return 'transparent';
    const share = group.pathways.share[p]!;
    if (other) {
      const gap = share - other.pathways.share[p]!;
      if (Math.abs(gap) < 0.02) return 'transparent';
      return `color-mix(in srgb, ${gap > 0 ? MORE_IN_FIRST : MORE_IN_SECOND} ${Math.round(25 + 75 * Math.sqrt(Math.abs(gap)))}%, transparent)`;
    }
    if (share < 0.01) return 'transparent';
    const color = group.pathways.effect[p]! >= 0 ? DRIVES : HOLDS_BACK;
    return `color-mix(in srgb, ${color} ${Math.round(22 + 78 * Math.sqrt(share))}%, transparent)`;
  }

  function cellTitle(p: number): string {
    if (!group) return '';
    const share = group.pathways.share[p]!;
    const text = `${habitLabel(p)}: ${percent(share)} of ${groupName(group)}`;
    return other ? `${text}, ${percent(other.pathways.share[p]!)} of ${groupName(other)}` : text;
  }

  // Start on the most common habit, so the details are never empty.
  $effect(() => {
    if (selected !== null || !group) return;
    let best = -1;
    for (let p = 0; p < group.pathways.share.length; p++) {
      if (best < 0 || group.pathways.share[p]! > group.pathways.share[best]!) best = p;
    }
    if (best >= 0 && group.pathways.share[best]! > 0) selected = best;
  });

  const detail = $derived.by(() => {
    if (selected === null || !group) return null;
    const p = selected;
    const input = pathwayInput(p);
    const output = pathwayOutput(p);
    const share = group.pathways.share[p]!;
    const effect = group.pathways.effect[p]!;
    const over = lab?.adoption.shares.map((s) => s[p]!) ?? [];
    const breeding = lab?.breeding.habits.find((h) => h.pathway === p);
    return {
      p,
      sense: INPUT_LABELS[input]!,
      action: OUTPUT_LABELS[output]!,
      share,
      effect,
      word: actionWord(output, effect),
      direct: group.pathways.direct[p]!,
      learns: group.pathways.learns[p]!,
      learned: group.pathways.learned[p]!,
      over,
      first: over[0],
      breeding,
      byGroup: live.map((g) => ({ group: g, share: g.pathways.share[p]! })),
    };
  });
</script>

<div class="habit-map">
  <div class="controls">
    <div class="chips" role="radiogroup" aria-label="Group">
      {#each live as g (g.id)}
        <button
          class="chip"
          class:on={g.id === group?.id}
          role="radio"
          aria-checked={g.id === group?.id}
          onclick={() => {
            groupId = g.id;
            if (compareId === g.id) compareId = '';
          }}
        >
          {#if g.speciesId > 0}
            <span class="swatch" style="background: hsl({speciesHue(g.speciesId) * 360}, 70%, 60%)"></span>
          {/if}
          {groupName(g)} <small>{g.profile.count.toLocaleString()}</small>
        </button>
      {/each}
    </div>
    <label class="compare">
      Compare with
      <select bind:value={compareId}>
        <option value="">nobody</option>
        {#each live.filter((g) => g.id !== group?.id) as g (g.id)}
          <option value={g.id}>{groupName(g)}</option>
        {/each}
      </select>
    </label>
    <label class="all"><input type="checkbox" bind:checked={showAll} /> Show rarely used senses</label>
  </div>

  <div class="body">
    <div class="matrix" role="grid" aria-label="Senses and the actions they lead to">
      <div class="head" role="row">
        <span class="corner">Sense ↓ · Action →</span>
        {#each ACTION_SHORT as action, k (k)}
          <span class="action" title={OUTPUT_LABELS[k]}>{action}</span>
        {/each}
      </div>
      {#each rows as section (section.kind)}
        <div class="kind" title={SENSE_GROUP_HINTS[section.kind]}>{section.kind}</div>
        {#each section.rows as row (row.label)}
          <div class="row" role="row">
            <span class="sense" title={row.inputs.length === RAY_COUNT ? 'Seen along the left, ahead and right rays' : ''}>
              <span class="sense-name">{row.label}</span>{#if row.inputs.length === RAY_COUNT}<small>L A R</small>{/if}
            </span>
            {#each ACTION_SHORT as _, output (output)}
              <span class="cell" role="gridcell">
                {#each row.inputs as input (input)}
                  {@const p = pathwayIndex(input, output)}
                  <button
                    class="part"
                    class:picked={selected === p}
                    style="background: {fill(p)}"
                    title={cellTitle(p)}
                    aria-label={cellTitle(p)}
                    onclick={() => (selected = p)}
                  ></button>
                {/each}
              </span>
            {/each}
          </div>
        {/each}
      {:else}
        <p class="empty">No habit is shared by {percent(ROW_SHARE)} of this group yet.</p>
      {/each}
      <p class="legend">
        {#if other}
          <span class="key" style="background: {MORE_IN_FIRST}"></span> more common in {group ? groupName(group) : ''}
          <span class="key" style="background: {MORE_IN_SECOND}"></span> more common in {groupName(other)}.
          The stronger the colour, the bigger the gap.
        {:else}
          <span class="key" style="background: {DRIVES}"></span> more of the sense, more of the action
          <span class="key" style="background: {HOLDS_BACK}"></span> more of the sense, less of the action.
          The stronger the colour, the more of the group has the habit. Ray senses have three slots: left, ahead, right.
        {/if}
      </p>
    </div>

    <aside class="detail">
      {#if detail && group}
        <h2>{detail.sense} → {detail.action}</h2>
        {#if detail.share > 0}
          <p class="headline">
            <b>{percent(detail.share)}</b> of {groupName(group).toLowerCase()} are wired so that the stronger
            <i>{detail.sense}</i> reads, the more they <b style="color: {detail.effect >= 0 ? DRIVES : HOLDS_BACK}">{detail.word}</b>
            <span class="muted">(average strength {detail.effect >= 0 ? '+' : ''}{detail.effect.toFixed(2)})</span>.
          </p>
        {:else}
          <p class="headline">No one in {groupName(group).toLowerCase()} has this habit right now.</p>
        {/if}

        <h3>Who has it</h3>
        <ul class="bars">
          {#each detail.byGroup as row (row.group.id)}
            <li>
              <span class="name">
                {#if row.group.speciesId > 0}
                  <span class="swatch" style="background: hsl({speciesHue(row.group.speciesId) * 360}, 70%, 60%)"></span>
                {/if}
                {groupName(row.group)}
              </span>
              <span class="track"><span class="fill" style="width: {row.share * 100}%"></span></span>
              <span class="value">{percent(row.share)}</span>
            </li>
          {/each}
        </ul>

        {#if detail.over.length > 1}
          <h3>Over the run (everyone)</h3>
          <div class="trend">
            <span class="spark"><Sparkline values={detail.over} width={180} height={34} zero color="#7fd6c2" /></span>
            <span>{percent(detail.first ?? 0)} → {percent(detail.over[detail.over.length - 1]!)}</span>
          </div>
        {/if}

        {#if detail.share > 0}
          <h3>How it is wired</h3>
          <p>
            {#if detail.direct >= 0.995}
              A single link from the sense straight to the action.
            {:else if detail.direct <= 0.005}
              Always through hidden neurons, where it can mix with other senses.
            {:else}
              A direct link in {percent(detail.direct)} of them; the rest go through hidden neurons.
            {/if}
          </p>
          <p>
            {#if detail.learns <= 0.005}
              None of them can learn it: the strength is fixed at birth.
            {:else}
              In {percent(detail.learns)} of them it runs through a link that learns during life;
              {#if Math.abs(detail.learned) < 0.05}
                so far learning has barely changed it.
              {:else}
                learning has moved it by {detail.learned > 0 ? '+' : ''}{detail.learned.toFixed(2)} on average
                ({(detail.learned > 0) === (detail.effect >= 0) ? 'strengthened' : 'weakened'}).
              {/if}
            {/if}
          </p>
        {/if}

        {#if detail.breeding}
          {@const b = detail.breeding}
          <h3>Having young</h3>
          <p>
            Adults with it have <b>{b.withRate.toFixed(2)}</b> young per 1,000 ticks lived, against
            <b>{b.withoutRate.toFixed(2)}</b> for those without, comparing within each species
            ({times(b.withoutRate > 0 ? b.withRate / b.withoutRate : Infinity)}).
            <span class="muted">
              {Math.abs(b.z) >= 2 ? 'A clear difference' : 'Could be chance'}
              ({b.withCount.toLocaleString()} with, {b.withoutCount.toLocaleString()} without).
            </span>
          </p>
        {/if}
      {:else}
        <p class="muted">Pick a square to see a habit in detail.</p>
      {/if}
    </aside>
  </div>
</div>

<style>
  .controls {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 16px;
    margin-bottom: 10px;
    font-size: 12px;
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }

  .chip {
    margin: 0;
    padding: 3px 8px;
    font-size: 12px;
    border-radius: 12px;
    color: var(--muted);
    background: transparent;
    border: 1px solid var(--border);
  }

  .chip.on {
    color: var(--text);
    border-color: var(--accent, #6cb6ff);
    background: color-mix(in srgb, var(--accent, #6cb6ff) 18%, transparent);
  }

  .chip small {
    color: var(--muted);
  }

  .compare,
  .all {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  .compare select {
    font: inherit;
    color: var(--text);
    background: #1b2530;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 2px 4px;
  }

  .all input {
    width: auto;
    padding: 0;
  }

  .body {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(260px, 340px);
    gap: 16px;
    align-items: start;
  }

  .matrix {
    min-width: 0;
    overflow-x: auto;
    font-size: 12px;
  }

  .head,
  .row {
    display: grid;
    grid-template-columns: 175px repeat(12, minmax(30px, 1fr));
    gap: 2px;
    align-items: center;
  }

  .head {
    position: sticky;
    top: 0;
    background: var(--panel);
    padding-bottom: 4px;
    color: var(--muted);
  }

  .corner {
    font-size: 11px;
  }

  .action {
    text-align: center;
    font-size: 11px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .kind {
    margin: 8px 0 2px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .sense {
    display: flex;
    justify-content: space-between;
    gap: 4px;
    min-width: 0;
    padding-right: 6px;
  }

  .sense-name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sense small {
    flex: none;
    color: var(--muted);
    font-size: 9px;
    letter-spacing: 0.15em;
  }

  .cell {
    display: flex;
    gap: 1px;
    height: 18px;
    border-radius: 3px;
    background: rgba(255, 255, 255, 0.035);
    overflow: hidden;
  }

  .part {
    flex: 1;
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    border-radius: 0;
    cursor: pointer;
  }

  .part:hover {
    outline: 1px solid var(--muted);
    outline-offset: -1px;
  }

  .part.picked {
    outline: 2px solid var(--text);
    outline-offset: -2px;
  }

  .legend {
    margin-top: 10px;
  }

  .key {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin: 0 4px 0 8px;
    border-radius: 2px;
    vertical-align: -1px;
  }

  .key:first-child {
    margin-left: 0;
  }

  .detail {
    padding: 10px 12px;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.02);
    font-size: 12px;
  }

  .detail h2 {
    margin: 0 0 6px;
    font-size: 14px;
  }

  .detail h3 {
    margin: 12px 0 4px;
    font-size: 11px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .detail p {
    margin: 0 0 6px;
    line-height: 1.5;
    color: var(--text);
  }

  .headline {
    font-size: 13px;
  }

  .muted {
    color: var(--muted);
  }

  .bars {
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .bars li {
    display: grid;
    grid-template-columns: 110px 1fr 36px;
    gap: 6px;
    align-items: center;
    margin: 2px 0;
  }

  .name {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .track {
    height: 8px;
    border-radius: 2px;
    background: rgba(255, 255, 255, 0.06);
    overflow: hidden;
  }

  .fill {
    display: block;
    height: 100%;
    background: #7fd6c2;
  }

  .value {
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  .spark {
    display: block;
    width: 180px;
    height: 34px;
  }

  .trend {
    display: flex;
    align-items: center;
    gap: 10px;
    font-variant-numeric: tabular-nums;
  }

  .swatch {
    display: inline-block;
    width: 9px;
    height: 9px;
    margin-right: 3px;
    border-radius: 50%;
  }

  .empty {
    margin: 10px 0;
    color: var(--muted);
  }

  @media (max-width: 1100px) {
    .body {
      grid-template-columns: minmax(0, 1fr);
    }
  }
</style>
