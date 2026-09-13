<script lang="ts">
  import type {
    ReconciliationAssessment,
    ReconciliationCounts,
  } from "../lib/reconciliation";
  let {
    variants,
  }: { variants: { variantId: string; metrics: ReconciliationAssessment }[] } =
    $props();
  let filter = $state("all");
  const percent = (value: number | null) =>
    value === null ? "Not applicable" : `${(100 * value).toFixed(2)}%`;
</script>

<section
  class="reconciliation-assessment"
  aria-label="Reconciliation outcome assessment"
>
  <h3>Reconciliation outcome quality</h3>
  <p>
    Committed coverage describes your output. Truth recall measures recovered
    determinate decisions. Evidence scores are not calibrated probabilities;
    explanations are not machine-verified.
  </p>
  <label
    >Evidence cases <select bind:value={filter}
      ><option value="all">All references</option><option value="false"
        >False commitments</option
      ><option value="missing">Missing cases</option><option value="ambiguous"
        >Ambiguous cases</option
      ><option value="groups">Failed group recovery</option></select
    ></label
  >
  {#each variants as variant}
    {@const assessment = variant.metrics}
    <section aria-label={`Assessment ${variant.variantId}`}>
      <h4>
        {variant.variantId} — {assessment.pass ? "Pass" : "Not yet correct"}
      </h4>
      <dl>
        <dt>Committed precision</dt>
        <dd>
          {percent(assessment.metrics.committedPrecision)} ({assessment.metrics
            .correctCommitted}/{assessment.metrics.committed})
        </dd>
        <dt>Determinate-match recall</dt>
        <dd>
          {percent(assessment.metrics.determinateRecall)} ({assessment.metrics
            .correctCommitted}/{assessment.metrics.determinate})
        </dd>
        <dt>Committed coverage of all references</dt>
        <dd>{percent(assessment.metrics.committedCoverage)}</dd>
        <dt>High-confidence precision</dt>
        <dd>
          {percent(assessment.metrics.highConfidencePrecision)}; {assessment
            .metrics.incorrectHigh} incorrect high decisions
        </dd>
        <dt>Split-family recall</dt>
        <dd>
          {percent(assessment.metrics.splitRecall)} ({assessment.metrics
            .recoveredSplitGroups}/{assessment.metrics.splitGroups} whole groups)
        </dd>
        <dt>Rollup-family recall</dt>
        <dd>
          {percent(assessment.metrics.rollupRecall)} ({assessment.metrics
            .recoveredRollupGroups}/{assessment.metrics.rollupGroups} whole groups)
        </dd>
      </dl>
      <ul>
        {#each assessment.errors as error}<li>{error}</li>{/each}
      </ul>
      {@render counts("All references", { all: assessment.counts })}
      {@render counts("Business unit", assessment.byBusinessUnit)}
      {@render counts("Reference category", assessment.byCategory)}
      <p>
        False commitments: {assessment.falseCommitments.join(", ") || "None"}.
        Missing cases: {assessment.missingCases.join(", ") || "None"}. Ambiguous
        cases: {assessment.ambiguousCases.join(", ") || "None"}.
      </p>
      <p>
        Failed whole-group recovery: {assessment.failedGroups.join("; ") ||
          "None"}.
      </p>
      {#each assessment.evidence.filter((row) => filter === "all" || (filter === "false" && assessment.falseCommitments.includes(row.refId)) || (filter === "missing" && assessment.missingCases.includes(row.refId)) || (filter === "ambiguous" && assessment.ambiguousCases.includes(row.refId)) || (filter === "groups" && !!row.expectedGroup && assessment.failedGroups.includes(row.expectedGroup.key))) as row}
        <details>
          <summary
            >Reference {row.refId} — {row.confidence}, score {row.score}{row
              .issues.length
              ? " — inspect issues"
              : ""}</summary
          >
          <p><strong>Learner explanation:</strong> {row.explanation}</p>
          <p>
            Listed partners: {row.partnerIds.join(", ") || "None"}. Truth
            status: {row.truthStatus}. Commitment: {row.committedGroupKey ??
              "None"}.
          </p>
          <ul>
            {#each row.issues as issue}<li>{issue}</li>{/each}
          </ul>
          <h5>Reference source (unchanged)</h5>
          <pre>{JSON.stringify(row.reference, null, 2)}</pre>
          <h5>Partner source rows</h5>
          <pre>{JSON.stringify(row.partners, null, 2)}</pre>
          <h5>Observed pair evidence facts</h5>
          <pre>{JSON.stringify(row.facts, null, 2)}</pre>
          <h5>Whole-group evidence</h5>
          <pre>{JSON.stringify(row.expectedGroup, null, 2)}</pre>
        </details>
      {/each}
    </section>
  {/each}
</section>

{#snippet counts(label: string, rows: Record<string, ReconciliationCounts>)}
  <details>
    <summary>Counts by {label.toLowerCase()}</summary>
    <div class="table-scroll">
      <table>
        <thead
          ><tr
            ><th>{label}</th><th>Total</th><th>High</th><th>Probable</th><th
              >Ambiguous</th
            ><th>Missing</th><th>Committed</th><th>Correct committed</th></tr
          ></thead
        >
        <tbody
          >{#each Object.entries(rows) as [name, count]}<tr
              ><th>{name}</th><td>{count.total}</td><td>{count.high}</td><td
                >{count.probable}</td
              ><td>{count.ambiguous}</td><td>{count.missing}</td><td
                >{count.committed}</td
              ><td>{count.correctCommitted}</td></tr
            >{/each}</tbody
        >
      </table>
    </div>
  </details>
{/snippet}

<style>
  .reconciliation-assessment {
    padding: 12px;
    display: grid;
    gap: 12px;
  }
  dl {
    display: grid;
    grid-template-columns: minmax(140px, 1fr) 1fr;
    gap: 5px;
  }
  dd {
    margin: 0;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  details {
    margin: 8px 0;
  }
  summary {
    cursor: pointer;
  }
  .table-scroll {
    overflow: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
  }
  th,
  td {
    border: 1px solid #888;
    padding: 4px;
    text-align: left;
  }
</style>
