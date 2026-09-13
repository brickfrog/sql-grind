<script lang="ts">
  import type { Snippet } from "svelte";
  import type {
    LabDocument,
    LabEvidence,
    SqlSlot,
    Reported,
    AccessPath,
    LowerMedian,
  } from "../engine-labs";

  interface Props {
    document: LabDocument;
    evidence?: LabEvidence | null;
    evidenceCurrent: boolean;
    busy: boolean;
    error?: string;
    baselineSql?: string;
    editor: Snippet<[SqlSlot, string, (sql: string) => void]>;
    onchange: (document: LabDocument) => void;
    onmeasure: () => void;
    onreset: () => void;
    oncancel: () => void;
  }
  let {
    document,
    evidence,
    evidenceCurrent,
    busy,
    error,
    baselineSql,
    editor,
    onchange,
    onmeasure,
    onreset,
    oncancel,
  }: Props = $props();
  const labels: Record<LabDocument["kind"], string> = {
    cardinality: "Output cardinality and scanned work",
    pushdown: "Filter evidence",
    preaggregation: "Aggregation comparison",
    index: "Disposable index sandbox",
    selectivity: "Selective and broad work",
  };
  const choice = (event: Event) =>
    (event.currentTarget as HTMLSelectElement).value;
  function updateSql(slot: "secondary" | "create" | "drop", sql: string): void {
    if (
      slot === "secondary" &&
      (document.kind === "pushdown" || document.kind === "selectivity")
    )
      onchange({ ...document, secondarySql: sql });
    if (document.kind === "index")
      onchange(
        slot === "create"
          ? { ...document, createSql: sql }
          : { ...document, dropSql: sql },
      );
  }
  function report(field: string, value: unknown): void {
    // The controls below restrict each field to its document's discriminant.
    onchange({
      ...document,
      report: { ...document.report, [field]: value },
    } as LabDocument);
  }
</script>

