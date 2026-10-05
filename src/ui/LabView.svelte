<script lang="ts">
  import type uPlot from 'uplot';
  import { speciesHue } from '../render/renderer';
  import { BIOME_GROUND } from '../render/renderer';
  import { BIOME_LABELS } from '../sim/biomes';
  import { INPUT_COUNT, INPUT_LABELS, OUTPUT_LABELS } from '../sim/brain';
  import { HIDDEN_NODE } from '../sim/profile';
  import type { HistoryData, LabData, ProfileGroup } from '../worker/protocol';
  import BrainCompare from './BrainCompare.svelte';
  import Chart, { type ChartSeries } from './Chart.svelte';

  /** Rows in the ranked list of a group's most common links. */
  const LINKS_SHOWN = 15;
  /** Samples averaged for the parents' line in the selection charts. */
  const SMOOTH_SAMPLES = 20;
  const EVERYONE = '#dfe6ec';
  const PARENTS = '#e8c468';

  let {
    history,
    profiles,
    lab,
    onClose,
  }: {
    history: HistoryData | null;
    profiles: ProfileGroup[];
    lab: LabData | null;
    onClose: () => void;
  } = $props();

  let rankedId = $state('plants');
  const ranked = $derived(profiles.find((g) => g.id === rankedId) ?? profiles[0]);

  function groupName(group: ProfileGroup): string {
    return group.id === 'plants' ? 'Plant-eaters' : group.id === 'meat' ? 'Meat-eaters' : `Species ${group.speciesId}`;
  }

  function nodeLabel(node: number): string {
    if (node >= HIDDEN_NODE) return 'Hidden';
    return node < INPUT_COUNT ? INPUT_LABELS[node]! : OUTPUT_LABELS[node - INPUT_COUNT]!;
  }

  const percent = (share: number) => `${Math.round(share * 100)}%`;

  /** Groups with members, for the senses table. */
  const senseGroups = $derived(profiles.filter((g) => g.profile.count > 0));
  /** Senses at least one group uses, so the table skips rows that are blank everywhere. */
  const senseRows = $derived(
    INPUT_LABELS.map((label, input) => ({ label, input })).filter(({ input }) =>
      senseGroups.some((g) => (g.profile.inputUse[input] ?? 0) >= 0.05),
    ),
  );

  const SELECTION: { title: string; all: keyof HistoryData; parents: keyof HistoryData }[] = [
    { title: 'Size', all: 'meanSize', parents: 'parentSize' },
    { title: 'Speed', all: 'meanSpeed', parents: 'parentSpeed' },
    { title: 'Sensor range', all: 'meanSensorRange', parents: 'parentSensorRange' },
    { title: 'Diet (0 plants, 1 meat)', all: 'meanDiet', parents: 'parentDiet' },
  ];
  const SELECTION_SERIES: ChartSeries[] = [
    { label: 'Those that had young', color: PARENTS },
    { label: 'Everyone alive', color: EVERYONE },
  ];
  const DIVERSITY_SERIES: ChartSeries[] = [{ label: 'Gene spread', color: '#7fd6c2' }];

  /** A running average, so a line built from a few births per sample can be read. */
  function smooth(values: Float32Array | Float64Array): Float32Array {
    const out = new Float32Array(values.length);
    let total = 0;
    for (let k = 0; k < values.length; k++) {
      total += values[k]!;
      if (k >= SMOOTH_SAMPLES) total -= values[k - SMOOTH_SAMPLES]!;
      out[k] = total / Math.min(k + 1, SMOOTH_SAMPLES);
    }
    return out;
  }

  const selectionData = $derived(
    SELECTION.map((trait) =>
      history
        ? ([history.tick, smooth(history[trait.parents]), history[trait.all]] as uPlot.AlignedData)
        : null,
    ),
  );
  const diversityData = $derived<uPlot.AlignedData | null>(history && [history.tick, history.diversity]);
</script>

