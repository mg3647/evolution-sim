<script lang="ts">
  import { onMount } from 'svelte';
  import { WorldRenderer } from '../render/renderer';
  import { defaultConfig } from '../sim/config';
  import { SimClient } from '../worker/client';
  import type { Snapshot, Speed } from '../worker/protocol';

  const SPEEDS: { label: string; value: Speed }[] = [
    { label: '1x', value: 1 },
    { label: '2x', value: 2 },
    { label: '4x', value: 4 },
    { label: '16x', value: 16 },
    { label: 'Max', value: 'max' },
  ];

  let host: HTMLDivElement;
  let client: SimClient | undefined;
  let renderer: WorldRenderer | undefined;
  let snapshot = $state<Snapshot | null>(null);
  let seed = $state(defaultConfig.seed);

  onMount(() => {
    let disposed = false;
    const r = new WorldRenderer();
    r.init(host).then(() => {
      if (disposed) {
        r.destroy();
        return;
      }
      renderer = r;
      client = new SimClient((s) => {
        snapshot = s;
        r.setWorldSize(s.worldWidth, s.worldHeight);
      });
      client.init({ ...defaultConfig, seed });
    });
    return () => {
      disposed = true;
      client?.destroy();
      renderer?.destroy();
    };
  });

  function togglePlay() {
    if (snapshot?.running) client?.pause();
    else client?.play();
  }

  function restart(event: SubmitEvent) {
    event.preventDefault();
    client?.init({ ...defaultConfig, seed });
  }
</script>

<div class="layout">
  <header>
    <strong>Evolution Sim</strong>

    <div class="group">
      <button onclick={togglePlay} disabled={!snapshot}>
        {snapshot?.running ? 'Pause' : 'Play'}
      </button>
      <button onclick={() => client?.step(1)} disabled={!snapshot || snapshot.running}>Step</button>
    </div>

    <div class="group" role="group" aria-label="Speed">
      {#each SPEEDS as option (option.label)}
        <button
          class:active={snapshot?.speed === option.value}
          onclick={() => client?.setSpeed(option.value)}
          disabled={!snapshot}
        >
          {option.label}
        </button>
      {/each}
    </div>

    <form class="group" onsubmit={restart}>
      <label>
        Seed
        <input bind:value={seed} spellcheck="false" />
      </label>
      <button type="submit" disabled={!snapshot}>Restart</button>
    </form>

    <div class="stats">
      <span>Tick <b>{snapshot ? snapshot.tick.toLocaleString() : '-'}</b></span>
      <span><b>{snapshot ? Math.round(snapshot.measuredTps).toLocaleString() : '-'}</b> ticks/s</span>
    </div>

    <button onclick={() => renderer?.fitToView()} disabled={!snapshot}>Fit view</button>
  </header>

  <div class="world" bind:this={host}></div>
</div>

<style>
  .layout {
    display: flex;
    flex-direction: column;
    height: 100%;
  }

  header {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px 20px;
    padding: 8px 14px;
    background: var(--panel);
    border-bottom: 1px solid var(--border);
  }

  .group {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  label {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--muted);
  }

  input {
    width: 9em;
  }

  .stats {
    display: flex;
    gap: 16px;
    margin-left: auto;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
  }

  .stats b {
    color: var(--text);
  }

  .world {
    flex: 1;
    min-height: 0;
    overflow: hidden;
    cursor: grab;
  }

  .world:active {
    cursor: grabbing;
  }
</style>