<section class="plan-lab" aria-label={labels[document.kind]}>
  <h3>{labels[document.kind]}</h3>
  <p>
    The main SQL editor contains the primary query. Correct results and a report
    that agrees with current measurements earn completion.
  </p>
  {#if document.kind === "pushdown" || document.kind === "selectivity"}
    <h4>
      {document.kind === "pushdown"
        ? "Secondary query: named relation"
        : "Secondary query: broad selection"}
    </h4>
    <div class="lab-editor">
      {@render editor("secondary", document.secondarySql, (sql) =>
        updateSql("secondary", sql),
      )}
    </div>
  {:else if document.kind === "preaggregation"}
    <h4>Verified correlated-subquery baseline</h4>
    <pre>{baselineSql ??
        "The content loader has not supplied the baseline."}</pre>
    <p>
      The primary query is your alternative. The secondary query is this
      baseline. Neither query needs to be faster.
    </p>
  {:else if document.kind === "index"}
    <p>
      This sequence uses a disposable database. It does not change the learning
      data. Reset, cancellation, and navigation close the sandbox.
    </p>
    <h4>1. Create the index</h4>
    <div class="lab-editor">
      {@render editor("create", document.createSql, (sql) =>
        updateSql("create", sql),
      )}
    </div>
    <h4>2. Probe with the primary query</h4>
    <p>
      The lab checks the complete probe result before CREATE, after CREATE, and
      after DROP.
    </p>
    <h4>3. Drop the same index</h4>
    <div class="lab-editor">
      {@render editor("drop", document.dropSql, (sql) =>
        updateSql("drop", sql),
      )}
    </div>
  {/if}

  <div class="lab-actions">
    <button disabled={busy} onclick={onmeasure}
      >{document.kind === "index"
        ? "Run CREATE / probe / DROP"
        : "Measure current SQL"}</button
    >
    <button disabled={busy} onclick={onreset}
      >Reset measurements and sandbox</button
    >
    {#if busy}<button onclick={oncancel}>Cancel measurement</button>{/if}
  </div>
  {#if error}<p class="lab-error" role="alert">{error}</p>{/if}
  {#if busy}<p role="status">
      The engine is measuring the captured queries. Report changes do not change
      those queries.
    </p>{/if}
  {#if evidence && !evidenceCurrent}<p role="status">
      These measurements belong to earlier SQL or content. Measure the current
      queries before submission.
    </p>{/if}

  <fieldset disabled={busy}>
    <legend>Your report</legend>
    {#if document.kind === "cardinality"}
      <label
        >Complete output rows <input
          inputmode="numeric"
          value={document.report.outputRows ?? ""}
          oninput={(event) => report("outputRows", event.currentTarget.value)}
        /></label
      >
      <label
        >Sum of leaf scan rows <input
          placeholder="integer or not-reported"
          value={document.report.scanRows ?? ""}
          oninput={(event) => report("scanRows", event.currentTarget.value)}
        /></label
      >
      <p>
        Use the complete result count for output rows. If any leaf scan lacks
        operator_rows_scanned, report not-reported.
      </p>
    {:else if document.kind === "pushdown"}
      {#each ["primary", "secondary"] as slot}
        <label
          >{slot} scan filter
          <select
            value={document.report[slot as "primary" | "secondary"] ?? ""}
            onchange={(event) => report(slot, choice(event) as Reported)}
          >
            <option value="" disabled>Select a report</option><option
              value="reported">reported</option
            ><option value="not-reported">not-reported</option>
          </select>
        </label>
      {/each}
      <p>
        Report whether a scan contains Filters text. Either optimizer shape can
        pass.
      </p>
    {:else if document.kind === "index"}
      <label
        >Reported access path
        <select
          value={document.report.accessPath ?? ""}
          onchange={(event) =>
            report("accessPath", choice(event) as AccessPath)}
        >
          <option value="" disabled>Select an access path</option><option
            value="index">index</option
          ><option value="sequential">sequential</option><option
            value="not-reported">not-reported</option
          >
        </select>
      </label>
      <p>
        An index scan is not required. A complete CREATE / probe / DROP sequence
        is required.
      </p>
    {:else}
      <label
        >Lower measured median
        <select
          value={document.report.lower ?? ""}
          onchange={(event) => report("lower", choice(event) as LowerMedian)}
        >
          <option value="" disabled>Select a query</option><option
            value="primary">primary</option
          ><option value="secondary">secondary</option><option value="equal"
            >equal</option
          >
        </select>
      </label>
      <label
        >Does the median difference exceed the sum of both MADs?
        <select
          value={document.report.exceedsMad === undefined
            ? ""
            : String(document.report.exceedsMad)}
          onchange={(event) => report("exceedsMad", choice(event) === "true")}
        >
          <option value="" disabled>Select an answer</option><option
            value="true">yes</option
          ><option value="false">no</option>
        </select>
      </label>
      {#if document.kind === "selectivity"}
        <button
          disabled={!evidenceCurrent || !evidence?.timing}
          onclick={() => {
            if (
              document.kind === "selectivity" &&
              evidenceCurrent &&
              evidence?.timing
            )
              onchange({
                ...document,
                report: {
                  ...document.report,
                  primary: structuredClone(evidence.timing.primary),
                  secondary: structuredClone(evidence.timing.secondary),
                },
              });
          }}>Use the measured medians and MADs in my report</button
        >
        <p>
          Selected primary: median {document.report.primary?.median ?? "—"} ms, MAD
          {document.report.primary?.mad ?? "—"} ms.
        </p>
        <p>
          Selected secondary: median {document.report.secondary?.median ?? "—"} ms,
          MAD {document.report.secondary?.mad ?? "—"} ms.
        </p>
      {/if}
    {/if}
  </fieldset>

  {#if evidence}
    <h4>Measured evidence</h4>
    <p>
      Dataset {evidence.binding.datasetId}, variant {evidence.binding
        .variantId}. A missing optional metric is not zero.
    </p>
    {#each ["primary", "secondary"] as slot}
      {@const measurement =
        slot === "primary" ? evidence.primary : evidence.secondary}
      {#if measurement}
        <h5>{slot}: {measurement.count} complete output rows</h5>
        <div class="table-scroll">
          <table>
            <thead
              ><tr
                ><th>Scan</th><th>Table</th><th>Leaf</th><th
                  >operator_rows_scanned</th
                ><th>Access path</th><th>Filters</th></tr
              ></thead
            >
            <tbody
              >{#each measurement.profile.scans as scan}<tr>
                  <td>{scan.operator}<small>{scan.path}</small></td><td
                    >{scan.table ?? "not-reported"}</td
                  ><td>{scan.leaf ? "yes" : "no"}</td>
                  <td>{scan.rowsScanned ?? "not-reported"}</td><td
                    >{scan.accessPath}</td
                  ><td><pre>{scan.filters ?? "not-reported"}</pre></td>
                </tr>{/each}</tbody
            >
          </table>
        </div>
      {/if}
    {/each}
    {#if evidence.timing}
      <table>
        <thead
          ><tr
            ><th>Query</th><th>Median (ms)</th><th>MAD (ms)</th><th>Samples</th
            ></tr
          ></thead
        ><tbody>
          <tr
            ><th>primary</th><td>{evidence.timing.primary.median}</td><td
              >{evidence.timing.primary.mad}</td
            ><td>{evidence.timing.primary.samples.length}</td></tr
          >
          <tr
            ><th>secondary</th><td>{evidence.timing.secondary.median}</td><td
              >{evidence.timing.secondary.mad}</td
            ><td>{evidence.timing.secondary.samples.length}</td></tr
          >
        </tbody>
      </table>
      <p>
        Nine alternating pairs follow warmups. Medians and MADs describe this
        run, not a guaranteed speed difference.
      </p>
    {/if}
    {#if evidence.index}
      <p>
        Catalog indexes: before {evidence.index.before.length}, after CREATE {evidence
          .index.created.length}, after DROP {evidence.index.dropped.length}.
      </p>
      <p>
        Exact probe checks: before {evidence.index.beforePass
          ? "pass"
          : "fail"}, indexed {evidence.index.indexedPass ? "pass" : "fail"},
        after {evidence.index.afterPass ? "pass" : "fail"}.
      </p>
    {/if}
    <details>
      <summary>Content identity and SQL hashes</summary>
      <pre>{JSON.stringify(evidence.binding, null, 2)}</pre>
    </details>
  {/if}
</section>

<style>
  .plan-lab {
    display: grid;
    gap: 0.75rem;
    padding: 1rem;
  }
  h3,
  h4,
  h5,
  p {
    margin: 0;
  }
  .lab-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  fieldset {
    display: grid;
    gap: 0.75rem;
    min-width: 0;
  }
  label {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    align-items: center;
  }
  .lab-editor {
    min-height: 10rem;
    height: 12rem;
    border: 1px solid currentColor;
  }
  pre {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    margin: 0;
  }
  .table-scroll {
    overflow-x: auto;
  }
  table {
    border-collapse: collapse;
    width: 100%;
    font-size: 0.85rem;
  }
  th,
  td {
    padding: 0.4rem;
    border: 1px solid #8886;
    text-align: left;
    vertical-align: top;
  }
  small {
    display: block;
    overflow-wrap: anywhere;
  }
  .lab-error {
    color: #b42318;
  }
</style>
