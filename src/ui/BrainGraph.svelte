<script lang="ts">
  import { INPUT_COUNT, INPUT_LABELS, OUTPUT_COUNT, OUTPUT_LABELS } from '../sim/brain';
  import type { BrainView } from '../worker/protocol';

  const WIDTH = 316;
  const ROW = 17;
  const PAD = 12;
  const INPUT_X = 118;
  const OUTPUT_X = 226;
  const HIDDEN_X = (INPUT_X + OUTPUT_X) / 2;
  const POSITIVE = '108, 182, 255';
  const NEGATIVE = '255, 143, 107';

  let {
    brain,
    strength,
    note,
    idle,
    live = false,
  }: {
    brain: BrainView;
    /** How solid to draw each link, from 0 to 1. Defaults to how active its source neuron is. */
    strength?: number[];
    /** Text under the diagram, in place of the default explanation. */
    note?: string;
    /** Per action, why it does nothing here, or null; idle actions and the links into them are drawn faint. */
    idle?: (string | null)[];
    /** The brain is a living creature's: make the links carrying a signal right now glow. */
    live?: boolean;
  } = $props();

  /** A link is firing when its source's output times its weight is at least this strong. */
  const FIRING = 0.25;

  interface Node {
    index: number;
    x: number;
    y: number;
    label: string;
    side: 'input' | 'hidden' | 'output';
    /** Why this action does nothing here, if it does nothing. */
    idle?: string;
  }

  /** Place the neurons: inputs that are wired up on the left, outputs on the right, hidden between. */
  const layout = $derived.by(() => {
    const used = new Set<number>(brain.linkFrom);
    const inputs: number[] = [];
    for (let i = 0; i < INPUT_COUNT; i++) if (used.has(i)) inputs.push(i);
    const hidden = Array.from({ length: brain.hiddenCount }, (_, k) => INPUT_COUNT + OUTPUT_COUNT + k);
    const rows = Math.max(inputs.length, OUTPUT_COUNT, hidden.length, 1);
    const height = PAD * 2 + (rows - 1) * ROW;
    const column = (count: number, k: number) => height / 2 + (k - (count - 1) / 2) * ROW;

    const nodes = new Map<number, Node>();
    inputs.forEach((index, k) =>
      nodes.set(index, { index, x: INPUT_X, y: column(inputs.length, k), label: INPUT_LABELS[index]!, side: 'input' }),
    );
    for (let k = 0; k < OUTPUT_COUNT; k++) {
      const index = INPUT_COUNT + k;
      const why = idle?.[k] ?? undefined;
      nodes.set(index, { index, x: OUTPUT_X, y: column(OUTPUT_COUNT, k), label: OUTPUT_LABELS[k]!, side: 'output', idle: why });
    }
    hidden.forEach((index, k) =>
      nodes.set(index, { index, x: HIDDEN_X, y: column(hidden.length, k), label: '', side: 'hidden' }),
    );
    return { nodes, height };
  });

  const links = $derived(
    brain.linkWeight.map((weight, k) => {
      const from = layout.nodes.get(brain.linkFrom[k]!)!;
      const to = layout.nodes.get(brain.linkTo[k]!)!;
      const signal = strength ? (strength[k] ?? 0) : Math.abs(brain.activation[from.index] ?? 0);
      let path: string;
      if (from === to) {
        // A link from a neuron to itself: a small loop above it.
        path = `M ${from.x - 4} ${from.y - 4} C ${from.x - 14} ${from.y - 20}, ${from.x + 14} ${from.y - 20}, ${from.x + 4} ${from.y - 4}`;
      } else {
        // Bow links that run backwards or within a column so they do not lie on top of others.
        const bow = to.x <= from.x ? 26 : 0;
        const midX = (from.x + to.x) / 2;
        const midY = (from.y + to.y) / 2 - bow;
        path = `M ${from.x} ${from.y} Q ${midX} ${midY} ${to.x} ${to.y}`;
      }
      return {
        path,
        color: weight >= 0 ? POSITIVE : NEGATIVE,
        width: 0.6 + Math.min(3, Math.abs(weight)),
        opacity: to.idle ? 0.12 : 0.18 + 0.82 * Math.min(1, signal),
        firing: live && !to.idle && Math.abs((brain.activation[from.index] ?? 0) * weight) >= FIRING,
      };
    }),
  );

  function fill(index: number): string {
    const value = brain.activation[index] ?? 0;
    const strength = Math.min(1, Math.abs(value));
    return `rgba(${value >= 0 ? POSITIVE : NEGATIVE}, ${0.12 + 0.88 * strength})`;
  }
</script>

<svg viewBox="0 0 {WIDTH} {layout.height}" width="100%" role="img" aria-label="Diagram of this creature's brain wiring">
  {#each links as link, k (k)}
    {#if link.firing}
      <path d={link.path} fill="none" stroke="rgba({link.color}, 0.3)" stroke-width={link.width + 5} stroke-linecap="round" />
    {/if}
    <path
      d={link.path}
      fill="none"
      stroke="rgba({link.color}, {link.firing ? 1 : link.opacity})"
      stroke-width={link.firing ? link.width + 0.8 : link.width}
    />
  {/each}
  {#each [...layout.nodes.values()] as node (node.index)}
    <g class:idle={node.idle}>
      {#if node.idle}<title>{node.label}: {node.idle}</title>{/if}
      <circle
        cx={node.x}
        cy={node.y}
        r="5"
        fill={node.idle ? 'none' : fill(node.index)}
        stroke="#8a9aa9"
        stroke-width="1"
        stroke-dasharray={node.idle ? '2 2' : undefined}
      />
      {#if node.side === 'input'}
        <text x={node.x - 10} y={node.y + 3.5} text-anchor="end">{node.label}</text>
      {:else if node.side === 'output'}
        <text x={node.x + 10} y={node.y + 3.5}>{node.label}</text>
      {/if}
    </g>
  {/each}
</svg>
<p>
  {#if note}
    {note}
  {:else}
    Senses on the left, actions on the right, hidden neurons between. Blue links excite, orange links
    suppress, and thicker means stronger. A link lights up when its source is active{live
      ? ', and glows while it is carrying a strong signal right now'
      : ''}. Senses with no link are left out{idle?.some((why) => why !== null)
      ? '. Faint, dashed actions do nothing for this creature in this world; hover one to see why'
      : ''}.
  {/if}
</p>

<style>
  svg {
    display: block;
    background: #0f151c;
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  text {
    fill: var(--text);
    font-size: 10px;
  }

  .idle {
    opacity: 0.4;
  }

  p {
    margin: 6px 0 0;
    font-size: 12px;
    line-height: 1.45;
    color: var(--muted);
  }
</style>
