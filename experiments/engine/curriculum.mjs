import { chromium } from "playwright";
import ts from "typescript";
import { readFile, writeFile, mkdir, mkdtemp, cp, rm } from "node:fs/promises";
import { dirname, resolve, extname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { assetFile, createManifest, repoRoot } from "./manifest.mjs";

const mode = process.argv.slice(2);
if (mode.length !== 1 || !["--check", "--publish"].includes(mode[0]))
  throw new Error(
    "Usage: LAB_URL=http://127.0.0.1:5174 node experiments/engine/curriculum.mjs --check|--publish",
  );
if (!process.env.LAB_URL)
  throw new Error(
    "LAB_URL is required; start the separate engine lab on port 5174.",
  );
const labUrl = new URL(process.env.LAB_URL);
if (
  !["http:", "https:"].includes(labUrl.protocol) ||
  labUrl.username ||
  labUrl.password
)
  throw new Error("LAB_URL must be an HTTP(S) lab URL without credentials.");
const EXPECTED_ENGINE = "v1.5.4";
const stringify = (value) => JSON.stringify(value, null, 2) + "\n";
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const sourceBytes = new Map();
async function bytes(url) {
  if (!sourceBytes.has(url))
    sourceBytes.set(url, await readFile(assetFile(url)));
  return sourceBytes.get(url);
}
async function text(url) {
  return (await bytes(url)).toString();
}
async function json(url) {
  return JSON.parse(await text(url));
}

// Transpile the actual application contracts in memory. --check writes no modules,
// assets, caches, or generated answers to the repository.
const moduleUrls = new Map();
async function moduleUrl(path) {
  path = resolve(path);
  if (moduleUrls.has(path)) return moduleUrls.get(path);
  const pending = (async () => {
    const source = await readFile(path, "utf8");
    const emitted = ts.transpileModule(source, {
      fileName: path,
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        verbatimModuleSyntax: false,
      },
    }).outputText;
    const tree = ts.createSourceFile(
      path + ".js",
      emitted,
      ts.ScriptTarget.ES2022,
      true,
      ts.ScriptKind.JS,
    );
    const replacements = [];
    for (const node of tree.statements) {
      if (
        !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
        !node.moduleSpecifier ||
        !ts.isStringLiteral(node.moduleSpecifier)
      )
        continue;
      const specifier = node.moduleSpecifier.text;
      const url = specifier.startsWith(".")
        ? await moduleUrl(
            resolve(
              dirname(path),
              specifier + (extname(specifier) ? "" : ".ts"),
            ),
          )
        : import.meta.resolve(specifier);
      replacements.push([
        node.moduleSpecifier.getStart(tree),
        node.moduleSpecifier.end,
        JSON.stringify(url),
      ]);
    }
    let code = emitted;
    for (const [start, end, value] of replacements.reverse())
      code = code.slice(0, start) + value + code.slice(end);
    return (
      "data:text/javascript;base64," + Buffer.from(code).toString("base64")
    );
  })();
  moduleUrls.set(path, pending);
  return pending;
}
const contracts = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/challenges.ts"))
);
const results = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/engine-results.ts"))
);
const reconciliation = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/reconciliation.ts"))
);
const diagnostics = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/engine-diagnostics.ts"))
);
const labs = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/engine-labs.ts"))
);
const profiles = await import(
  await moduleUrl(resolve(repoRoot, "src/lib/engine-profile.ts"))
);
const curriculum = await json("/bundle/curriculum.json");
if (mode[0] === "--check") contracts.validateCurriculum(curriculum);
// Publication derives summaries before strict validation so an authored index
// without generated metadata can be published. Checking never hydrates it.
assert(
  curriculum &&
    Array.isArray(curriculum.skills) &&
    Array.isArray(curriculum.datasets),
  "Curriculum skills and datasets are required.",
);
assert(
  curriculum.skills.length === 13,
  "Complete curriculum must contain thirteen skills.",
);
const definitions = [];
const datasets = new Map();
for (const entry of curriculum.datasets) {
  const dataset = contracts.validateDataset(await json(entry.path));
  assert(dataset.id === entry.id, `Dataset index mismatch: ${entry.id}`);
  datasets.set(entry.id, dataset);
}
for (const skill of curriculum.skills)
  for (const entry of skill.definitions) {
    const definition = contracts.validateChallenge(await json(entry.path));
    assert(
      definition.hints.every(
        (hint) => !definition.starterExplanation.includes(hint.text),
      ),
      `${definition.challengeId}: starter explanation must not disclose a hint.`,
    );
    assert(
      definition.challengeId === entry.challengeId &&
        definition.skillId === skill.id,
      `Challenge index mismatch: ${entry.path}`,
    );
    const dataset = datasets.get(definition.datasetId);
    assert(dataset, `Unknown dataset: ${definition.datasetId}`);
    const summary = {
      title: definition.title,
      brief: definition.brief,
      displayNumber: definition.displayNumber,
      identity: contracts.contentIdentity(definition, dataset, EXPECTED_ENGINE),
    };
    if (mode[0] === "--publish") Object.assign(entry, summary);
    else
      assert(
        entry.title === summary.title &&
          entry.brief === summary.brief &&
          entry.displayNumber === summary.displayNumber &&
          contracts.sameIdentity(entry.identity, summary.identity),
        `Published challenge summary mismatch: ${entry.challengeId}`,
      );
    for (const variant of dataset.gradingVariants) {
      assert(
        definition.expected[variant],
        `Missing expected asset: ${definition.challengeId}/${variant}`,
      );
      if (definition.assessment.kind === "reconciliation")
        assert(
          definition.assessment.truth[variant],
          `Missing truth: ${variant}`,
        );
      if (definition.assessment.secondaryReference)
        assert(
          definition.assessment.secondaryExpected?.[variant],
          `Missing secondary expected: ${variant}`,
        );
    }
    const checksUrl = `/bundle/challenges/${definition.challengeId}/checks.json`;
    const checks = await json(checksUrl);
    assert(
      Array.isArray(checks.wrong) && checks.wrong.length > 0,
      `Missing wrong-query checks: ${checksUrl}`,
    );
    for (const check of checks.wrong) {
      contracts.assetPath(check.sql);
      assert(
        check.variant === undefined ||
          dataset.gradingVariants.includes(check.variant),
        `Unknown negative-check variant: ${checksUrl}`,
      );
    }
    definitions.push({ definition, dataset, checks });
  }
