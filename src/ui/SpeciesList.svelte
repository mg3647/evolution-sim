<script lang="ts">
  import { speciesHue } from '../render/renderer';
  import type { SpeciesView } from '../worker/protocol';

  let { species, tick }: { species: SpeciesView[]; tick: number } = $props();

  function dietName(diet: number): string {
    if (diet < 0.25) return 'plants';
    if (diet > 0.75) return 'meat';
    return 'both';
  }
</script>

<section>
  <h2>Species</h2>
  <p>
    A species is a branch of the family tree that split off at least a year (6,000 ticks) ago and has
    since become clearly different in body or diet from the group it left. Tick "Colour by species"
    above the world to see them on the map and the tree.
  </p>
  <table>
    <thead>
      <tr><th></th><th>Members</th><th>Eats</th><th>Size</th><th>Speed</th><th>Age</th></tr>
    </thead>
    <tbody>
      {#each species as s (s.id)}
        <tr>
          <td><span class="swatch" style="background: hsl({speciesHue(s.id) * 360}, 70%, 60%)"></span></td>
          <td>{s.count.toLocaleString()}</td>
          <td>{dietName(s.meanDiet)}</td>
          <td>{s.meanSize.toFixed(2)}</td>
          <td>{s.meanSpeed.toFixed(2)}</td>
          <td>{(tick - s.bornTick).toLocaleString()}</td>
        </tr>
      {/each}
    </tbody>
  </table>
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
  }

  td:first-child,
  th:first-child {
    width: 16px;
    padding-left: 0;
  }

  .swatch {
    display: block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
  }
</style>
