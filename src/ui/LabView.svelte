<script lang="ts">
  import type uPlot from 'uplot';
  import { speciesHue } from '../render/renderer';
  import { speciesColor, streamSeries as seriesOfStream } from './speciesColors';
  import { BIOME_GROUND } from '../render/renderer';
  import { BIOME_LABELS } from '../sim/biomes';
  import { INPUT_COUNT, INPUT_LABELS, OUTPUT_LABELS } from '../sim/brain';
  import { HIDDEN_NODE } from '../sim/profile';
  import type { HistoryData, LabData, ProfileGroup } from '../worker/protocol';
  import BrainCompare from './BrainCompare.svelte';
  import Chart, { type ChartEvent, type ChartSeries } from './Chart.svelte';
  import DensityMap from './DensityMap.svelte';
  import DietHistogram from './DietHistogram.svelte';

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
    events,
    focus = null,
    onClose,
  }: {
    history: HistoryData | null;
    profiles: ProfileGroup[];
    lab: LabData | null;
    /** Events to mark on every chart. */
    events: ChartEvent[];
    /** The title of a selection chart to bring into view when the Lab opens, if any. */
    focus?: string | null;
    onClose: () => void;
  } = $props();

  let selectionCard = $state<HTMLElement>();
  $effect(() => {
    if (focus && selectionCard) selectionCard.scrollIntoView({ block: 'start' });
  });

  const DEATH_SERIES: ChartSeries[] = [
    { label: 'Starvation', color: '#e8c468' },
    { label: 'Old age', color: '#8a9aa9' },
    { label: 'Predation', color: '#e0566a' },
    { label: 'Heat or cold', color: '#6cb6ff' },
    { label: 'Thirst', color: '#7fd6c2' },
    { label: 'Other', color: '#b08cff' },
  ];
  const deathData = $derived<uPlot.AlignedData | null>(
    history && [
      history.tick,
      history.deathsStarved,
      history.deathsOldAge,
      history.deathsKilled,
      history.deathsTemperature,
      history.deathsThirst,
      history.deathsOther,
    ],
  );

  /** The species drawn in the stream chart. The chart is rebuilt when the set changes. */
  const streamKey = $derived(history ? history.species.map((s) => s.id).join(',') : '');
  const streamSeries = $derived<ChartSeries[]>(seriesOfStream(history));
  const streamData = $derived<uPlot.AlignedData | null>(
    history && history.species.length > 0 ? [history.tick, ...history.species.map((s) => s.counts)] : null,
  );

  const BEHAVIOUR_SERIES: ChartSeries[] = [
    { label: 'Foraging %', color: '#4caf50' },
    { label: 'Resting %', color: '#8a9aa9' },
    { label: 'Chasing %', color: '#e0566a' },
    { label: 'Fleeing %', color: '#6cb6ff' },
  ];
  const asPercent = (values: Float32Array) => smooth(values).map((share) => share * 100);
  const behaviourData = $derived<uPlot.AlignedData | null>(
    history && [
      history.tick,
      asPercent(history.shareForaging),
      asPercent(history.shareResting),
      asPercent(history.shareChasing),
      asPercent(history.shareFleeing),
    ],
  );

  const LIFE_AGE_SERIES: ChartSeries[] = [
    { label: 'Lifespan', color: '#e8c468' },
    { label: 'Age at first birth', color: '#7fd6c2' },
    { label: 'Generation length', color: '#b08cff' },
  ];
  const OFFSPRING_SERIES: ChartSeries[] = [{ label: 'Children per creature', color: '#ff8f6b' }];
  const lifeAgeData = $derived<uPlot.AlignedData | null>(
    history && [
      history.tick,
      smooth(history.lifespan),
      smooth(history.firstBirthAge),
      smooth(history.generationLength),
    ],
  );
  const offspringData = $derived<uPlot.AlignedData | null>(history && [history.tick, smooth(history.offspring)]);

  const FLOW_SERIES: ChartSeries[] = [
    { label: 'Plants to plant-eaters', color: '#4caf50' },
    { label: 'Plants to meat-eaters', color: '#b7c94a' },
    { label: 'Meat to plant-eaters', color: '#e8a468' },
    { label: 'Meat to meat-eaters', color: '#e0566a' },
  ];
  const flowData = $derived<uPlot.AlignedData | null>(
    history && [
      history.tick,
      smooth(history.flowPlantsToPlantEaters),
      smooth(history.flowPlantsToMeatEaters),
      smooth(history.flowMeatToPlantEaters),
      smooth(history.flowMeatToMeatEaters),
    ],
  );
  /** Where the energy eaten lately went, as shares of all of it, for the flow diagram. */
  const flowNow = $derived.by(() => {
    if (!history || history.tick.length === 0) return null;
    const last = (values: Float32Array) => {
      let total = 0;
      const from = Math.max(0, values.length - SMOOTH_SAMPLES);
      for (let k = from; k < values.length; k++) total += values[k]!;
      return total / Math.max(1, values.length - from);
    };
    const parts = [
      last(history.flowPlantsToPlantEaters),
      last(history.flowPlantsToMeatEaters),
      last(history.flowMeatToPlantEaters),
      last(history.flowMeatToMeatEaters),
    ];
    const total = parts.reduce((a, b) => a + b, 0);
    return total > 0 ? { parts, total } : null;
  });

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

  type Trait = 'Size' | 'Speed' | 'SensorRange' | 'Diet';
  const SELECTION: { title: string; all: `mean${Trait}`; parents: `parent${Trait}` }[] = [
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
  /** Blocks moved, by the species that moved them. The chart is rebuilt when the set of species changes. */
  const blockKey = $derived(history ? history.blockMoves.map((s) => s.id).join(',') : '');
  const blockSeries = $derived<ChartSeries[]>(
    (history?.blockMoves ?? []).map((s) => ({
      label: s.id === 0 ? 'Other species' : `Species ${s.id}`,
      color: speciesColor(s.id),
    })),
  );
  const blockData = $derived<uPlot.AlignedData | null>(
    history && history.blockMoves.length > 0
      ? [history.tick, ...history.blockMoves.map((s) => smooth(s.counts))]
      : null,
  );
  const LINE_SERIES: ChartSeries[] = [
    { label: 'Longest built line (cells)', color: '#c478ff' },
    { label: 'Blocks creatures have moved', color: '#8a9aa9', axis: 'right' },
  ];
  const lineData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.longestBuiltLine, history.builtBlocks],
  );
  const SHELTER_SERIES: ChartSeries[] = [
    { label: 'Beside a block %', color: '#7fd6c2' },
    { label: 'Carrying a block %', color: '#c478ff' },
  ];
  const shelterData = $derived.by<uPlot.AlignedData | null>(() => {
    if (!history) return null;
    return [
      history.tick,
      history.shelteredShare.map((share) => share * 100),
      history.blockHolders.map((n, k) => (100 * n) / Math.max(1, history.population[k]!)),
    ];
  });

  const BRAIN_SERIES: ChartSeries[] = [
    { label: 'Links that can learn %', color: '#7fd6c2' },
    { label: 'Slow neurons %', color: '#c478ff' },
  ];
  const brainFeatureData = $derived.by<uPlot.AlignedData | null>(() => {
    if (!history) return null;
    return [
      history.tick,
      history.plasticLinkShare.map((share) => share * 100),
      history.slowNeuronShare.map((share) => share * 100),
    ];
  });
  const RATE_SERIES: ChartSeries[] = [
    { label: 'Mean learning rate', color: '#e8c468' },
    { label: 'Mean time constant (ticks)', color: '#6cb6ff', axis: 'right' },
  ];
  const rateData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.meanPlasticity, history.meanTau],
  );

  const ACTIVITY_SERIES: ChartSeries[] = [
    { label: 'Real population', color: '#7fd6c2' },
    { label: 'Neutral shadow', color: '#8a9aa9' },
  ];
  const activityData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.wiringActivity, history.wiringShadowActivity],
  );
  const SURVIVAL_SERIES: ChartSeries[] = [
    { label: 'Real population %', color: '#7fd6c2' },
    { label: 'Neutral shadow %', color: '#8a9aa9' },
  ];
  const survivalData = $derived<uPlot.AlignedData | null>(
    history && [
      history.tick,
      history.wiringSurvival.map((share) => share * 100),
      history.wiringShadowSurvival.map((share) => share * 100),
    ],
  );
  const WIRING_SERIES: ChartSeries[] = [
    { label: 'Different links in use', color: '#7fd6c2' },
    { label: 'Different links in the shadow', color: '#8a9aa9' },
  ];
  const wiringData = $derived<uPlot.AlignedData | null>(
    history && [history.tick, history.wiringLive, history.wiringShadowLive],
  );

  const CARRY_SERIES: ChartSeries[] = [
    { label: 'Holding a stone or branch %', color: '#b0b0b6' },
    { label: 'Holding food %', color: '#e8d678' },
  ];
  const carryData = $derived.by<uPlot.AlignedData | null>(() => {
    if (!history) return null;
    const share = (holders: Float32Array) => holders.map((n, k) => (100 * n) / Math.max(1, history.population[k]!));
    return [history.tick, share(history.toolHolders), share(history.foodHolders)];
  });
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
    <section class="card">
      <h1>Deaths by cause</h1>
      <p class="teaches">
        What is killing creatures, and so what evolution is being pushed to solve. A band that widens after an
        event shows what that event did.
      </p>
      <Chart
        {events}
        stacked
        title="Deaths per 1,000 ticks"
        note="Heat or cold counts creatures that ran out of energy while outside their comfort range. Other is plague, meteors and fire."
        series={DEATH_SERIES}
        data={deathData}
      />
    </section>

    <section class="card">
      <h1>Species stream</h1>
      <p class="teaches">
        How many creatures each species has, piled up, so the whole is the population. A new band splitting off
        a shrinking one is a species dividing; a band pinching out is an extinction.
      </p>
      {#if streamData}
        {#key streamKey}
          <Chart {events} stacked title="Members of each species" series={streamSeries} data={streamData} />
        {/key}
      {:else}
        <p class="empty">No species yet.</p>
      {/if}
    </section>

    <section class="card">
      <h1>Diet gene distribution</h1>
      <p class="teaches">
        How the population is spread between eating plants and eating meat right now. Two separate humps mean
        specialists; one hump in the middle means generalists.
      </p>
      {#if lab}
        <DietHistogram bins={lab.dietBins} />
      {:else}
        <p class="empty">No creatures yet.</p>
      {/if}
    </section>

    <section class="card">
      <h1>Density map</h1>
      <p class="teaches">
        Where creatures spend their time. Compare it with the biomes on the map to see which land is used, and
        drag back in time to watch populations move.
      </p>
      {#if lab}
        <DensityMap grid={lab.density.grid} frames={lab.density.frames} ticks={lab.density.ticks} />
      {/if}
    </section>

    <section class="card">
      <h1>Behaviour</h1>
      <p class="teaches">
        What creatures are doing, and how that shifts as generations pass. Each creature counts once. Chasing is
        biting, or trying to, while moving with another creature in view. Fleeing is moving hard, without biting,
        just after being bitten or with a creature close behind. Foraging is getting at least a quarter of a full
        mouthful. Resting is staying nearly still without feeding. The rest are wandering.
      </p>
      <Chart {events} title="Share of creatures" note="Running averages." series={BEHAVIOUR_SERIES} data={behaviourData} />
    </section>

    <section class="card">
      <h1>Life histories</h1>
      <p class="teaches">
        How lives are lived: how long, how soon the first child comes, and how many children in all. Short lives
        with early, many births and long lives with few are different answers to the same world.
      </p>
      <Chart
        {events}
        title="Ages, in ticks"
        note="Generation length is the average age of a parent at a birth. Running averages."
        series={LIFE_AGE_SERIES}
        data={lifeAgeData}
      />
      <Chart {events} title="Children" note="Average children had by the creatures that died." series={OFFSPRING_SERIES} data={offspringData} />
    </section>

    <section class="card wide">
      <h1>Food flow</h1>
      <p class="teaches">
        Where energy goes: from plants into plant-eaters, and from bodies into whatever eats meat. Only a small
        part of what plant-eaters take in ever reaches a meat-eater, which is why hunters are always few.
      </p>
      {#if flowNow}
        {@const [plantHerb, plantCarn, meatHerb, meatCarn] = flowNow.parts as [number, number, number, number]}
        <div class="flow">
          <div class="pool plants">Plants</div>
          <div class="arrows">
            <div class="arrow" style="--share: {plantHerb / flowNow.total}; --color: #4caf50">
              {percent(plantHerb / flowNow.total)} to plant-eaters
            </div>
            <div class="arrow" style="--share: {plantCarn / flowNow.total}; --color: #b7c94a">
              {percent(plantCarn / flowNow.total)} to meat-eaters
            </div>
          </div>
          <div class="pool bodies">Bodies of the dead</div>
          <div class="arrows">
            <div class="arrow" style="--share: {meatHerb / flowNow.total}; --color: #e8a468">
              {percent(meatHerb / flowNow.total)} to plant-eaters
            </div>
            <div class="arrow" style="--share: {meatCarn / flowNow.total}; --color: #e0566a">
              {percent(meatCarn / flowNow.total)} to meat-eaters
            </div>
          </div>
        </div>
        <p class="caption">
          Shares of all the energy eaten lately: {flowNow.total.toFixed(1)} a tick. A meat-eater is a creature whose
          diet gene is above one half.
        </p>
      {/if}
      <Chart {events} stacked title="Energy eaten per tick" note="Running averages." series={FLOW_SERIES} data={flowData} />
    </section>

    <section class="card wide" bind:this={selectionCard}>
      <h1>Selection at work</h1>
      <p class="teaches">
        Natural selection, measured. The yellow line is the average gene of the creatures that had young; the grey
        line is everyone alive. Where yellow sits above grey, that trait is being pushed up, and the gap is how hard. The yellow line is a running average, because only a few creatures breed at any moment.
      </p>
      <div class="charts">
        {#each SELECTION as trait, k (trait.title)}
          <div class:focused={focus === trait.title}>
          <Chart {events} title={trait.title} series={SELECTION_SERIES} data={selectionData[k] ?? null} />
          </div>
        {/each}
      </div>
    </section>

    <section class="card">
      <h1>Diversity over time</h1>
      <p class="teaches">
        How varied the population's body genes are. It drops when a disaster leaves few survivors or one family
        takes over, and climbs back as mutations build up again.
      </p>
      <Chart {events} title="Gene spread" note="The average spread (standard deviation) of size, speed, sensor range and diet." series={DIVERSITY_SERIES} data={diversityData} />
    </section>

    <section class="card wide">
      <h1>Building</h1>
      <p class="teaches">
        Whether creatures are doing anything with blocks. A creature moves a block by walking into it or by picking
        it up and setting it down. Moving blocks by accident scatters them; moving them on purpose would show as
        more creatures staying beside blocks, and as blocks ending up in lines.
      </p>
      <div class="charts three">
        {#if blockData}
          {#key blockKey}
            <Chart {events} stacked title="Blocks moved per 1,000 ticks" note="By the species that moved them. Running averages." series={blockSeries} data={blockData} />
          {/key}
        {:else}
          <p class="empty">No creature has moved a block yet.</p>
        {/if}
        <Chart
          {events}
          title="What they have built"
          note="The longest straight run of touching blocks that creatures moved, and how many blocks have been moved at all."
          series={LINE_SERIES}
          data={lineData}
        />
        <Chart {events} title="Creatures and blocks" note="The share of creatures in or beside a block's cell, where there is shelter, and the share carrying one." series={SHELTER_SERIES} data={shelterData} />
      </div>
    </section>

    <section class="card">
      <h1>Learning and slow neurons</h1>
      <p class="teaches">
        Whether evolution has used two brain features that start switched off. A link that can learn strengthens
        when the neurons at both ends are active together; a slow neuron changes gradually and so holds a state.
        If the lines stay at zero, nothing was gained by them in this world.
      </p>
      <div class="charts">
        <Chart title="How much of the brain uses them" series={BRAIN_SERIES} data={brainFeatureData} />
        <Chart title="How strongly" series={RATE_SERIES} data={rateData} />
      </div>
    </section>

    <section class="card">
      <h1>Is the wiring selected, or just drifting?</h1>
      <p class="teaches">
        Every brain link keeps a running count of how many samples it has been in the population. A link can last
        a long time by chance alone, so a neutral shadow runs alongside: a copy of the population with the same
        births and deaths, but where nothing is favoured. The survival chart takes every link that first appeared
        at least 20 samples ago and shows how many are still carried. Above the shadow, selection is keeping new
        wiring that chance would lose; below it, selection is purging new wiring.
      </p>
      <div class="charts">
        <Chart title="How long the average link has lasted (samples)" series={ACTIVITY_SERIES} data={activityData} />
        <Chart title="New links still carried" series={SURVIVAL_SERIES} data={survivalData} />
        <Chart title="How many different links" series={WIRING_SERIES} data={wiringData} />
      </div>
    </section>

    <section class="card">
      <h1>Carrying</h1>
      <p class="teaches">
        Whether holding things has become a habit. The first creatures hold at random; if the lines climb or
        fall away from where they start, selection is acting on carrying.
      </p>
      <Chart title="Share of creatures holding something" series={CARRY_SERIES} data={carryData} />
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

  /* The chart the Lab was opened to show. */
  .focused {
    outline: 1px solid var(--accent);
    outline-offset: 6px;
    border-radius: 4px;
  }

  .charts.three {
    grid-template-columns: repeat(3, minmax(0, 1fr));
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

  .flow {
    display: grid;
    grid-template-columns: 150px 1fr;
    gap: 8px 14px;
    align-items: center;
    margin-bottom: 8px;
    font-size: 12px;
  }

  .pool {
    padding: 10px;
    text-align: center;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-weight: 600;
  }

  .plants {
    background: rgba(76, 175, 80, 0.18);
  }

  .bodies {
    background: rgba(224, 86, 106, 0.18);
  }

  .arrows {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  /* A bar as long as its share of all the energy eaten, with a little always showing. */
  .arrow {
    width: calc(max(2%, var(--share) * 100%));
    min-width: max-content;
    padding: 3px 8px;
    border-left: 4px solid var(--color);
    background: linear-gradient(90deg, color-mix(in srgb, var(--color) 45%, transparent), transparent);
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
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
