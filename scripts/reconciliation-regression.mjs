import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { assessReconciliation, validateReconciliationTruth } =
    await server.ssrLoadModule("/src/lib/reconciliation.ts");
  const truth = validateReconciliationTruth(
    JSON.parse(
      await readFile(
        new URL(
          "../readiness/datasets/reconciliation/truth-boundary-v1.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
  const fields = [
    { name: "ref_id", type: "Int64" },
    { name: "partner_ids", type: "Utf8" },
    { name: "confidence", type: "Utf8" },
    { name: "score", type: "Decimal[5e+4]", precision: 5, scale: 4 },
    { name: "explanation", type: "Utf8" },
  ];
  const groups = new Map(truth.groups.map((group) => [group.key, group]));
  const answer = {
    fields,
    complete: true,
    rows: truth.references.map((ref) => [
      ref.refId,
      JSON.stringify(groups.get(ref.groupKey)?.partnerIds ?? []),
      ref.status === "determinate" ? "probable" : ref.status,
      "0.8500",
      "Evidence supports this classification.",
    ]),
  };
  const assess = (rows) => assessReconciliation({ ...answer, rows }, truth);
  const perfect = assess(answer.rows);
  assert.equal(perfect.pass, true);
  assert.equal(
    perfect.metrics.highConfidencePrecision,
    null,
    "no high commitments is not 100% high precision",
  );
  assert.equal(perfect.metrics.determinateRecall, 1);
  assert.ok(
    perfect.metrics.committedCoverage < 1,
    "coverage denominator includes ambiguous and missing references",
  );
  const mutate = (fn) => {
    const rows = structuredClone(answer.rows);
    fn(rows);
    return assess(rows);
  };
  assert.equal(
    mutate((rows) =>
      rows.forEach((row) => {
        row[1] = "[]";
        row[2] = "missing";
      }),
    ).pass,
    false,
    "all missing cannot pass",
  );
  assert.equal(
    assessReconciliation({ ...answer, complete: false }, truth).pass,
    false,
    "incomplete never passes",
  );
  const split = truth.groups.find((group) => group.family === "split");
  const rollup = truth.groups.find((group) => group.family === "rollup");
  const singleton = truth.groups.find((group) => group.family === "singleton");
  const rowIndex = (id) => answer.rows.findIndex((row) => row[0] === id);
  const partialSplit = mutate(
    (rows) =>
      (rows[rowIndex(split.refIds[0])][1] = JSON.stringify(
        split.partnerIds.slice(0, 1),
      )),
  );
  assert.equal(
    partialSplit.metrics.recoveredSplitGroups,
    0,
    "partial split links earn no group credit",
  );
  assert.equal(partialSplit.pass, false);
  const partialRollup = mutate((rows) => {
    const row = rows[rowIndex(rollup.refIds[0])];
    row[1] = "[]";
    row[2] = "ambiguous";
  });
  assert.equal(
    partialRollup.metrics.recoveredRollupGroups,
    0,
    "partial rollup cannot credit remaining reference",
  );
  assert.equal(partialRollup.pass, false);
  const reuse = mutate(
    (rows) =>
      (rows[rowIndex(singleton.refIds[0])][1] = JSON.stringify(
        split.partnerIds,
      )),
  );
  assert.equal(reuse.pass, false, "many-to-many component is forbidden");
  assert.equal(
    reuse.metrics.recoveredSplitGroups,
    0,
    "greedy partner reuse invalidates entire connected group",
  );
  const ambiguous = truth.references.find((ref) => ref.status === "ambiguous");
  const arbitrary = mutate((rows) => {
    const row = rows[rowIndex(ambiguous.refId)];
    row[1] = JSON.stringify(singleton.partnerIds);
    row[2] = "high";
  });
  assert.equal(arbitrary.pass, false);
  assert.ok(arbitrary.metrics.incorrectHigh > 0);
  assert.equal(
    mutate(
      (rows) =>
        (rows[rowIndex(singleton.refIds[0])][1] = JSON.stringify(
          singleton.partnerIds.map(Number),
        )),
    ).pass,
    false,
    "numeric JSON IDs cannot pass even if small",
  );
  assert.equal(
    mutate(
      (rows) =>
        (rows[rowIndex(singleton.refIds[0])][1] = JSON.stringify([
          ...singleton.partnerIds,
          ...singleton.partnerIds,
        ])),
    ).pass,
    false,
    "duplicate IDs rejected",
  );
  assert.equal(
    mutate((rows) => (rows[0][4] = "")).pass,
    false,
    "empty explanations rejected",
  );
  assert.equal(
    mutate((rows) => (rows[0][3] = "1.0001")).pass,
    false,
    "score out of range rejected",
  );
  for (const [alias, canonical] of Object.entries(truth.replayAliases)) {
    const group = truth.groups.find((group) =>
      group.partnerIds.includes(canonical),
    );
    if (group)
      assert.equal(
        mutate((rows) => {
          const row = rows[rowIndex(group.refIds[0])];
          row[1] = JSON.stringify(
            group.partnerIds.map((id) => (id === canonical ? alias : id)),
          );
        }).pass,
        true,
        "physical replay aliases canonicalize inside assessor",
      );
  }
  console.log(
    "PASS capstone whole groups, thresholds, ambiguity, replay aliases, exact IDs, and incomplete outcomes",
  );
} finally {
  await server.close();
}