contracts.validateCurriculum(curriculum);
assert(
  definitions.length === 65,
  "Complete curriculum must contain all 65 challenges.",
);
const generated = new Map();
if (mode[0] === "--publish")
  generated.set("/bundle/curriculum.json", stringify(curriculum));
const evidence = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
page.setDefaultTimeout(30_000);

async function evaluateWithin(callback, argument, deadline = 10_000) {
  let timer;
  try {
    return await Promise.race([
      page.evaluate(callback, argument),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Engine operation exceeded ${deadline} ms`)),
          deadline,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
async function query(sql, trusted = false) {
  if (!trusted) sql = diagnostics.admit(sql, "challenge");
  return evaluateWithin(async (sql) => {
    const table = await window.publicationEngine.conn.query(sql);
    const buffers = new Set();
    function retain(data) {
      if (!data) return;
      for (const view of [
        data.values,
        data.valueOffsets,
        data.nullBitmap,
        data.typeIds,
      ])
        if (view?.buffer) buffers.add(view.buffer);
      for (const child of data.children ?? []) retain(child);
      if (data.dictionary)
        for (const chunk of data.dictionary.data) retain(chunk);
    }
    for (const batch of table.batches) retain(batch.data);
    if (
      table.numRows > 100_000 ||
      [...buffers].reduce((sum, buffer) => sum + buffer.byteLength, 0) >
        32 * 1024 * 1024
    )
      throw new Error(
        "Publication result exceeds application retention limits.",
      );
    return window.publicationEncode(table);
  }, sql);
}
async function profile(sql) {
  const answer = await query(
    "EXPLAIN (ANALYZE, FORMAT JSON) " + diagnostics.admit(sql, "challenge"),
    true,
  );
  return profiles.normalizeProfile(
    labs.extractProfile({
      count: answer.rows.length,
      getRow: (index) => answer.rows[index],
    }),
  );
}
async function startDataset(dataset, variantId) {
  const variant = dataset.variants[variantId];
  const bootstrap = await Promise.all(
    variant.bootstrap.map(async (url) => ({ url, sql: await text(url) })),
  );
  const parquetAssets = new Map(
    (variant.parquet ?? []).map((entry) => [entry.table, entry]),
  );
  const parquet = await Promise.all(
    dataset.tables
      .filter((table) => parquetAssets.has(table))
      .map(async (table) => {
        const entry = parquetAssets.get(table);
        return {
          ...entry,
          data: (await bytes(entry.asset)).toString("base64"),
        };
      }),
  );
  await evaluateWithin(
    async ({ schema, bootstrap, parquet }) => {
      if (window.publicationEngine) {
        await window.publicationEngine.conn.close();
        window.publicationEngine.worker.terminate();
        window.lab.engines.length = 0;
      }
      const engine = (window.publicationEngine = await window.lab.create());
      await engine.conn.query(schema);
      for (const item of bootstrap) {
        const answer = window.publicationEncode(
          await engine.conn.query(item.sql),
        );
        if (item.url.endsWith("/invariants.sql")) {
          const column = answer.fields.findIndex(
            (field) => field.name === "violations",
          );
          if (
            column < 0 ||
            !answer.rows.length ||
            answer.rows.some((row) => row[column] !== "0")
          )
            throw new Error(
              `Dataset invariants failed: ${item.url}: ${JSON.stringify(answer.rows)}`,
            );
        }
      }
      for (const entry of parquet) {
        const name = `publication_${entry.table}.parquet`;
        await engine.db.registerFileBuffer(
          name,
          Uint8Array.from(atob(entry.data), (character) =>
            character.charCodeAt(0),
          ),
        );
        const identifier = (value) => '"' + value.replaceAll('"', '""') + '"';
        const quote = (value) => "'" + value.replaceAll("'", "''") + "'";
        try {
          const constraints = await engine.conn.query(
            `SELECT constraint_column_names,referenced_column_names FROM duckdb_constraints() WHERE schema_name='main' AND table_name=${quote(entry.table)} AND constraint_type='FOREIGN KEY' AND referenced_table=${quote(entry.table)}`,
          );
          if (!constraints.numRows) {
            await engine.conn.query(
              `INSERT INTO ${identifier(entry.table)} SELECT * FROM read_parquet(${quote(name)})`,
            );
          } else {
            const relations = Array.from(constraints, (row) => ({
              child: Array.from(row.constraint_column_names),
              parent: Array.from(row.referenced_column_names),
            }));
            const ready = relations
              .map(({ child, parent }) => {
                if (!child.length || child.length !== parent.length)
                  throw new Error(
                    "Content error: Invalid self-reference metadata.",
                  );
                return `(${child.map((column) => `s.${identifier(column)} IS NULL`).join(" OR ")} OR EXISTS (SELECT 1 FROM ${identifier(entry.table)} p WHERE ${child.map((column, index) => `p.${identifier(parent[index])}=s.${identifier(column)}`).join(" AND ")}))`;
              })
              .join(" AND ");
            await engine.conn.query(
              `CREATE TEMP TABLE "__load_pending" AS SELECT row_number() OVER () AS "__load_row", * FROM read_parquet(${quote(name)})`,
            );
            for (;;) {
              const pending = await engine.conn.query(
                'SELECT count(*) FROM "__load_pending"',
              );
              if (BigInt(pending.getChildAt(0).get(0)) === 0n) break;
              await engine.conn.query(
                `CREATE TEMP TABLE "__load_ready" AS SELECT s.* FROM "__load_pending" s WHERE ${ready}`,
              );
              const count = await engine.conn.query(
                'SELECT count(*) FROM "__load_ready"',
              );
              if (BigInt(count.getChildAt(0).get(0)) === 0n)
                throw new Error(
                  `Content error: Unresolvable foreign-key dependency in ${entry.table}.`,
                );
              await engine.conn.query(
                `INSERT INTO ${identifier(entry.table)} SELECT * EXCLUDE ("__load_row") FROM "__load_ready"`,
              );
              await engine.conn.query(
                'DELETE FROM "__load_pending" WHERE "__load_row" IN (SELECT "__load_row" FROM "__load_ready"); DROP TABLE "__load_ready"',
              );
            }
            await engine.conn.query('DROP TABLE "__load_pending"');
          }
        } finally {
          await engine.db.dropFile(name);
        }
      }
      await engine.conn.query(
        "SET autoload_known_extensions=false; SET autoinstall_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true",
      );
    },
    { schema: await text(dataset.schema), bootstrap, parquet },
    30_000,
  );
  // Commerce snapshots use the unchanged invariant contract, including parquet.
  if (dataset.id === "commerce-ranking") {
    const invariant = await query(await text("/bundle/invariants.sql"));
    const column = invariant.fields.findIndex(
      (field) => field.name === "violations",
    );
    assert(
      column >= 0 &&
        invariant.rows.length > 0 &&
        invariant.rows.every((row) => row[column] === "0"),
      `${dataset.id}/${variantId}: invariant failure`,
    );
  }
}
function envelope(answer, definition, dataset, variantId) {
  return {
    formatVersion: "typed-result-v1",
    identity: contracts.contentIdentity(definition, dataset, EXPECTED_ENGINE),
    datasetId: dataset.id,
    variantId,
    columns: definition.output.columns,
    complete: true,
    rowCount: answer.rows.length,
    rows: answer.rows,
  };
}
function validatedAsset(input, definition, dataset, variantId) {
  return results.validateExpected(input, definition.output, {
    identity: contracts.contentIdentity(definition, dataset, EXPECTED_ENGINE),
    datasetId: dataset.id,
    variantId,
  });
}
function requireMatch(expected, actual, definition, label) {
  const comparison = results.compare(expected, actual, definition.output);
  assert(
    comparison.pass,
    `${label}: ${comparison.reason ?? "result mismatch"}`,
  );
}
async function checkExpected(
  answer,
  url,
  definition,
  dataset,
  variantId,
  boundary,
) {
  const encoded = envelope(answer, definition, dataset, variantId);
  const validated = validatedAsset(encoded, definition, dataset, variantId);
  requireMatch(
    validated,
    answer,
    definition,
    `${definition.challengeId}/${variantId}: reference output contract`,
  );
  if (boundary) {
    const independent = validatedAsset(
      await json(url),
      definition,
      dataset,
      variantId,
    );
    if (definition.assessment.kind !== "reconciliation")
      requireMatch(
        independent,
        answer,
        definition,
        `${definition.challengeId}/${variantId}: independent boundary`,
      );
    else {
      const truth = reconciliation.validateReconciliationTruth(
        await json(definition.assessment.truth[variantId]),
      );
      assert(
        reconciliation.assessReconciliation(independent, truth).pass,
        `${definition.challengeId}: independent capstone answer fails rubric`,
      );
    }
  } else {
    const value = stringify(encoded);
    assert(
      !generated.has(url) || generated.get(url) === value,
      `Conflicting generated asset: ${url}`,
    );
    generated.set(url, value);
  }
}
async function checkIndexSequence(checks, expected, definition) {
  assert(
    checks.indexSequence &&
      ["create", "probe", "drop"].every(
        (key) => typeof checks.indexSequence[key] === "string",
      ),
    "Index lab requires create/probe/drop publication sequence.",
  );
  const catalogSql =
    "SELECT index_name, table_name, is_unique, expressions FROM duckdb_indexes() ORDER BY index_name";
  assert(
    (await query(catalogSql)).rows.length === 0,
    "Index sandbox was not initially empty.",
  );
  requireMatch(
    expected,
    await query(await text(checks.indexSequence.probe)),
    definition,
    "Index probe before CREATE",
  );
  const create = labs.admitIndexCommand(
    await text(checks.indexSequence.create),
    "create",
  );
  await query(create.sql, true);
  const indexes = await query(catalogSql);
  assert(
    indexes.rows.length === 1 &&
      indexes.rows[0][1] === "lookup_orders" &&
      indexes.rows[0][2] === "false" &&
      indexes.rows[0][3].replace(/[\[\]"'\s]/g, "") === "customer_id",
    "CREATE must produce one nonunique customer_id index on lookup_orders.",
  );
  requireMatch(
    expected,
    await query(await text(checks.indexSequence.probe)),
    definition,
    "Index probe after CREATE",
  );
  await profile(await text(checks.indexSequence.probe));
  const drop = labs.admitIndexCommand(
    await text(checks.indexSequence.drop),
    "drop",
    create.indexName,
  );
  await query(drop.sql, true);
  assert(
    (await query(catalogSql)).rows.length === 0,
    "DROP did not remove the sandbox index.",
  );
  requireMatch(
    expected,
    await query(await text(checks.indexSequence.probe)),
    definition,
    "Index probe after DROP",
  );
}
try {
  await page.goto(labUrl.href);
  await page.waitForFunction(() => window.lab?.ready, { timeout: 120_000 });
  await page.evaluate(async () => {
    window.publicationEncode = (await import("/compare.js")).encode;
  });
  const version = await page.evaluate(async () =>
    (await window.lab.engine.conn.query("SELECT version() AS version"))
      .getChildAt(0)
      .get(0),
  );
  assert(
    version === EXPECTED_ENGINE,
    `Wrong lab engine: expected ${EXPECTED_ENGINE}, got ${version}`,
  );
  await page.evaluate(() => {
    window.lab.engine.worker.terminate();
    window.lab.engines.length = 0;
  });
  for (const { definition, dataset, checks } of definitions) {
    const boundary = dataset.gradingVariants.find((id) =>
      /^boundary(?:-|$)/.test(id),
    );
    assert(
      boundary,
      `${dataset.id}: explicit boundary grading variant is required.`,
    );
    const referenceSql = await text(definition.reference);
    let starterRejected = false;
    const wrongRejected = new Set();
    if (definition.assessment.kind === "reconciliation") {
      assert(
        Array.isArray(checks.policies) && new Set(checks.policies).size >= 2,
        "Capstone requires two different policy assets.",
      );
      assert(
        new Set(await Promise.all(checks.policies.map(text))).size >= 2,
        "Capstone policy SQL must differ.",
      );
      assert(
        checks.wrong.length >= 4,
        "Capstone requires all four negative policy checks.",
      );
    }
    for (const variantId of dataset.gradingVariants) {
      const label = `${definition.challengeId}/${variantId}`;
      await startDataset(dataset, variantId);
      const reference = await query(referenceSql);
      await checkExpected(
        reference,
        definition.expected[variantId],
        definition,
        dataset,
        variantId,
        variantId === boundary,
      );
      if (definition.challengeId === "window.03") {
        assert(
          reference.rows.length === (variantId === boundary ? 9 : 36),
          `${label}: ranking row count changed.`,
        );
        if (variantId === boundary) {
          const original = await json("/bundle/expected-07.json");
          requireMatch(
            { fields: reference.fields, rows: original.rows },
            reference,
            definition,
            "Original ranking boundary",
          );
        }
      }
      const truth =
        definition.assessment.kind === "reconciliation"
          ? reconciliation.validateReconciliationTruth(
              await json(definition.assessment.truth[variantId]),
            )
          : undefined;
      const passes = (answer) =>
        truth
          ? reconciliation.assessReconciliation(answer, truth).pass
          : results.compare(reference, answer, definition.output).pass;
      assert(passes(reference), `${label}: reference assessment failed.`);
      // A starter must execute successfully and be incomplete, not merely malformed.
      if (!passes(await query(definition.starterSql))) starterRejected = true;
      for (const [index, check] of checks.wrong.entries())
        if ((check.variant ?? boundary) === variantId) {
          assert(
            !passes(await query(await text(check.sql))),
            `${label}: wrong query was accepted: ${check.sql}`,
          );
          wrongRejected.add(index);
        }
      if (definition.assessment.secondaryReference) {
        const secondary = await query(
          await text(definition.assessment.secondaryReference),
        );
        await checkExpected(
          secondary,
          definition.assessment.secondaryExpected[variantId],
          definition,
          dataset,
          variantId,
          variantId === boundary,
        );
        if (definition.assessment.kind === "plan-lab")
          await profile(await text(definition.assessment.secondaryReference));
      }
      if (truth)
        for (const policy of checks.policies) {
          const answer = await query(await text(policy));
          const validated = validatedAsset(
            envelope(answer, definition, dataset, variantId),
            definition,
            dataset,
            variantId,
          );
          requireMatch(
            validated,
            answer,
            definition,
            `${label}: policy contract`,
          );
          assert(passes(answer), `${label}: capstone policy failed: ${policy}`);
        }
      if (
        definition.assessment.kind === "plan-lab" &&
        definition.assessment.lab === "index"
      )
        await checkIndexSequence(checks, reference, definition);
      if (definition.assessment.kind === "plan-lab")
        await profile(referenceSql);
      evidence.push({
        challengeId: definition.challengeId,
        datasetId: dataset.id,
        variantId,
        rows: reference.rows.length,
        pass: true,
      });
      console.log(`PASS ${label} (${reference.rows.length} reference rows)`);
    }
    assert(
      starterRejected,
      `${definition.challengeId}: starter passes every grading variant.`,
    );
    assert(
      wrongRejected.size === checks.wrong.length,
      `${definition.challengeId}: not all negative checks ran.`,
    );
  }
} finally {
  await browser.close();
}

// Check all recursively referenced files, including generated outputs, only after
// every SQL and assessment check succeeds. Recheck inputs before committing.
const manifest = await createManifest({
  overrides: new Map([...sourceBytes, ...generated]),
});
for (const [url, original] of sourceBytes)
  assert(
    original.equals(await readFile(assetFile(url))),
    `Authored input changed during verification: ${url}`,
  );
if (mode[0] === "--publish") {
  assert(
    process.platform === "linux",
    "Atomic publication requires Linux renameat2(RENAME_EXCHANGE); no non-atomic fallback is permitted.",
  );
  const stage = await mkdtemp(resolve(repoRoot, ".curriculum-publication-"));
  try {
    const stagedReadiness = resolve(stage, "readiness");
    await cp(resolve(repoRoot, "readiness"), stagedReadiness, {
      recursive: true,
    });
    for (const [url, content] of sourceBytes) {
      const destination = url.startsWith("/bundle/")
        ? resolve(stagedReadiness, url.slice(8))
        : url.startsWith("/data/")
          ? resolve(stagedReadiness, url.slice(1))
          : undefined;
      if (!destination) continue;
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    for (const [url, content] of generated) {
      assert(
        url.startsWith("/bundle/"),
        `Generated output is not a bundle asset: ${url}`,
      );
      const destination = resolve(stagedReadiness, url.slice(8));
      await mkdir(dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    await writeFile(
      resolve(stagedReadiness, "manifest.json"),
      stringify(manifest),
    );
    // Exchange complete directories in one syscall: readers never observe a
    // mixture of new expected answers, old catalog, and old manifest.
    await promisify(execFile)("python3", [
      "-c",
      "import ctypes,os,sys\nlibc=ctypes.CDLL(None,use_errno=True)\nif libc.renameat2(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),2)!=0:\n raise OSError(ctypes.get_errno(),os.strerror(ctypes.get_errno()))",
      resolve(repoRoot, "readiness"),
      stagedReadiness,
    ]);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}
console.log(
  JSON.stringify({
    mode: mode[0],
    challenges: definitions.length,
    variants: evidence.length,
    generatedAssets: generated.size,
    manifestFiles: manifest.files.length,
    published: mode[0] === "--publish",
  }),
);
