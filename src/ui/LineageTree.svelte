<script lang="ts">
  import { speciesHue } from '../render/renderer';
  import type { TreeData } from '../worker/protocol';

  const HEIGHT = 280;
  const PAD = 6;

  let { tree, bySpecies = false }: { tree: TreeData | null; bySpecies?: boolean } = $props();

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

    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.85;
    for (let k = 0; k < count; k++) {
      const alive = data.deathTick[k]! < 0;
      // A dead ancestor's line runs on to where its last child branches off.
      let end = alive ? data.tick : data.deathTick[k]!;
      for (const kid of children[k]!) end = Math.max(end, data.birthTick[kid]!);
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
    draw(tree, bySpecies, family?.root ?? -1);
  });
</script>

<section>
  <h2>Family tree</h2>
  <p>
    Every creature alive now, traced back to its ancestors. Time runs left to right and ends at the
    present. Lines join at a common ancestor, so a join far to the left means two families split long
    ago. Colour is the inherited body colour, or the species when "Colour by species" is ticked.
  </p>
  <canvas bind:this={canvas} style="height: {HEIGHT}px"></canvas>
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

  .caption {
    margin: 6px 0 0;
  }

  .caption b {
    color: var(--text);
  }

  canvas {
    display: block;
    width: 100%;
    background: #0f151c;
    border: 1px solid var(--border);
    border-radius: 4px;
  }
</style>
