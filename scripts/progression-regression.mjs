import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../", import.meta.url)),
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { deriveProgression } = await server.ssrLoadModule(
    "/src/lib/progression.ts",
  );
  const {
    validateCurriculum,
    validateChallenge,
    validateDataset,
    validateOutput,
  } = await server.ssrLoadModule("/src/lib/challenges.ts");
  const { normalizeProfile } = await server.ssrLoadModule(
    "/src/lib/engine-profile.ts",
  );
  const {
    scanRows,
    evidenceMatches,
    labBinding,
    validateLabEvidence,
    admitIndexCommand,
    accessPath,
  } = await server.ssrLoadModule("/src/lib/engine-labs.ts");
  for (const sql of [
    "CREATE UNIQUE INDEX learner ON lookup_orders(customer_id);",
    "CREATE INDEX learner ON lookup_orders(order_id);",
    "CREATE INDEX learner ON orders(customer_id);",
    "CREATE INDEX learner ON lookup_orders(customer_id); DROP TABLE lookup_orders;",
  ]) {
    assert.throws(() => admitIndexCommand(sql, "create"));
  }
  assert.throws(() =>
    admitIndexCommand("DROP INDEX another_index;", "drop", "learner"),
  );
  const identity = (id) => ({
    challengeId: id,
    bundleVersion: "bundle-v1",
    challengeVersion: "v1",
    datasetVersion: "data-v1",
    assessmentVersion: "exact-v1",
    engineVersion: "v1.5.4",
  });
  const skills = ["a", "b"].map((id, i) => ({
    id,
    label: id,
    brief: id,
    requires: i ? ["a"] : [],
    x: 0,
    y: 0,
    requiredChallengeIds: Array.from({ length: 5 }, (_, j) => `${id}.${j + 1}`),
    definitions: Array.from({ length: 5 }, (_, j) => ({
      challengeId: `${id}.${j + 1}`,
      path: `/bundle/${id}.${j + 1}.json`,
      title: `${id}.${j + 1}`,
      brief: `Exercise ${id}.${j + 1}`,
      displayNumber: `${id}.${j + 1}`,
      identity: identity(`${id}.${j + 1}`),
    })),
  }));
  const curriculum = {
    version: "v1",
    skills,
    datasets: [{ id: "d", path: "/bundle/d.json" }],
  };
  validateCurriculum(curriculum);
  const identities = Object.fromEntries(
    skills
      .flatMap((s) => s.requiredChallengeIds)
      .map((id) => [id, identity(id)]),
  );
  const attempts = skills[0].requiredChallengeIds.map((id, i) => ({
    id: String(i),
    challenge: identities[id],
    outcome: "complete",
    correctness: "correct",
  }));
  const partialIdentities = { ...identities };
  delete partialIdentities["a.1"];
  assert.throws(
    () => deriveProgression(curriculum, partialIdentities, attempts, []),
    "unavailable current identity must not downgrade an earned pass",
  );
  assert.equal(
    deriveProgression(curriculum, identities, attempts.slice(0, 4), []).skills.b
      .accessible,
    false,
    "four objectives cannot unlock a dependent",
  );
  assert.equal(
    deriveProgression(curriculum, identities, attempts, []).skills.b.available,
    true,
    "all five current objectives unlock",
  );
  attempts.push({ ...attempts[0], id: "later", correctness: "incorrect" });
  assert.equal(
    deriveProgression(curriculum, identities, attempts, []).skills.a.completed,
    true,
    "later incorrect attempt cannot erase pass",
  );
  attempts[0].deletedAt = 1;
  let state = deriveProgression(curriculum, identities, attempts, ["b"]);
  assert.equal(state.skills.b.available, false);
  assert.equal(state.skills.b.accessible, true);
  assert.equal(state.skills.b.state, "needs-review");
  assert.equal(state.skills.a.nextChallengeId, "a.1");
  delete attempts[0].deletedAt;
  for (const key of Object.keys(identities["a.1"])) {
    const changed = structuredClone(identities);
    changed["a.1"][key] += "-new";
    state = deriveProgression(curriculum, changed, attempts, ["a", "b"]);
    assert.equal(
      state.skills.a.completed,
      false,
      `identity ${key} invalidates current completion`,
    );
    assert.equal(state.challenges["a.1"].state, "needs-review");
    assert.equal(state.skills.b.accessible, true);
  }
  for (const outcome of [
    "cancelled",
    "timeout",
    "result-limit",
    "engine-error",
  ]) {
    const incomplete = structuredClone(attempts);
    incomplete[0].outcome = outcome;
    assert.equal(
      deriveProgression(curriculum, identities, incomplete, []).skills.a
        .completed,
      false,
    );
  }
  const cycle = structuredClone(curriculum);
  cycle.skills[0].requires = ["b"];
  assert.throws(() => validateCurriculum(cycle));
  const unknown = structuredClone(curriculum);
  unknown.skills[0].requires = ["missing"];
  assert.throws(() => validateCurriculum(unknown));
  const duplicate = structuredClone(curriculum);
  duplicate.skills[1].definitions[0] = duplicate.skills[0].definitions[0];
  assert.throws(() => validateCurriculum(duplicate));
  const incompleteSummary = structuredClone(curriculum);
  delete incompleteSummary.skills[0].definitions[0].identity;
  assert.throws(() => validateCurriculum(incompleteSummary));
  const mismatchedSummary = structuredClone(curriculum);
  mismatchedSummary.skills[0].definitions[0].identity.challengeId = "b.1";
  assert.throws(() => validateCurriculum(mismatchedSummary));
  assert.throws(() =>
    validateOutput({
      columns: [
        { name: "x", type: "DECIMAL", precision: 4, scale: 5, nullable: false },
      ],
      ordering: [],
    }),
  );
  assert.throws(() =>
    validateDataset({
      id: "x",
      version: "v1",
      tables: ["x"],
      schema: "/bundle/x.sql",
      previewVariant: "boundary",
      gradingVariants: [],
      variants: { boundary: { bootstrap: [] } },
    }),
  );
  const raw = {
    children: [
      {
        operator_name: "SEQ_SCAN",
        operator_cardinality: 10,
        extra_info: { Table: "orders", Filters: "x=1" },
        children: [],
      },
    ],
  };
  const missing = normalizeProfile(raw);
  assert.equal(
    scanRows(missing),
    "not-reported",
    "operator cardinality cannot stand in for scanned rows",
  );
  raw.children[0].operator_rows_scanned = 100;
  const present = normalizeProfile(raw);
  assert.equal(scanRows(present), "100");
  assert.throws(() => normalizeProfile({}), "missing profiles are errors");
  const qualifiedIndex = normalizeProfile({
    children: [
      {
        ...raw.children[0],
        extra_info: { Table: "memory.main.lookup_orders", Type: "Index Scan" },
      },
    ],
  });
  assert.equal(accessPath(qualifiedIndex), "index");
  assert.equal(
    accessPath({
      ...qualifiedIndex,
      scans: qualifiedIndex.scans.map((scan) => ({
        ...scan,
        table: "memory.main.not_lookup_orders",
      })),
    }),
    "not-reported",
  );
  const request = {
    identity: identity("plan.01"),
    datasetId: "d",
    previewVariant: "boundary",
    gradingVariants: ["boundary"],
    sql: "SELECT 1",
    document: {
      kind: "cardinality",
      report: { outputRows: "1", scanRows: "100" },
    },
  };
  const binding = await labBinding(request);
  const evidence = {
    kind: "cardinality",
    binding,
    fixtures: [{ variantId: "boundary", slot: "primary", pass: true }],
    primary: { count: 1, profile: present },
  };
  assert.equal(await evidenceMatches(request, evidence), true);
  assert.equal(
    await evidenceMatches({ ...request, sql: "SELECT 2" }, evidence),
    false,
    "SQL edits invalidate evidence",
  );
  assert.equal(
    await evidenceMatches(
      {
        ...request,
        document: { ...request.document, report: { outputRows: "2" } },
      },
      evidence,
    ),
    true,
    "answer edits retain unchanged measurements",
  );
  assert.equal((await validateLabEvidence(request, evidence)).pass, true);
  assert.equal(
    (
      await validateLabEvidence(
        {
          ...request,
          document: {
            ...request.document,
            report: { outputRows: "0", scanRows: "100" },
          },
        },
        evidence,
      )
    ).pass,
    false,
    "EXPLAIN wrapper row count does not replace actual output count",
  );
  const absentEvidence = {
    ...evidence,
    primary: { count: 1, profile: missing },
  };
  assert.equal(
    (
      await validateLabEvidence(
        {
          ...request,
          document: {
            ...request.document,
            report: { outputRows: "1", scanRows: "not-reported" },
          },
        },
        absentEvidence,
      )
    ).pass,
    true,
    "a successful profile may legitimately omit scan metrics",
  );
  assert.equal(
    (await validateLabEvidence(request, { ...evidence, fixtures: [] })).pass,
    false,
    "missing grading variant cannot pass",
  );
  console.log(
    "PASS progression identities, deletion/review, catalog rejection, and profile/evidence boundaries",
  );
} finally {
  await server.close();
}