<div class="lab">
  <header>
    <strong>Lab</strong>
    <span class="where">
      Tick <b>{lab ? lab.tick.toLocaleString() : '-'}</b> · <b>{lab ? lab.population.toLocaleString() : '-'}</b> creatures
    </span>
    <button onclick={onClose}>Back to the world</button>
  </header>

  <div class="grid">
    <section class="card wide">
      <h1>Selection at work</h1>
      <p class="teaches">
        Natural selection, measured. The yellow line is the average gene of the creatures that had young; the grey
        line is everyone alive. Where yellow sits above grey, that trait is being pushed up, and the gap is how hard. The yellow line is a running average, because only a few creatures breed at any moment.
      </p>
      <div class="charts">
        {#each SELECTION as trait, k (trait.title)}
          <Chart title={trait.title} series={SELECTION_SERIES} data={selectionData[k] ?? null} />
        {/each}
      </div>
    </section>

    <section class="card">
      <h1>Diversity over time</h1>
      <p class="teaches">
        How varied the population's body genes are. It drops when a disaster leaves few survivors or one family
        takes over, and climbs back as mutations build up again.
      </p>
      <Chart title="Gene spread" note="The average spread (standard deviation) of size, speed, sensor range and diet." series={DIVERSITY_SERIES} data={diversityData} />
    </section>

    <section class="card">
      <h1>Most successful founders</h1>
      <p class="teaches">
        How a few lineages come to dominate. Each row is one of the world's parentless starting creatures and how
        many of today's creatures descend from it.
      </p>
      {#if lab && lab.founders.length > 0}
        <p class="summary">
          {lab.foundersLiving.toLocaleString()} of {lab.foundersEver.toLocaleString()} founders still have living descendants.
        </p>
        <table class="founders">
          <thead>
            <tr><th>Founder</th><th>Descendants</th><th>Share</th><th></th><th>Diet</th></tr>
          </thead>
          <tbody>
            {#each lab.founders as founder (founder.id)}
              {@const share = lab.population > 0 ? founder.count / lab.population : 0}
              <tr>
                <td>
                  <span class="swatch" style="background: hsl({founder.hue * 360}, 70%, 60%)"></span>
                  #{founder.id}
                </td>
                <td>{founder.count.toLocaleString()}</td>
                <td>{percent(share)}</td>
                <td class="bar"><span style="width: {share * 100}%"></span></td>
                <td>{founder.meanDiet > 0.5 ? 'Meat' : 'Plants'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}
        <p class="empty">No creatures yet.</p>
      {/if}
    </section>

    <section class="card wide">
      <h1>Traits by biome</h1>
      <p class="teaches">
        Adaptation, directly. Each row is the creatures standing in one biome right now. If evolution is fitting
        bodies to places, tundra dwellers should be bigger and furrier than desert dwellers.
      </p>
      {#if lab && lab.population > 0}
        <table class="biomes">
          <thead>
            <tr>
              <th>Biome</th><th>Land</th><th>Creatures</th><th>Share</th><th></th>
              <th>Size</th><th>Fur</th><th>Defenses</th><th>Speed</th><th>Diet</th>
            </tr>
          </thead>
          <tbody>
            {#each lab.biomes as biome, k (k)}
              {@const share = biome.count / lab.population}
              <tr class:none={biome.count === 0}>
                <td>
                  <span class="swatch square" style="background: rgb({BIOME_GROUND[k]!.plant.join(',')})"></span>
                  {BIOME_LABELS[k]}
                </td>
                <td>{percent(biome.land)}</td>
                <td>{biome.count.toLocaleString()}</td>
                <td>{percent(share)}</td>
                <td class="bar"><span style="width: {share * 100}%"></span></td>
                <td>{biome.count > 0 ? biome.meanSize.toFixed(2) : '-'}</td>
                <td>{biome.count > 0 ? biome.meanFur.toFixed(2) : '-'}</td>
                <td>{biome.count > 0 ? biome.meanDefense.toFixed(2) : '-'}</td>
                <td>{biome.count > 0 ? biome.meanSpeed.toFixed(2) : '-'}</td>
                <td>{biome.count > 0 ? biome.meanDiet.toFixed(2) : '-'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="caption">
          Land is each biome's share of the dry land; share is its part of the population. A biome holding far
          less than its share of land is hard to live in. Diet runs from 0 (plants only) to 1 (meat only).
        </p>
      {:else}
        <p class="empty">No creatures yet.</p>
      {/if}
    </section>

    <section class="card wide">
      <h1>Senses in use</h1>
      <p class="teaches">
        Which senses each group's brains are actually wired to. A sense no link leads out of is ignored, however
        useful it looks. Compare the meat-eaters' column with the plant-eaters' to see what hunting needs.
      </p>
      {#if senseGroups.length > 0}
        <div class="scroll">
          <table class="senses">
            <thead>
              <tr>
                <th>Sense</th>
                {#each senseGroups as group (group.id)}
                  <th>
                    {#if group.speciesId > 0}
                      <span class="swatch" style="background: hsl({speciesHue(group.speciesId) * 360}, 70%, 60%)"></span>
                    {/if}
                    {groupName(group)}
                    <small>{group.profile.count.toLocaleString()}</small>
                  </th>
                {/each}
              </tr>
            </thead>
            <tbody>
              {#each senseRows as row (row.input)}
                <tr>
                  <td>{row.label}</td>
                  {#each senseGroups as group (group.id)}
                    {@const use = group.profile.inputUse[row.input] ?? 0}
                    <td style="background: rgba(108, 182, 255, {use * 0.75})">{use >= 0.005 ? percent(use) : ''}</td>
                  {/each}
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        <p class="caption">
          Share of each group's members with at least one link leading out of the sense. Senses under 5% in every
          group are left out.
        </p>
      {:else}
        <p class="empty">No creatures yet.</p>
      {/if}
    </section>

    <section class="card">
      <BrainCompare groups={profiles} />
    </section>

    <section class="card">
      <h1>Most common links</h1>
      <p class="teaches">
        The wiring a group has settled on. A link most members share is one evolution has kept; rare links are
        recent experiments.
      </p>
      <select bind:value={rankedId} aria-label="Group">
        {#each profiles as group (group.id)}
          <option value={group.id}>{groupName(group)} ({group.profile.count.toLocaleString()})</option>
        {/each}
      </select>
      {#if ranked && ranked.profile.count > 0 && ranked.profile.links.length > 0}
        <table class="links">
          <thead>
            <tr><th>#</th><th>Link</th><th>Members</th><th>Effect</th></tr>
          </thead>
          <tbody>
            {#each ranked.profile.links.slice(0, LINKS_SHOWN) as link, k (`${link.from}>${link.to}`)}
              <tr>
                <td>{k + 1}</td>
                <td>{nodeLabel(link.from)} → {nodeLabel(link.to)}</td>
                <td>{percent(link.share)}</td>
                <td class:excites={link.weight > 0} class:damps={link.weight < 0}>
                  {link.weight > 0 ? 'Drives' : 'Holds back'} ({link.weight.toFixed(1)})
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
        <p class="caption">
          "Drives" means more of the sense gives more of the action; "holds back" means less. The number is the
          link's average strength.
        </p>
      {:else}
        <p class="empty">No creatures in this group right now.</p>
      {/if}
    </section>
  </div>
</div>

<style>
  .lab {
    position: fixed;
    inset: 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    background: var(--bg, #0f161d);
    color: var(--text);
  }

  header {
    display: flex;
    align-items: center;
    gap: 20px;
    padding: 8px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .where {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .where b {
    color: var(--text);
  }

  header button {
    margin-left: auto;
  }

  .grid {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    align-content: start;
    gap: 14px;
    padding: 14px;
  }

  .card {
    min-width: 0;
    padding: 14px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .wide {
    grid-column: 1 / -1;
  }

  h1 {
    margin: 0 0 4px;
    font-size: 14px;
    font-weight: 600;
  }

  p {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--muted);
  }

  .teaches {
    max-width: 72ch;
  }

  .summary {
    color: var(--text);
  }

  .charts {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 14px;
  }

  .scroll {
    max-height: 420px;
    overflow: auto;
    border: 1px solid var(--border);
    border-radius: 4px;
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
    padding: 4px 8px;
    white-space: nowrap;
  }

  .senses th {
    position: sticky;
    top: 0;
    background: var(--panel);
  }

  th small {
    display: block;
    font-weight: 400;
  }

  td {
    text-align: right;
    padding: 3px 8px;
    border-top: 1px solid var(--border);
  }

  th:first-child,
  td:first-child {
    text-align: left;
  }

  .links th:nth-child(2),
  .links td:nth-child(2) {
    text-align: left;
  }

  .links td:first-child {
    color: var(--muted);
  }

  .excites {
    color: #6cb6ff;
  }

  .damps {
    color: #ff8f6b;
  }

  .swatch {
    display: inline-block;
    width: 10px;
    height: 10px;
    margin-right: 4px;
    border-radius: 50%;
  }

  .bar {
    width: 40%;
  }

  .biomes .bar {
    width: 22%;
  }

  .none td {
    color: var(--muted);
  }

  .square {
    border-radius: 2px;
  }

  .bar span {
    display: block;
    height: 8px;
    min-width: 1px;
    background: #e8c468;
    border-radius: 2px;
  }

  select {
    width: 100%;
    margin-bottom: 8px;
    font: inherit;
    color: var(--text);
    background: #1b2530;
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 4px 6px;
  }

  .caption,
  .empty {
    margin: 8px 0 0;
  }

  @media (max-width: 1000px) {
    .grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .charts {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }
</style>
