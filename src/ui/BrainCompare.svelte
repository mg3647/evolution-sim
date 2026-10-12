<script lang="ts">
  import { speciesColor } from './speciesColors';
  import { INPUT_COUNT, INPUT_LABELS, OUTPUT_COUNT, OUTPUT_LABELS } from '../sim/brain';
  import { HIDDEN_NODE, type BrainProfile } from '../sim/profile';
  import type { BrainView, ProfileGroup } from '../worker/protocol';
  import BrainGraph from './BrainGraph.svelte';
  import { groupName } from './habits';

  /** A link is part of a group's typical brain if at least this share of members have it. */
  const TYPICAL_SHARE = 0.5;
  /** Rows shown in the table of differences. */
  const DIFFERENCES_SHOWN = 10;

  let { groups }: { groups: ProfileGroup[] } = $props();

  let firstId = $state('plants');
  let secondId = $state('meat');

  const first = $derived(groups.find((g) => g.id === firstId) ?? groups[0]);
  const second = $derived(groups.find((g) => g.id === secondId) ?? groups[1] ?? groups[0]);

  function groupLabel(group: ProfileGroup): string {
    return `${groupName(group)} (${group.profile.count.toLocaleString()})`;
  }

  function nodeLabel(node: number): string {
    if (node >= HIDDEN_NODE) return 'Hidden';
    return node < INPUT_COUNT ? INPUT_LABELS[node]! : OUTPUT_LABELS[node - INPUT_COUNT]!;
  }

  /** The links most of a group share, as a brain the diagram can draw. */
  function typicalBrain(profile: BrainProfile): { view: BrainView; strength: number[] } {
    const links = profile.links.filter((link) => link.share >= TYPICAL_SHARE);
    const usesHidden = links.some((link) => link.from === HIDDEN_NODE || link.to === HIDDEN_NODE);
    return {
      view: {
        hiddenCount: usesHidden ? 1 : 0,
        activation: new Array(INPUT_COUNT + OUTPUT_COUNT + 1).fill(0),
        linkFrom: links.map((link) => link.from),
        linkTo: links.map((link) => link.to),
        linkWeight: links.map((link) => link.weight),
      },
      // The more members share a link, the more solid it is drawn.
      strength: links.map((link) => link.share),
    };
  }

  /** Links ranked by how differently common they are in the two groups. */
  const differences = $derived.by(() => {
    if (!first || !second) return [];
    const rows = new Map<string, { label: string; a: number; b: number }>();
    const add = (profile: BrainProfile, side: 'a' | 'b') => {
      for (const link of profile.links) {
        const key = `${link.from}>${link.to}`;
        let row = rows.get(key);
        if (!row) {
          row = { label: `${nodeLabel(link.from)} → ${nodeLabel(link.to)}`, a: 0, b: 0 };
          rows.set(key, row);
        }
        row[side] = link.share;
      }
    };
    add(first.profile, 'a');
    add(second.profile, 'b');
    return [...rows.values()]
      .filter((row) => Math.abs(row.a - row.b) >= 0.1)
      .sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b))
      .slice(0, DIFFERENCES_SHOWN);
  });

  const percent = (share: number) => `${Math.round(share * 100)}%`;
</script>

<section>
  <h2>Compare brains</h2>
  <p>
    Pick two groups to see how their brains differ. Each diagram is the group's typical brain: the links
    at least half its members have. A fainter link is one fewer members share.
  </p>

  {#each [{ group: first, pick: (id: string) => (firstId = id), id: firstId }, { group: second, pick: (id: string) => (secondId = id), id: secondId }] as side, k (k)}
    <div class="side">
      <select value={side.group?.id ?? side.id} onchange={(event) => side.pick(event.currentTarget.value)} aria-label="Group {k + 1}">
        {#each groups as group (group.id)}
          <option value={group.id}>{groupLabel(group)}</option>
        {/each}
      </select>
      {#if side.group && side.group.speciesId > 0}
        <span class="swatch" style="background: {speciesColor(side.group.speciesId)}"></span>
      {/if}
    </div>
    {#if side.group && side.group.profile.count > 0}
      {@const typical = typicalBrain(side.group.profile)}
      <BrainGraph
        brain={typical.view}
        strength={typical.strength}
        note="On average {side.group.profile.meanLinks.toFixed(1)} links and {side.group.profile.meanHidden.toFixed(1)} hidden neurons each; {Math.round(side.group.profile.recurrentShare * 100)}% have a loop that can keep a state. {typical.view.linkWeight.length === 0 ? 'No link is shared by half the group: its members are wired in many different ways.' : ''}"
      />
    {:else}
      <p class="empty">No creatures in this group right now.</p>
    {/if}
  {/each}

  {#if first && second && first.profile.count > 0 && second.profile.count > 0}
    <h3>Biggest differences</h3>
    {#if differences.length > 0}
      <table>
        <thead>
          <tr><th>Link</th><th>First</th><th>Second</th></tr>
        </thead>
        <tbody>
          {#each differences as row (row.label)}
            <tr>
              <td>{row.label}</td>
              <td class:more={row.a > row.b}>{percent(row.a)}</td>
              <td class:more={row.b > row.a}>{percent(row.b)}</td>
            </tr>
          {/each}
        </tbody>
      </table>
      <p class="caption">Share of each group's members that have the link.</p>
    {:else}
      <p class="empty">These two groups are wired almost the same.</p>
    {/if}
  {/if}
</section>

<style>
  h2,
  h3 {
    margin: 0 0 4px;
    font-size: 12px;
    font-weight: 600;
    color: var(--muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  h3 {
    margin-top: 12px;
    text-transform: none;
    letter-spacing: 0;
  }

  p {
    margin: 0 0 6px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }

  .side {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 6px;
  }

  select {
    flex: 1;
    font: inherit;
    color: var(--text);
    background: #1b2530;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  th {
    font-weight: 600;
    color: var(--muted);
    text-align: right;
    padding: 2px 4px;
  }

  td {
    text-align: right;
    padding: 2px 4px;
    border-top: 1px solid var(--border);
    color: var(--muted);
  }

  th:first-child,
  td:first-child {
    text-align: left;
    padding-left: 0;
    color: var(--text);
  }

  td.more {
    color: var(--accent);
    font-weight: 600;
  }

  .caption,
  .empty {
    margin-top: 6px;
  }
</style>
