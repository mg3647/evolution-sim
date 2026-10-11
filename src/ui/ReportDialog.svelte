<script lang="ts">
  import type { ReportSummary } from '../worker/protocol';

  /** Repository and folder that reports are kept in. */
  const REPO = 'mg3647/evolution-sim';
  const FOLDER = 'runs';

  let {
    report,
    onPrepare,
    onClose,
    onDownload,
  }: {
    /** The finished report, or null until it has been made. */
    report: { json: string; fileName: string; summary: ReportSummary } | null;
    /** Ask for the report, with what the person wrote about the run. */
    onPrepare: (question: string, notes: string) => void;
    onClose: () => void;
    onDownload: (json: string, fileName: string) => void;
  } = $props();

  let question = $state('');
  let notes = $state('');
  let preparing = $state(false);
  let copied = $state(false);
  let failed = $state(false);

  const kb = $derived(report ? Math.max(1, Math.round(report.summary.bytes / 1024)) : 0);

  /** Put the report on the clipboard and open GitHub's new-file page, where it only needs pasting and committing. */
  async function copyAndOpen() {
    if (!report) return;
    try {
      await navigator.clipboard.writeText(report.json);
      copied = true;
      failed = false;
    } catch {
      copied = false;
      failed = true;
    }
    const name = encodeURIComponent(report.fileName);
    window.open(`https://github.com/${REPO}/new/main?filename=${FOLDER}/${name}`, '_blank', 'noreferrer');
  }
</script>

<div class="backdrop" role="presentation" onclick={onClose}></div>
<div class="dialog" role="dialog" aria-modal="true" aria-label="Run report">
  <h2>Run report</h2>
  {#if !report}
    <p class="muted">
      A report is a small file with this run's settings, seed, charts' numbers, species and events, so runs can be compared
      later. It is made from the world as it is now.
    </p>
    <label>
      What were you testing or curious about?
      <input bind:value={question} placeholder="e.g. do blocks lead to cooperation with 3x more blocks?" />
    </label>
    <label>
      What did you notice?
      <textarea bind:value={notes} rows="4" placeholder="Anything odd, interesting, or surprising while watching"></textarea>
    </label>
    <div class="actions">
      <button
        class="primary"
        disabled={preparing}
        onclick={() => {
          preparing = true;
          onPrepare(question.trim(), notes.trim());
        }}
      >
        {preparing ? 'Making the report…' : 'Make report'}
      </button>
    </div>
  {:else}
    <p class="muted">
      Tick {report.summary.tick.toLocaleString()} · about {kb} KB ·
      {#if report.summary.clean}
        <span class="ok">clean run</span> (nothing changed by hand, no reseeding)
      {:else}
        <span class="warn">not a clean run</span>:
        {report.summary.interventions} change{report.summary.interventions === 1 ? '' : 's'} by hand{report.summary.reseeded > 0
          ? `, ${report.summary.reseeded} creatures reseeded`
          : ''}. The report records this, so it can be left out of comparisons later.
      {/if}
    </p>
    <div class="actions">
      <button class="primary" onclick={copyAndOpen}>Copy and open GitHub</button>
      <button onclick={() => report && onDownload(report.json, report.fileName)}>Download file instead</button>
    </div>
    {#if copied}
      <p class="ok">Copied. On the GitHub page that opened, click in the big text box, paste (Ctrl+V), then press "Commit changes".</p>
    {:else if failed}
      <p class="warn">The browser would not copy it. Use "Download file instead", then upload that file to the runs folder.</p>
    {/if}
  {/if}
  <div class="actions end"><button onclick={onClose}>Close</button></div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    z-index: 40;
  }
  .dialog {
    position: fixed;
    z-index: 41;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(520px, calc(100vw - 32px));
    max-height: calc(100vh - 48px);
    overflow: auto;
    padding: 18px 20px;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
  }
  h2 {
    margin: 0 0 8px;
    font-size: 16px;
  }
  p {
    margin: 8px 0;
    line-height: 1.45;
  }
  label {
    display: block;
    margin: 10px 0 0;
    color: var(--muted);
    font-size: 12px;
  }
  label input,
  label textarea {
    display: block;
    width: 100%;
    box-sizing: border-box;
    margin-top: 4px;
    font: inherit;
    color: var(--text);
  }
  .muted {
    color: var(--muted);
  }
  .ok {
    color: #7fd6a0;
  }
  .warn {
    color: #e8c468;
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin: 12px 0;
  }
  .actions.end {
    justify-content: flex-end;
    margin-bottom: 0;
  }
</style>
