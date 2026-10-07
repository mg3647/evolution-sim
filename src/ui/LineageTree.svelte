<script lang="ts">
  import { speciesHue } from '../render/renderer';
  import type { TreeData } from '../worker/protocol';

  const HEIGHT = 280;
  const PAD = 6;

  let {
    tree,
    bySpecies = false,
    yearLength = 0,
    picked = false,
    onPick,
  }: {
    tree: TreeData | null;
    bySpecies?: boolean;
    /** Ticks in a year, for zooming to the last few. 0 if seasons are off. */
    yearLength?: number;
    /** Whether a branch picked here is being shown on the map. */
    picked?: boolean;
    /** Called with the ids of a branch's living members when it is clicked, or null to let go. */
    onPick: (ids: Set<number> | null) => void;
  } = $props();

  /** How much of the run the tree shows: 0 is all of it, otherwise the last so many years. */
  const ZOOMS = [
    { years: 0, label: 'Whole run' },
    { years: 5, label: 'Last 5 years' },
    { years: 2, label: 'Last 2 years' },
  ];
  let zoomYears = $state(0);
  /** What the pointer is on, for the line under the tree. */
  let hovered = $state<{ founder: number; species: number; living: number; alive: boolean; born: number } | null>(null);

  /** Where everything was last drawn, for finding what the pointer is on. */
  let drawn: {
    data: TreeData;
    row: Float32Array;
    children: number[][];
    x: (tick: number) => number;
    y: (k: number) => number;
    end: Float64Array;
  } | null = null;

  let canvas: HTMLCanvasElement;
  let living = $state(0);
  let founders = $state(0);
  /** The most recent ancestor shared by the largest family, or null in an empty world. */
  let ancestor = $state<{ bornTick: number; ago: number; share: number; alive: boolean } | null>(null);

  /** Give every creature a row: the living get their own, a dead ancestor sits amid its children. */
  function layoutRows(data: TreeData): { row: Float32Array; rows: number; children: number[][] } {
    const count = data.parent.length;
    const children: number[][] = Array.from({ length: count }, () => []);
    const roots: number[] = [];
    for (let k = 0; k < count; k++) {
      const parent = data.parent[k]!;
      if (parent < 0) roots.push(k);
      else children[parent]!.push(k);
    }
    const byBirth = (a: number, b: number) => data.birthTick[a]! - data.birthTick[b]!;
    roots.sort(byBirth);
    for (const list of children) list.sort(byBirth);

    const row = new Float32Array(count);
    let next = 0;
    // Depth-first without recursion: a node is placed after all its children.
    const stack: [number, number][] = roots.reverse().map((k) => [k, 0]);
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      const [node, visited] = top;
      const kids = children[node]!;
      if (visited < kids.length) {
        top[1]++;
        stack.push([kids[visited]!, 0]);
        continue;
      }
      stack.pop();
      if (data.deathTick[node]! < 0 || kids.length === 0) row[node] = next++;
      else row[node] = kids.reduce((sum, kid) => sum + row[kid]!, 0) / kids.length;
    }
    return { row, rows: next, children };
  }

  function draw(data: TreeData, colorBySpecies: boolean, ancestorIndex: number): void {
    const width = canvas.clientWidth;
    const scale = window.devicePixelRatio || 1;
    canvas.width = width * scale;
    canvas.height = HEIGHT * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.clearRect(0, 0, width, HEIGHT);

    const count = data.parent.length;
    if (count === 0) return;
    const { row, rows, children } = layoutRows(data);
    let first = Infinity;
    for (let k = 0; k < count; k++) first = Math.min(first, data.birthTick[k]!);
    // Zoomed in, the left edge is that many years back; older lines run off it.
    if (zoomYears > 0 && yearLength > 0) first = Math.max(first, data.tick - zoomYears * yearLength);
    const span = Math.max(1, data.tick - first);
    const x = (tick: number) => PAD + ((tick - first) / span) * (width - PAD * 2);
    const y = (k: number) => PAD + ((row[k]! + 0.5) / Math.max(1, rows)) * (HEIGHT - PAD * 2);

    // A dashed line marks when the largest family's common ancestor was born.
    if (ancestorIndex >= 0) {
      const at = x(data.birthTick[ancestorIndex]!);
      ctx.strokeStyle = 'rgba(219, 228, 236, 0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(at, 0);
      ctx.lineTo(at, HEIGHT);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const ends = new Float64Array(count);
    drawn = { data, row, children, x, y, end: ends };
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (let k = 0; k < count; k++) {
      const alive = data.deathTick[k]! < 0;
      // A dead ancestor's line runs on to where its last child branches off.
      let end = alive ? data.tick : data.deathTick[k]!;
      for (const kid of children[k]!) end = Math.max(end, data.birthTick[kid]!);
      ends[k] = end;
      const hue = colorBySpecies ? speciesHue(data.species[k]!) : data.hue[k]!;
      ctx.strokeStyle = `hsl(${hue * 360}, 70%, ${alive ? 62 : 42}%)`;
      ctx.beginPath();
      ctx.moveTo(x(data.birthTick[k]!), y(k));
      ctx.lineTo(x(end), y(k));
      const parent = data.parent[k]!;
      if (parent >= 0) {
        ctx.moveTo(x(data.birthTick[k]!), y(parent));
        ctx.lineTo(x(data.birthTick[k]!), y(k));
      }
      ctx.stroke();
    }
  }

  /** The creature whose line is nearest the pointer, or -1 if none is close. */
  function nodeAt(event: MouseEvent): number {
    if (!drawn) return -1;
    const box = canvas.getBoundingClientRect();
    const px = event.clientX - box.left;
    const py = event.clientY - box.top;
    let best = -1;
    let bestGap = 5;
    for (let k = 0; k < drawn.data.parent.length; k++) {
      const gap = Math.abs(drawn.y(k) - py);
      if (gap >= bestGap) continue;
      if (px < drawn.x(drawn.data.birthTick[k]!) - 2 || px > drawn.x(drawn.end[k]!) + 2) continue;
      best = k;
      bestGap = gap;
    }
    return best;
  }

  /** The living creatures on a branch: the one it starts at and everything descended from it. */
  function livingOn(branch: number): number[] {
    if (!drawn) return [];
    const { data, children } = drawn;
    const living: number[] = [];
    const pending = [branch];
    while (pending.length > 0) {
      const k = pending.pop()!;
      if (data.deathTick[k]! < 0) living.push(k);
      for (const kid of children[k]!) pending.push(kid);
    }
    return living;
  }

  function point(event: MouseEvent): void {
    const k = nodeAt(event);
    if (k < 0 || !drawn) {
      hovered = null;
      return;
    }
    const living = livingOn(k);
    const { data } = drawn;
    hovered = {
      // A dead ancestor's founder is that of any of its living descendants.
      founder: living.length > 0 ? data.founder[living[0]!]! : 0,
      species: data.species[k]!,
      living: living.length,
      alive: data.deathTick[k]! < 0,
      born: data.birthTick[k]!,
    };
  }

  function click(event: MouseEvent): void {
    const k = nodeAt(event);
    if (k < 0 || !drawn) {
      onPick(null);
      return;
    }
    const { data } = drawn;
    onPick(new Set(livingOn(k).map((node) => data.id[node]!)));
  }

  /**
   * The family holding the most living creatures. The tree keeps a dead
   * creature only where lines branch, so the top of a family is the most
   * recent ancestor that all its living members share.
   */
  function largestFamily(data: TreeData): { root: number; members: number } | null {
    const members = new Map<number, number>();
    for (let k = 0; k < data.parent.length; k++) {
      if (data.deathTick[k]! >= 0) continue;
      let root = k;
      while (data.parent[root]! >= 0) root = data.parent[root]!;
      members.set(root, (members.get(root) ?? 0) + 1);
    }
    let best: { root: number; members: number } | null = null;
    for (const [root, count] of members) {
      if (!best || count > best.members) best = { root, members: count };
    }
    return best;
  }

  $effect(() => {
    if (!tree) return;
    let alive = 0;
    let roots = 0;
    for (let k = 0; k < tree.parent.length; k++) {
      if (tree.deathTick[k]! < 0) alive++;
      if (tree.parent[k]! < 0) roots++;
    }
    living = alive;
    founders = roots;
    const family = largestFamily(tree);
    ancestor = family && {
      bornTick: tree.birthTick[family.root]!,
      ago: tree.tick - tree.birthTick[family.root]!,
      share: alive > 0 ? family.members / alive : 0,
      alive: tree.deathTick[family.root]! < 0,
    };
    // Redraw when the zoom changes too.
    void zoomYears;
    draw(tree, bySpecies, family?.root ?? -1);
  });
</script>

<section>
  <h2>Family tree</h2>
  <p>
    Every creature alive now, traced back to its ancestors. Time runs left to right and ends at the
    present. Lines join at a common ancestor, so a join far to the left means two families split long
    ago. Colour is the inherited body colour, or the species when "Colour by species" is ticked. Point at a
    line to read it; click it to pick out that branch's living members on the map.
  </p>
  <div class="zoom" role="group" aria-label="How much of the run to show">
    {#each ZOOMS as zoom (zoom.years)}
      <button
        class:active={zoomYears === zoom.years}
        disabled={zoom.years > 0 && yearLength <= 0}
        onclick={() => (zoomYears = zoom.years)}
      >
        {zoom.label}
      </button>
    {/each}
    {#if picked}<button onclick={() => onPick(null)}>Show everyone again</button>{/if}
  </div>
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <canvas
    bind:this={canvas}
    style="height: {HEIGHT}px"
    onmousemove={point}
    onmouseleave={() => (hovered = null)}
    onclick={click}
  ></canvas>
  <p class="readout">
    {#if hovered}
      {hovered.alive ? 'A living creature' : 'An ancestor'} born at tick {Math.round(hovered.born).toLocaleString()},
      of species <b>{hovered.species}</b>{hovered.founder > 0 ? `, in the family of founder #${hovered.founder}` : ''}.
      <b>{hovered.living.toLocaleString()}</b> living {hovered.living === 1 ? 'creature is' : 'creatures are'} on this
      branch.
    {:else}
      Point at a line to see its founder, species and living members.
    {/if}
  </p>
  {#if tree && ancestor}
    <p class="caption">
      {#if founders === 1}
        All <b>{living.toLocaleString()}</b> living creatures share one ancestor
      {:else}
        There are <b>{founders.toLocaleString()}</b> unrelated families. The largest holds
        <b>{Math.round(ancestor.share * 100)}%</b> of the {living.toLocaleString()} living creatures and shares
        one ancestor
      {/if}
      born <b>{ancestor.ago.toLocaleString()}</b> ticks ago, at tick {ancestor.bornTick.toLocaleString()}{ancestor.alive
        ? ', and it is still alive'
        : ''}. The dashed line marks that moment.
    </p>
  {/if}
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

  .caption,
  .readout {
    margin: 6px 0 0;
  }

  .readout {
    min-height: 2.9em;
  }

  .readout b {
    color: var(--text);
  }

  .zoom {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-bottom: 6px;
  }

  .zoom button {
    font-size: 12px;
    padding: 2px 8px;
  }

  .caption b {
    color: var(--text);
  }

  canvas {
    display: block;
    width: 100%;
    cursor: pointer;
    background: #0f151c;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
</style>
