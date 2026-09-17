import * as duckdb from "@duckdb/duckdb-wasm";
import type { RecordBatch } from "apache-arrow";
import {
  formatCount,
  type EngineState,
  type ParseResult,
  type RunRequest,
  type ProfileSummary,
  type RunResult,
  type SchemaReference,
  type SchemaTable,
} from "./types";
import {
  admit,
  AdmissionFailure,
  analyze,
  scanDiagnostics,
} from "./engine-diagnostics";
import {
  ArrowResult,
  batchBuffers,
  compare,
  EngineFailure,
  MAX_BYTES,
  MAX_ROWS,
  validateExpected,
} from "./engine-results";
import {
  assetUrl,
  sameIdentity,
  type ChallengeCatalog,
  type DatasetDefinition,
  type LoadedChallenge,
} from "./challenges";
import {
  runLab,
  validateLabEvidence,
  extractProfile,
  admitIndexCommand,
  type LabHost,
  type LabRequest,
  type IndexCatalogEntry,
} from "./engine-labs";
import { normalizeProfile } from "./engine-profile";
import {
  assessReconciliation,
  validateReconciliationTruth,
  type ReconciliationAssessment,
} from "./reconciliation";

// Manifest keys: verified and hashed as root-absolute paths. assetUrl() turns a
// key into a fetchable URL, which differs under a subpath deployment.
const WORKER = "/engine/duckdb-browser-eh.worker.js";
const WASM = "/engine/duckdb-eh.wasm";
const EXTENSIONS = ["icu", "json", "parquet"].map(
  (name) => `/extensions/v1.5.4/wasm_eh/${name}.duckdb_extension.wasm`,
);
const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';
// A DuckDB constraint row. Only the fields readSchema selects are described.
type ConstraintRow = {
  constraint_type?: unknown;
  constraint_text?: unknown;
  constraint_column_names?: unknown;
  referenced_table?: unknown;
  referenced_column_names?: unknown;
};
const nameList = (value: unknown) =>
  Array.from((value ?? []) as Iterable<string>, String);
// constraint_text is empty for a self-referencing foreign key, so the
// structured columns supply the label DuckDB omits.
function constraintLabel(constraint: ConstraintRow): string {
  const text = String(constraint.constraint_text ?? "");
  if (text) return text;
  const locals = nameList(constraint.constraint_column_names);
  const target = String(constraint.referenced_table ?? "");
  const targets = nameList(constraint.referenced_column_names);
  if (
    constraint.constraint_type !== "FOREIGN KEY" ||
    !target ||
    !locals.length ||
    !targets.length
  )
    return text;
  return `FOREIGN KEY (${locals.join(", ")}) REFERENCES ${target}(${targets.join(", ")})`;
}

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  try {
    const detail = JSON.parse(raw);
    if (!detail || typeof detail !== "object") return raw;
    const message = detail.exception_message ?? detail.error_message;
    if (typeof message !== "string" || !message.trim()) return raw;
    const type = detail.exception_type ?? detail.error_type;
    if (typeof type !== "string" || !type.trim()) return message;
    const label = `${type[0].toUpperCase()}${type.slice(1)} Error:`;
    return message.toLowerCase().startsWith(label.toLowerCase())
      ? message
      : `${label} ${message}`;
  } catch {
    return raw;
  }
}

interface Context {
  catalog: ChallengeCatalog;
  dataset: DatasetDefinition;
}
interface Selection {
  catalog: ChallengeCatalog;
  datasetId: string;
}
// A DuckDB open() call is the engine's unit of isolation: it discards the
// previous database instance entirely — base tables, temp tables, macros, the
// configuration lock and even TimeZone all return to defaults. That is what
// lets a worker be reused without weakening the fresh-snapshot guarantee.
const OPEN_OPTIONS: duckdb.DuckDBConfig = {
  maximumThreads: 1,
  query: {
    castBigIntToDouble: false,
    castDecimalToDouble: false,
    castTimestampToDate: false,
  },
};
// Instantiating a worker costs ~600ms (755 KB of JS plus a 35 MB wasm module)
// against ~13ms to reopen one, and grading creates a slot per variant in
// series. Three is the high-water mark of simultaneously live slots: a
// preview, a parser and a per-variant snapshot.
const POOL_MAX = 3;
interface Host {
  db: duckdb.AsyncDuckDB;
  worker: Worker;
}
interface Slot extends Host {
  conn?: duckdb.AsyncDuckDBConnection;
  dead: boolean;
  /** Set when the worker itself failed, which makes the host unreusable. */
  failed: boolean;
  /** The work that owns this slot; a cancelled work may still be executing. */
  work: Work;
  /** Worker listeners bound to this slot, removed before the host is pooled. */
  listeners: [string, EventListener][];
  failure: Promise<never>;
  reject: (error: Error) => void;
}
interface Objects {
  views: { name: string; definition: string }[];
  macros: { name: string; definition: string }[];
  indexes: { name: string; definition: string }[];
}

class Work {
  readonly slots = new Set<Slot>();
  readonly stopped: Promise<never>;
  reason?: EngineFailure;
  sqlElapsedMs = 0;
  private reject: (error: EngineFailure) => void;
  private grace?: number;
  constructor(
    private readonly terminate: (slot: Slot) => void,
    private readonly state: (state: EngineState, message?: string) => void,
  ) {
    const { promise, reject } = Promise.withResolvers<never>();
    this.stopped = promise;
    this.reject = reject;
    void this.stopped.catch(() => {});
  }
  async wait<T>(promise: Promise<T>, slot?: Slot): Promise<T> {
    if (this.reason) throw this.reason;
    const value = await Promise.race([
      promise,
      this.stopped,
      ...(slot ? [slot.failure] : []),
    ]);
    if (this.reason) throw this.reason;
    return value;
  }
  async deadline<T>(
    duration: number,
    label: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const timer = window.setTimeout(
      () => this.cancel(new EngineFailure("timeout", label)),
      duration,
    );
    try {
      return await this.wait(operation());
    } finally {
      clearTimeout(timer);
    }
  }
  cancel(
    error = new EngineFailure(
      "cancelled",
      "Run cancelled. No partial result was graded.",
    ),
  ): void {
    if (this.reason) return;
    this.reason = error;
    this.state("cancelling", error.message);
    for (const slot of this.slots)
      if (slot.conn && !slot.dead) void slot.conn.cancelSent().catch(() => {});
    this.grace = window.setTimeout(() => {
      for (const slot of this.slots) this.terminate(slot);
      this.reject(error);
    }, 1500);
  }
  finish(): void {
    clearTimeout(this.grace);
  }
  dispose(): void {
    this.reason ??= new EngineFailure("cancelled", "Engine disposed.");
    for (const slot of this.slots) this.terminate(slot);
    this.reject(this.reason);
    this.finish();
  }
}

export class EngineCoordinator {
  private readonly slots = new Set<Slot>();
  private parser?: Slot;
  private parserCatalog?: ChallengeCatalog;
  private sandbox?: Slot;
  private selection?: Selection;
  private ready?: Promise<SchemaTable[]>;
  private initializingWork?: Work;
  private active?: Work;
  private indexWork?: Work;
  private navigation = 0;
  private parserQueue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  /** Instantiated workers with no open database, ready to be reopened. */
  private readonly pool: Host[] = [];
  /** Slots on their way into the pool, counted against POOL_MAX. */
  private recycling = 0;
  private readonly background = new Set<Work>();

  constructor(
    private readonly onState: (state: EngineState, message?: string) => void,
  ) {}

  /**
   * Retire a slot. A slot that finished cleanly hands its worker back to the
   * warm pool; anything else is destroyed. Cancellation and worker failure
   * both fall through to destruction, because a cancelled query may still be
   * executing inside the worker and a failed worker cannot be trusted to
   * reset. Every call site retires slots through here, so the safe path is
   * the default and reuse is the exception that has to earn itself.
   */
  private terminate = (slot: Slot): void => {
    if (slot.dead) return;
    if (
      slot.failed ||
      slot.work.reason ||
      this.disposed ||
      this.pool.length + this.recycling >= POOL_MAX
    ) {
      this.discard(slot);
      return;
    }
    this.release(slot);
  };

  private discard = (slot: Slot): void => {
    if (slot.dead) return;
    this.detach(slot);
    // DuckDB's pending library requests need not settle after worker termination.
    // Every host await also races our own rejection promise.
    slot.reject(
      new EngineFailure(
        "engine-error",
        "The SQL worker stopped. Run again to restore a fresh snapshot.",
      ),
    );
    slot.worker.terminate();
    slot.db.detach();
  };

  /** Unbind a slot from the coordinator without touching its worker. */
  private detach(slot: Slot): void {
    slot.dead = true;
    for (const [type, listener] of slot.listeners)
      slot.worker.removeEventListener(type, listener);
    slot.listeners.length = 0;
    this.slots.delete(slot);
    if (this.parser === slot) this.parser = undefined;
    if (this.sandbox === slot) this.sandbox = undefined;
  }

  /**
   * Return a clean slot's worker to the pool. Closing the connection is the
   * only teardown needed: the next acquisition opens a new database instance,
   * which is the same reset a cold worker gets. A close that hangs or throws
   * leaves the worker in an unknown state, so it is destroyed instead.
   */
  private release(slot: Slot): void {
    const { conn } = slot;
    this.detach(slot);
    this.recycling++;
    void (async () => {
      const { promise: expired, reject: expire } =
        Promise.withResolvers<never>();
      void expired.catch(() => {});
      const timer = window.setTimeout(
        () => expire(new Error("Connection close timed out.")),
        2000,
      );
      try {
        await Promise.race([conn?.close() ?? Promise.resolve(), expired]);
        if (this.disposed || this.pool.length >= POOL_MAX)
          throw new Error("Pool is closed.");
        this.pool.push({ db: slot.db, worker: slot.worker });
      } catch {
        slot.worker.terminate();
        slot.db.detach();
      } finally {
        clearTimeout(timer);
        this.recycling--;
      }
    })();
  }

  private newWork(visible = true): Work {
    if (this.disposed)
      throw new EngineFailure(
        "engine-error",
        "The engine is disposed. Reload the application.",
      );
    return new Work(this.terminate, visible ? this.onState : () => {});
  }

  async configure(
    catalog: ChallengeCatalog,
    datasetId: string,
  ): Promise<SchemaTable[]> {
    if (this.disposed) throw new Error("Engine disposed.");
    this.navigation++;
    this.indexWork?.cancel();
    if (this.sandbox) {
      this.active?.cancel();
      this.terminate(this.sandbox);
    }
    if (
      this.selection?.catalog !== catalog ||
      this.selection.datasetId !== datasetId
    ) {
      this.initializingWork?.dispose();
      this.selection = { catalog, datasetId };
      this.ready = undefined;
      if (this.parser) this.terminate(this.parser);
    }
    return this.initialize();
  }

  private selected(): Selection {
    if (!this.selection)
      throw new Error(
        "Configure a verified dataset before initializing the engine.",
      );
    return this.selection;
  }

  private async context(selection: Selection): Promise<Context> {
    return {
      catalog: selection.catalog,
      dataset: structuredClone(
        await selection.catalog.dataset(selection.datasetId),
      ),
    };
  }

  private async create(
    work: Work,
    context: Context,
    variantId?: string,
  ): Promise<Slot> {
    return work.deadline(
      30_000,
      "Engine initialization exceeded 30 seconds. Retry to restore the local snapshot.",
      async () => {
        const assets = context.catalog.assets;
        await work.wait(
          Promise.all(
            [WORKER, WASM, ...EXTENSIONS].map((path) => assets.bytes(path)),
          ),
        );
        // A pooled worker has already parsed 755 KB of JS and instantiated a
        // 35 MB wasm module; only the database instance is rebuilt below.
        const pooled = this.pool.pop();
        const worker = pooled?.worker ?? new Worker(assetUrl(WORKER));
        const { promise: failure, reject } = Promise.withResolvers<never>();
        void failure.catch(() => {});
        const db =
          pooled?.db ??
          new duckdb.AsyncDuckDB(
            new duckdb.ConsoleLogger(duckdb.LogLevel.WARNING),
            worker,
          );
        const slot: Slot = {
          db,
          worker,
          dead: false,
          failed: false,
          work,
          listeners: [],
          failure,
          reject,
        };
        this.slots.add(slot);
        work.slots.add(slot);
        const listen = (type: string, listener: EventListener) => {
          slot.listeners.push([type, listener]);
          worker.addEventListener(type, listener);
        };
        listen("error", ((event: ErrorEvent) => {
          slot.failed = true;
          reject(
            new EngineFailure(
              "engine-error",
              `SQL worker failed: ${event.message || "worker error"}`,
            ),
          );
          this.terminate(slot);
        }) as EventListener);
        listen("messageerror", (() => {
          slot.failed = true;
          reject(
            new EngineFailure(
              "engine-error",
              "SQL worker response could not be decoded.",
            ),
          );
          this.terminate(slot);
        }) as EventListener);
        try {
          if (!pooled) await work.wait(db.instantiate(assetUrl(WASM)), slot);
          // Always reopen, pooled or cold. This single call is the isolation
          // boundary: it discards any previous database instance, so a reused
          // worker starts from the same blank state as a new one.
          await work.wait(db.open(OPEN_OPTIONS), slot);
          slot.conn = await work.wait(db.connect(), slot);
          const query = (sql: string) => work.wait(slot.conn!.query(sql), slot);
          await query(
            `SET memory_limit='512MB'; SET threads=1; SET custom_extension_repository=${quote(location.origin + assetUrl("/extensions"))}; SET TimeZone='UTC'; LOAD json; LOAD parquet`,
          );
          const version = await work.wait(db.getVersion(), slot);
          if (version !== "v1.5.4")
            throw new Error(
              `Expected DuckDB v1.5.4; received ${version}. Restore the pinned runtime.`,
            );
          if (variantId !== undefined) {
            const variant = context.dataset.variants[variantId];
            if (!variant)
              throw new Error(
                `Content error: Unknown dataset variant ${variantId}.`,
              );
            await query(await work.wait(assets.text(context.dataset.schema)));
            for (const path of variant.bootstrap)
              await query(await work.wait(assets.text(path)));
            const parquet = new Map(
              variant.parquet?.map((entry) => [entry.table, entry.asset]),
            );
            for (const table of context.dataset.tables) {
              const path = parquet.get(table);
              if (!path) continue;
              const file = `${table}.parquet`;
              await work.wait(
                db.registerFileBuffer(
                  file,
                  (await work.wait(assets.bytes(path))).slice(),
                ),
                slot,
              );
              try {
                // Derive parent-before-child loading from actual self-referencing constraints.
                const constraints = await query(
                  `SELECT constraint_column_names,referenced_column_names FROM duckdb_constraints() WHERE schema_name='main' AND table_name=${quote(table)} AND constraint_type='FOREIGN KEY' AND referenced_table=${quote(table)}`,
                );
                if (!constraints.numRows) {
                  await query(
                    `INSERT INTO ${identifier(table)} SELECT * FROM read_parquet(${quote(file)})`,
                  );
                } else {
                  const relations = Array.from(constraints, (row) => ({
                    child: Array.from(
                      row.constraint_column_names as Iterable<string>,
                    ),
                    parent: Array.from(
                      row.referenced_column_names as Iterable<string>,
                    ),
                  }));
                  const ready = relations
                    .map(({ child, parent }) => {
                      if (!child.length || child.length !== parent.length)
                        throw new Error(
                          "Content error: Invalid self-reference metadata.",
                        );
                      return `(${child.map((column) => `s.${identifier(column)} IS NULL`).join(" OR ")} OR EXISTS (SELECT 1 FROM ${identifier(table)} p WHERE ${child.map((column, i) => `p.${identifier(parent[i])}=s.${identifier(column)}`).join(" AND ")}))`;
                    })
                    .join(" AND ");
                  // A temporary source gives each physical row a key independent of business IDs.
                  await query(
                    `CREATE TEMP TABLE "__load_pending" AS SELECT row_number() OVER () AS "__load_row", * FROM read_parquet(${quote(file)})`,
                  );
                  for (;;) {
                    const pending = await query(
                      'SELECT count(*) FROM "__load_pending"',
                    );
                    if (BigInt(pending.getChildAt(0)!.get(0)) === 0n) break;
                    await query(
                      `CREATE TEMP TABLE "__load_ready" AS SELECT s.* FROM "__load_pending" s WHERE ${ready}`,
                    );
                    const count = await query(
                      'SELECT count(*) FROM "__load_ready"',
                    );
                    if (BigInt(count.getChildAt(0)!.get(0)) === 0n)
                      throw new Error(
                        `Content error: Unresolvable foreign-key dependency in ${table}.`,
                      );
                    await query(
                      `INSERT INTO ${identifier(table)} SELECT * EXCLUDE ("__load_row") FROM "__load_ready"`,
                    );
                    await query(
                      'DELETE FROM "__load_pending" WHERE "__load_row" IN (SELECT "__load_row" FROM "__load_ready"); DROP TABLE "__load_ready"',
                    );
                  }
                  await query('DROP TABLE "__load_pending"');
                }
              } finally {
                await work.wait(db.dropFile(file), slot);
              }
            }
          }
          await query(
            "SET autoinstall_known_extensions=false; SET autoload_known_extensions=false; SET enable_external_access=false; SET lock_configuration=true",
          );
          return slot;
        } catch (error) {
          // A slot that failed mid-build may have an unusable wasm instance or
          // a half-loaded snapshot, so it is destroyed rather than pooled.
          this.discard(slot);
          throw error;
        }
      },
    );
  }

  initialize(): Promise<SchemaTable[]> {
    if (this.disposed) return Promise.reject(new Error("Engine disposed."));
    const selection = this.selected();
    this.ready ??= (async () => {
      const work = this.newWork();
      this.background.add(work);
      this.initializingWork = work;
      this.onState(
        "loading",
        "Verifying the selected dataset and loading DuckDB…",
      );
      try {
        return await work.deadline(
          30_000,
          "Initialization exceeded 30 seconds.",
          async () => {
            const context = await work.wait(this.context(selection));
            const snapshot = await this.create(
              work,
              context,
              context.dataset.previewVariant,
            );
            const schema = await this.readSchema(
              work,
              snapshot,
              context.dataset,
            );
            if (this.selection === selection) {
              this.onState(
                "ready",
                "Local SQL engine ready. UTC · one thread · 512 MB.",
              );
            }
            return schema;
          },
        );
      } catch (error) {
        if (this.selection === selection) {
          this.onState("error", errorMessage(error));
          this.ready = undefined;
        }
        throw error;
      } finally {
        for (const slot of work.slots) this.terminate(slot);
        work.finish();
        this.background.delete(work);
        if (this.initializingWork === work) this.initializingWork = undefined;
      }
    })();
    return this.ready;
  }

  parse(sql: string, revision: number): Promise<ParseResult> {
    if (this.disposed)
      return Promise.resolve({
        revision,
        valid: null,
        diagnostics: [],
        elapsedMs: 0,
        coverage: "Engine disposed.",
      });
    const started = performance.now();
    const selection = this.selection;
    const result = this.parserQueue.then(async (): Promise<ParseResult> => {
      if (this.disposed)
        return {
          revision,
          valid: null,
          diagnostics: [],
          elapsedMs: performance.now() - started,
          coverage: "Engine disposed.",
        };
      const work = this.newWork(false);
      this.background.add(work);
      try {
        if (!selection)
          throw new Error("Configure a verified dataset before parsing.");
        const context = await work.wait(this.context(selection));
        const schema =
          this.selection === selection
            ? await work.wait(this.initialize())
            : [];
        if (
          !this.parser ||
          this.parser.dead ||
          this.parserCatalog !== context.catalog
        ) {
          if (this.parser) this.terminate(this.parser);
          this.parser = await this.create(work, context);
          this.parserCatalog = context.catalog;
        }
        const slot = this.parser;
        work.slots.add(slot);
        return await this.analyzeSql(
          work,
          slot,
          sql,
          revision,
          schema,
          started,
        );
      } catch (error) {
        for (const slot of work.slots) this.terminate(slot);
        return {
          revision,
          valid: null,
          diagnostics: [],
          elapsedMs: performance.now() - started,
          coverage: `Parser unavailable; not a SQL validity claim. ${errorMessage(error)}. Next edit retries the parser.`,
        };
      } finally {
        work.finish();
        this.background.delete(work);
      }
    });
    this.parserQueue = result.catch(() => {});
    return result;
  }

  // One parser round trip: serialize the statement, then classify the result.
  // Callers own their parser slot; this never executes the statement itself.
  private async analyzeSql(
    work: Work,
    slot: Slot,
    sql: string,
    revision: number,
    schema: SchemaTable[],
    startedAt: number,
  ): Promise<ParseResult> {
    const table = await work.deadline(10_000, "Parser deadline exceeded.", () =>
      work.wait(
        slot.conn!.query(`SELECT json_serialize_sql(${quote(sql)}) AS ast`),
        slot,
      ),
    );
    return analyze(
      JSON.parse(String(table.getChildAt(0)!.get(0))),
      sql,
      revision,
      performance.now() - startedAt,
      schema,
    );
  }

  private async query(
    work: Work,
    slot: Slot,
    sql: string,
    visible = true,
  ): Promise<{ result: ArrowResult; elapsedMs: number }> {
    if (visible)
      this.onState("running", "Executing SQL; bootstrap time is excluded.");
    const start = performance.now();
    return work
      .deadline(
        10_000,
        "SQL exceeded its 10-second deadline. No partial result was graded.",
        async () => {
          const reader = await work.wait(slot.conn!.send(sql, true), slot);
          await work.wait(reader.open(), slot);
          const resultSchema = reader.schema;
          const batches: RecordBatch[] = [];
          const retained = new Set<ArrayBufferLike>();
          let rows = 0,
            bytes = 0;
          for (;;) {
            const item = await work.wait(reader.next(), slot);
            if (item.done) break;
            const batch = item.value;
            const incoming = batchBuffers(batch);
            let added = 0;
            for (const buffer of incoming)
              if (!retained.has(buffer)) added += buffer.byteLength;
            if (rows + batch.numRows > MAX_ROWS || bytes + added > MAX_BYTES) {
              batches.length = 0;
              retained.clear();
              throw new EngineFailure(
                "result-limit",
                "Result exceeds 100,000 rows or 32 MiB retained Arrow output. Nothing was truncated into a pass.",
              );
            }
            rows += batch.numRows;
            bytes += added;
            for (const buffer of incoming) retained.add(buffer);
            batches.push(batch);
            if (visible)
              this.onState(
                "transferring",
                `Receiving result: ${formatCount(rows, "row")}.`,
              );
            // Yield between batches so Cancel can interrupt transfer, not only compute.
            const pause = Promise.withResolvers<void>();
            setTimeout(pause.resolve, 0);
            await work.wait(pause.promise, slot);
          }
          return {
            result: new ArrowResult(resultSchema, batches),
            elapsedMs: performance.now() - start,
          };
        },
      )
      .finally(() => {
        work.sqlElapsedMs += performance.now() - start;
      });
  }

  async run(request: RunRequest): Promise<RunResult> {
    // No later document switch, report edit, or catalog replacement may retag this run.
    request = structuredClone(request);
    const navigation = this.navigation;
    const selection = this.selection;
    const empty: RunResult = {
      id: request.id,
      documentId: request.documentId,
      revision: request.revision,
      challenge: request.challenge,
      datasetId: request.datasetId,
      outcome: "engine-error",
      correctness: "not-evaluated",
      result: null,
      elapsedMs: 0,
      message: "",
      diagnostics: [],
    };
    if (this.disposed)
      return { ...empty, message: "Engine disposed. Reload the application." };
    if (this.active)
      return {
        ...empty,
        message:
          "Another operation is active. Cancel it or wait before starting another run.",
      };
    const work = this.newWork();
    this.active = work;
    try {
      if (!selection)
        throw new Error("Configure a verified dataset before running SQL.");
      const context = await work.wait(
        this.context({
          catalog: selection.catalog,
          datasetId: request.datasetId,
        }),
      );
      const loaded = request.challenge
        ? structuredClone(
            await work.wait(
              selection.catalog.load(request.challenge.challengeId),
            ),
          )
        : undefined;
      if (
        loaded &&
        (!sameIdentity(loaded.identity, request.challenge) ||
          loaded.dataset.id !== request.datasetId)
      )
        throw new Error(
          "Content error: The captured challenge identity does not match this publication and dataset.",
        );
      if (
        loaded?.definition.assessment.kind === "plan-lab" &&
        loaded.definition.assessment.lab === "index" &&
        request.kind === "lab"
      ) {
        this.indexWork = work;
        if (navigation !== this.navigation)
          throw new EngineFailure(
            "cancelled",
            "Index lab cancelled after navigation.",
          );
      }
      if (!loaded && !["execute", "plan", "kata"].includes(request.kind))
        throw new Error(
          "Scratch documents can execute SQL but cannot receive challenge credit.",
        );
      if (request.kata && request.kind !== "kata")
        throw new Error("A kata target belongs to a kata run.");
      // The only DDL route is the private, disposable index sequence below.
      // Empty and multi-statement input is rejected outright. A policy
      // rejection first asks the parser whether the statement is even valid,
      // so a typo reports its own syntax error instead of read-only guidance.
      let sql: string;
      try {
        sql = admit(request.sql, "challenge");
      } catch (rejection) {
        if (
          !(rejection instanceof AdmissionFailure) ||
          rejection.reason !== "policy"
        )
          throw rejection;
        // Creating the parser is part of the guarded region: if the worker
        // cannot start, the admission rejection stands rather than being
        // replaced by a worker error.
        let parsed: ParseResult | undefined;
        let parser: Slot | undefined;
        try {
          parser = await this.create(work, context);
          // Only syntax matters here, so the parser needs no schema.
          parsed = await this.analyzeSql(
            work,
            parser,
            request.sql,
            request.revision,
            [],
            performance.now(),
          );
        } catch (parserError) {
          if (work.reason) throw work.reason;
          if (
            parserError instanceof EngineFailure &&
            (parserError.outcome === "cancelled" ||
              parserError.outcome === "timeout")
          )
            throw parserError;
        } finally {
          if (parser) this.terminate(parser);
        }
        // Unsupported serialization reports valid: null, which is no evidence
        // either way; the admission rejection stands.
        if (parsed?.valid !== false) throw rejection;
        return {
          ...empty,
          diagnostics: parsed.diagnostics,
          message:
            parsed.diagnostics.find((diagnostic) => diagnostic.ruleId === "SQL")
              ?.message ?? "SQL syntax is invalid.",
        };
      }
      const preview = await this.create(
        work,
        context,
        context.dataset.previewVariant,
      );
      let diagnostics: RunResult["diagnostics"];
      try {
        const schema = await this.readSchema(work, preview, context.dataset);
        const parser = await this.create(work, context);
        try {
          const parsed = await this.analyzeSql(
            work,
            parser,
            request.sql,
            request.revision,
            schema,
            performance.now(),
          );
          diagnostics = parsed.diagnostics;
          if (parsed.valid === false)
            return {
              ...empty,
              diagnostics,
              message:
                diagnostics.find((diagnostic) => diagnostic.ruleId === "SQL")
                  ?.message ?? "SQL syntax is invalid.",
            };
        } finally {
          this.terminate(parser);
        }
        if (request.kind === "execute" || request.kind === "plan") {
          const measured = await this.query(
            work,
            preview,
            request.kind === "plan" ? `EXPLAIN ${sql}` : sql,
          );
          if (request.kind === "plan")
            return {
              ...empty,
              outcome: "complete",
              diagnostics,
              elapsedMs: measured.elapsedMs,
              plan: Array.from({ length: measured.result.count }, (_, i) =>
                measured.result.getRow(i).join("\n"),
              ).join("\n"),
              message:
                "Nonexecuting EXPLAIN. The query was planned, not run or graded.",
            };
          return {
            ...empty,
            outcome: "complete",
            diagnostics,
            elapsedMs: measured.elapsedMs,
            result: measured.result,
            message:
              "Execution complete. Correctness was not evaluated; Submit checks every grading variant.",
          };
        }
        if (request.kind === "kata") {
          const target = request.kata;
          if (!target) throw new Error("A kata target is required.");
          if (!context.dataset.variants[target.variantId])
            throw new Error(
              `Content error: Unknown dataset variant ${target.variantId}.`,
            );
          const reference = await this.freshQuery(
            work,
            context,
            target.variantId,
            admit(target.reference, "challenge"),
          );
          // The authored reference is checked against its own authored
          // contract first. A kata holds no published expectation, so this is
          // the only thing standing between a mis-authored contract and
          // telling a learner their correct answer is wrong — and it must
          // report as a content error, never as an incorrect attempt.
          //
          // Column and type disagreements are raised from inside compare; an
          // ordering claim the reference does not actually satisfy is
          // returned. Both are the same authoring mistake, so both are
          // reported against the kata that owns them.
          const blame = (detail: string | undefined) =>
            new Error(
              `Content error: Kata ${target.patternId}/${target.variationId} reference disagrees with its own contract: ${detail ?? "unspecified."}`,
            );
          let selfCheck: { pass: boolean; reason?: string };
          try {
            selfCheck = compare(
              reference.result,
              reference.result,
              target.output,
            );
          } catch (error) {
            throw blame((error as Error).message);
          }
          if (!selfCheck.pass) throw blame(selfCheck.reason);
          const actual = await this.freshQuery(
            work,
            context,
            target.variantId,
            sql,
          );
          const checked = compare(
            reference.result,
            actual.result,
            target.output,
          );
          return {
            ...empty,
            outcome: "complete",
            diagnostics,
            result: actual.result,
            elapsedMs: actual.elapsedMs,
            correctness: checked.pass ? "correct" : "incorrect",
            message: checked.pass
              ? "The drill matches the authored reference on types, values, NULLs, duplicates and required ordering."
              : // The comparator's reason names the offending row and column but
                // not the counts, because a graded challenge shows those in its
                // per-variant scorecard line. A drill has no scorecard, so the
                // counts are stated here rather than lost.
                `Expected ${reference.result.count} rows, received ${actual.result.count}. ${
                  checked.reason ??
                  "The drill output differs from the authored reference."
                }`,
          };
        }
      } finally {
        this.terminate(preview);
      }
      if (!loaded) throw new Error("A current challenge is required.");
      const definition = loaded.definition;
      if (definition.assessment.kind === "plan-lab") {
        if (request.kind === "compare")
          throw new Error(
            "Use Measure Lab for this challenge's measured comparison.",
          );
        if (!request.lab || request.lab.kind !== definition.assessment.lab)
          throw new Error("The report does not match this lab.");
        const labRequest: LabRequest = {
          identity: loaded.identity,
          datasetId: context.dataset.id,
          previewVariant: context.dataset.previewVariant,
          gradingVariants: [...context.dataset.gradingVariants],
          sql: request.sql,
          document: request.lab,
          baselineSql: definition.assessment.secondaryReference
            ? await work.wait(
                context.catalog.assets.text(
                  definition.assessment.secondaryReference,
                ),
              )
            : undefined,
        };
        if (request.kind === "lab") {
          const evidence = await runLab(
            this.labHost(work, context, loaded),
            labRequest,
          );
          return {
            ...empty,
            outcome: "complete",
            diagnostics,
            elapsedMs: work.sqlElapsedMs,
            assessment: { kind: "plan-lab", evidence, report: request.lab },
            message:
              "Lab measurements are complete. Answer the report and submit; measuring does not award completion.",
          };
        }
        if (!request.labEvidence)
          throw new Error(
            "Measure the current SQL before submitting the lab report.",
          );
        const checked = await validateLabEvidence(
          labRequest,
          request.labEvidence,
        );
        return {
          ...empty,
          outcome: "complete",
          diagnostics,
          elapsedMs: work.sqlElapsedMs,
          correctness: checked.pass ? "correct" : "incorrect",
          assessment: {
            kind: "plan-lab",
            evidence: request.labEvidence,
            report: request.lab,
          },
          message: checked.pass
            ? "The exact results and report agree with the current measurements."
            : checked.reasons.join(" "),
        };
      }
      if (request.kind === "lab")
        throw new Error("This challenge is not a measured lab.");
      if (definition.assessment.kind === "reconciliation") {
        if (request.kind === "compare")
          throw new Error(
            "Speed comparison is unavailable for outcome-based reconciliation. Inspect its quality assessment instead.",
          );
        const variants: {
          variantId: string;
          metrics: ReconciliationAssessment;
        }[] = [];
        let result: ArrowResult | null = null;
        for (const variantId of context.dataset.gradingVariants) {
          const truth = validateReconciliationTruth(
            await work.wait(
              context.catalog.assets.json(
                definition.assessment.truth[variantId],
              ),
            ),
          );
          const reference = await this.freshQuery(
            work,
            context,
            variantId,
            admit(
              await work.wait(
                context.catalog.assets.text(definition.reference),
              ),
              "challenge",
            ),
          );
          const referenceAssessment = assessReconciliation(
            {
              fields: reference.result.fields,
              rows: Array.from({ length: reference.result.count }, (_, i) =>
                reference.result.getRow(i),
              ),
              complete: true,
            },
            truth,
          );
          if (!referenceAssessment.pass)
            throw new Error(
              `Content error: Reconciliation reference failed ${variantId}.`,
            );
          const actual = await this.freshQuery(work, context, variantId, sql);
          if (!result || variantId === context.dataset.previewVariant)
            result = actual.result;
          variants.push({
            variantId,
            metrics: assessReconciliation(
              {
                fields: actual.result.fields,
                rows: Array.from({ length: actual.result.count }, (_, i) =>
                  actual.result.getRow(i),
                ),
                complete: true,
              },
              truth,
            ),
          });
        }
        const correct = variants.every((variant) => variant.metrics.pass);
        return {
          ...empty,
          outcome: "complete",
          diagnostics,
          result,
          elapsedMs: work.sqlElapsedMs,
          correctness: correct ? "correct" : "incorrect",
          assessment: { kind: "reconciliation", variants },
          message: correct
            ? "Every variant meets the reconciliation outcome rubric."
            : "The reconciliation output does not meet every variant's outcome rubric.",
        };
      }
      const fixtureResults: NonNullable<RunResult["fixtureResults"]> = [];
      let result: ArrowResult | null = null;
      for (const variantId of context.dataset.gradingVariants) {
        const expected = await this.exactReference(
          work,
          context,
          loaded,
          variantId,
        );
        const actual = await this.freshQuery(work, context, variantId, sql);
        if (!result || variantId === context.dataset.previewVariant)
          result = actual.result;
        fixtureResults.push({
          name: variantId,
          expectedRows: expected.count,
          actualRows: actual.result.count,
          elapsedMs: actual.elapsedMs,
          ...compare(expected, actual.result, definition.output),
        });
      }
      const correct = fixtureResults.every((fixture) => fixture.pass);
      const base: RunResult = {
        ...empty,
        outcome: "complete",
        diagnostics,
        result,
        elapsedMs: fixtureResults.reduce(
          (total, fixture) => total + (fixture.elapsedMs ?? 0),
          0,
        ),
        correctness: correct ? "correct" : "incorrect",
        fixtureResults,
        assessment: { kind: "exact", fixtures: fixtureResults },
        message: correct
          ? "Every complete grading variant passes exact types, values, NULLs, duplicates, and required ordering."
          : "The complete answer differs from the challenge contract. See each variant; no partial output can pass.",
      };
      if (request.kind !== "compare" || !correct) return base;
      const referenceSql = admit(
        await work.wait(context.catalog.assets.text(definition.reference)),
        "challenge",
      );
      const references: number[] = [],
        candidates: number[] = [],
        ratios: number[] = [];
      for (let pair = 0; pair < 9; pair++) {
        // Nine pairs are known before the loop starts, so the UI's determinate
        // bar is honest. timedQuery runs invisibly, so this is the only signal.
        this.onState(
          "running",
          `Comparison ${pair + 1}/9 · timing your SQL and the reference on the same snapshot.`,
        );
        let referenceMs: number, candidateMs: number;
        if (pair % 2) {
          candidateMs = await this.timedQuery(
            work,
            context,
            context.dataset.previewVariant,
            sql,
          );
          referenceMs = await this.timedQuery(
            work,
            context,
            context.dataset.previewVariant,
            referenceSql,
          );
        } else {
          referenceMs = await this.timedQuery(
            work,
            context,
            context.dataset.previewVariant,
            referenceSql,
          );
          candidateMs = await this.timedQuery(
            work,
            context,
            context.dataset.previewVariant,
            sql,
          );
        }
        references.push(referenceMs);
        candidates.push(candidateMs);
        ratios.push(candidateMs / Math.max(referenceMs, Number.EPSILON));
      }
      const referenceProfile = extractProfile(
        (
          await this.freshQuery(
            work,
            context,
            context.dataset.previewVariant,
            `EXPLAIN (ANALYZE, FORMAT JSON) ${referenceSql}`,
          )
        ).result,
      );
      const candidateProfile = extractProfile(
        (
          await this.freshQuery(
            work,
            context,
            context.dataset.previewVariant,
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
          )
        ).result,
      );
      diagnostics.push(...scanDiagnostics(candidateProfile, request.revision));
      const median = (values: number[]): number =>
        [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      const referenceMs = median(references),
        candidateMs = median(candidates);
      const ratioMedian = median(ratios);
      const summarize = (profile: unknown): ProfileSummary[] =>
        normalizeProfile(profile).scans.map((scan) => ({
          operator: scan.operator,
          ...(scan.table === undefined ? {} : { table: scan.table }),
          ...(scan.rowsScanned === undefined
            ? {}
            : { rowsScanned: scan.rowsScanned }),
          accessPath: scan.accessPath,
          filtered: scan.filters !== undefined,
        }));
      return {
        ...base,
        elapsedMs: work.sqlElapsedMs,
        comparison: {
          referenceMs,
          candidateMs,
          referenceMad: median(
            references.map((value) => Math.abs(value - referenceMs)),
          ),
          candidateMad: median(
            candidates.map((value) => Math.abs(value - candidateMs)),
          ),
          pairs: 9,
          // Paired ratios cancel per-pair machine noise, so this is the
          // estimator, not candidateMs / referenceMs. Its own MAD is what
          // decides whether the difference is measurable at all.
          ratio: ratioMedian,
          ratioMad: median(
            ratios.map((value) => Math.abs(value - ratioMedian)),
          ),
          referenceScans: summarize(referenceProfile),
          candidateScans: summarize(candidateProfile),
        },
        message:
          "Equivalent complete answers. Nine alternating fresh-snapshot pairs with one warmup each; median and MAD exclude bootstrap. Separate profiles are not timed samples. No speed threshold awards completion.",
      };
    } catch (error) {
      const failure =
        work.reason ??
        (error instanceof EngineFailure
          ? error
          : new EngineFailure("engine-error", errorMessage(error)));
      this.onState(
        "recovering",
        `${failure.message} SQL and saved progress remain unchanged.`,
      );
      return {
        ...empty,
        outcome: failure.outcome,
        elapsedMs: work.sqlElapsedMs,
        message: failure.message,
      };
    } finally {
      for (const slot of work.slots) this.terminate(slot);
      work.finish();
      if (this.active === work) this.active = undefined;
      if (this.indexWork === work) this.indexWork = undefined;
      if (!this.disposed)
        this.onState(
          "ready",
          "Ready. Each run restores an isolated dataset snapshot.",
        );
    }
  }

  private async freshQuery(
    work: Work,
    context: Context,
    variantId: string,
    sql: string,
  ): Promise<{ result: ArrowResult; elapsedMs: number }> {
    this.onState("initializing", `Restoring isolated ${variantId} snapshot…`);
    const slot = await this.create(work, context, variantId);
    try {
      return await this.query(work, slot, sql);
    } finally {
      this.terminate(slot);
    }
  }

  private async exactReference(
    work: Work,
    context: Context,
    loaded: LoadedChallenge,
    variantId: string,
    secondary = false,
  ): Promise<ArrowResult> {
    const definition = loaded.definition,
      assessment = definition.assessment;
    const referencePath =
      secondary &&
      assessment.kind === "plan-lab" &&
      assessment.secondaryReference
        ? assessment.secondaryReference
        : definition.reference;
    const expectedPath =
      secondary &&
      assessment.kind === "plan-lab" &&
      assessment.secondaryExpected
        ? assessment.secondaryExpected[variantId]
        : definition.expected[variantId];
    const expected = validateExpected(
      await work.wait(context.catalog.assets.json(expectedPath)),
      definition.output,
      { identity: loaded.identity, datasetId: context.dataset.id, variantId },
    );
    const reference = await this.freshQuery(
      work,
      context,
      variantId,
      admit(
        await work.wait(context.catalog.assets.text(referencePath)),
        "challenge",
      ),
    );
    const checked = compare(expected, reference.result, definition.output);
    if (!checked.pass)
      throw new Error(
        `Content error: Reference disagrees with the authored ${variantId} expectation: ${checked.reason}`,
      );
    return reference.result;
  }

  private async timedQuery(
    work: Work,
    context: Context,
    variantId: string,
    sql: string,
  ): Promise<number> {
    const slot = await this.create(work, context, variantId);
    try {
      await this.query(work, slot, sql, false);
      return (await this.query(work, slot, sql, false)).elapsedMs;
    } finally {
      this.terminate(slot);
    }
  }

  private labHost(
    work: Work,
    context: Context,
    loaded: LoadedChallenge,
  ): LabHost {
    let timing: { primary: Slot; secondary: Slot } | undefined;
    const measure = async (sql: string, variantId: string, slot?: Slot) => {
      sql = admit(sql, "challenge");
      const actual = slot
        ? await this.query(work, slot, sql, false)
        : await this.freshQuery(work, context, variantId, sql);
      const profiled = slot
        ? await this.query(
            work,
            slot,
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
            false,
          )
        : await this.freshQuery(
            work,
            context,
            variantId,
            `EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`,
          );
      return {
        complete: true,
        count: actual.result.count,
        profile: extractProfile(profiled.result),
      };
    };
    return {
      check: async (sql, variantId, slot) => {
        const expected = await this.exactReference(
          work,
          context,
          loaded,
          variantId,
          slot === "secondary",
        );
        const actual = await this.freshQuery(
          work,
          context,
          variantId,
          admit(sql, "challenge"),
        );
        return compare(expected, actual.result, loaded.definition.output);
      },
      measure,
      timedPair: async (primary, secondary, variantId, pair) => {
        primary = admit(primary, "challenge");
        secondary = admit(secondary, "challenge");
        if (!timing) {
          timing = {
            primary: await this.create(work, context, variantId),
            secondary: await this.create(work, context, variantId),
          };
          await this.query(work, timing.primary, primary, false);
          await this.query(work, timing.secondary, secondary, false);
        }
        let primaryMs: number, secondaryMs: number;
        if (pair % 2) {
          secondaryMs = (
            await this.query(work, timing.secondary, secondary, false)
          ).elapsedMs;
          primaryMs = (await this.query(work, timing.primary, primary, false))
            .elapsedMs;
        } else {
          primaryMs = (await this.query(work, timing.primary, primary, false))
            .elapsedMs;
          secondaryMs = (
            await this.query(work, timing.secondary, secondary, false)
          ).elapsedMs;
        }
        return { primary: primaryMs, secondary: secondaryMs };
      },
      openIndex: async (variantId) => {
        if (
          loaded.definition.assessment.kind !== "plan-lab" ||
          loaded.definition.assessment.lab !== "index" ||
          context.dataset.id !== "index-lab"
        )
          throw new Error("Index commands require the dedicated index lab.");
        const expected = await this.exactReference(
          work,
          context,
          loaded,
          variantId,
        );
        const slot = await this.create(work, context, variantId);
        this.sandbox = slot;
        let indexName: string | undefined,
          dropped = false;
        return {
          catalog: async () => {
            const result = await this.query(
              work,
              slot,
              "SELECT index_name,schema_name,table_name,is_unique,is_primary,expressions FROM duckdb_indexes() ORDER BY index_name",
              false,
            );
            return Array.from(
              { length: result.result.count },
              (_, i): IndexCatalogEntry => {
                const row = result.result.getRow(i);
                return {
                  index_name: row[0]!,
                  schema_name: row[1]!,
                  table_name: row[2]!,
                  is_unique: row[3] === "true",
                  is_primary: row[4] === "true",
                  expressions: row[5]!,
                };
              },
            );
          },
          command: async (sql) => {
            if (dropped)
              throw new Error("The index sequence is already complete.");
            const command = admitIndexCommand(
              sql,
              indexName ? "drop" : "create",
              indexName,
            );
            await this.query(work, slot, command.sql, false);
            if (indexName) dropped = true;
            else indexName = command.indexName;
          },
          check: async (sql) =>
            compare(
              expected,
              (await this.query(work, slot, admit(sql, "challenge"), false))
                .result,
              loaded.definition.output,
            ).pass,
          measure: (sql) => measure(sql, variantId, slot),
          close: async () => {
            this.terminate(slot);
          },
        };
      },
    };
  }

  cancel(): void {
    this.active?.cancel();
    this.initializingWork?.cancel();
    if (this.sandbox) this.terminate(this.sandbox);
  }

  private async readSchema(
    work: Work,
    slot: Slot,
    dataset?: DatasetDefinition,
  ): Promise<SchemaTable[]> {
    const columns = await work.wait(
      slot.conn!.query(
        "SELECT table_name,column_name,data_type,is_nullable FROM information_schema.columns WHERE table_schema='main' ORDER BY table_name,ordinal_position",
      ),
      slot,
    );
    const definitions = await work.wait(
      slot.conn!.query(
        "SELECT table_name,sql FROM duckdb_tables() WHERE schema_name='main' AND NOT internal ORDER BY table_name",
      ),
      slot,
    );
    const constraints = await work.wait(
      slot.conn!.query(
        "SELECT table_name,constraint_type,constraint_column_names,constraint_text,referenced_table,referenced_column_names FROM duckdb_constraints() WHERE schema_name='main' AND constraint_type IN ('PRIMARY KEY','FOREIGN KEY','UNIQUE')",
      ),
      slot,
    );
    const result: SchemaTable[] = [];
    for (const row of definitions) {
      const name = String(row.table_name);
      const countResult = await work.wait(
        slot.conn!.query(`SELECT count(*) AS n FROM ${identifier(name)}`),
        slot,
      );
      const count = Number(countResult.getChildAt(0)!.get(0));
      const fields: SchemaTable["columns"] = [];
      for (const column of columns)
        if (column.table_name === name) {
          const keys: string[] = [];
          for (const constraint of constraints)
            if (
              constraint.table_name === name &&
              Array.from(
                constraint.constraint_column_names as Iterable<string>,
              ).includes(String(column.column_name))
            )
              // DuckDB reports a self-referencing foreign key with empty
              // constraint_text, which would otherwise print as a blank key.
              keys.push(constraintLabel(constraint));
          fields.push({
            name: String(column.column_name),
            type: String(column.data_type),
            nullable: column.is_nullable === "YES",
            ...(keys.length ? { key: keys.join("; ") } : {}),
          });
        }
      // Typed edges for the relationship diagram. referenced_table is the only
      // complete source: DuckDB leaves constraint_text empty for a
      // self-referencing foreign key, so text parsing alone loses those edges.
      // An edge that resolves from neither source is dropped — a missing edge
      // is acceptable, a wrong one is not.
      const references: SchemaReference[] = [];
      for (const constraint of constraints)
        if (
          constraint.table_name === name &&
          constraint.constraint_type === "FOREIGN KEY"
        ) {
          let locals = nameList(constraint.constraint_column_names);
          let targets = nameList(constraint.referenced_column_names);
          let table = String(constraint.referenced_table ?? "");
          if (!table || !locals.length || !targets.length) {
            const match =
              /^FOREIGN KEY \(([^)]+)\) REFERENCES ([^(]+)\(([^)]+)\)$/.exec(
                String(constraint.constraint_text ?? ""),
              );
            if (!match) continue;
            locals = match[1].split(",").map((part) => part.trim());
            table = match[2].trim();
            targets = match[3].split(",").map((part) => part.trim());
          }
          locals.forEach((column, index) => {
            const toColumn = targets[index];
            if (toColumn) references.push({ column, table, toColumn });
          });
        }
      result.push({
        name,
        count,
        columns: fields,
        definition: String(row.sql),
        references,
      });
    }
    if (
      dataset &&
      (result.length !== dataset.tables.length ||
        dataset.tables.some(
          (name) => !result.some((table) => table.name === name),
        ))
    )
      throw new Error(
        "Content error: The restored tables do not match the dataset definition.",
      );
    return dataset
      ? dataset.tables.map(
          (name) => result.find((table) => table.name === name)!,
        )
      : result;
  }

  async refreshSchema(domain: "challenge" | "sandbox"): Promise<SchemaTable[]> {
    return this.metadata(domain, async (work, slot) => {
      const tables = await this.readSchema(work, slot);
      return tables;
    });
  }

  async inspectObjects(domain: "challenge" | "sandbox"): Promise<Objects> {
    return this.metadata(domain, async (work, slot) => {
      const views = await work.wait(
        slot.conn!.query(
          "SELECT view_name AS name,sql AS definition FROM duckdb_views() WHERE NOT internal AND schema_name='main' ORDER BY view_name",
        ),
        slot,
      );
      const macros = await work.wait(
        slot.conn!.query(
          "SELECT function_name AS name,macro_definition AS definition FROM duckdb_functions() WHERE function_type IN ('macro','table_macro') AND NOT internal AND schema_name='main' ORDER BY function_name",
        ),
        slot,
      );
      const indexes = await work.wait(
        slot.conn!.query(
          "SELECT index_name AS name,sql AS definition FROM duckdb_indexes() WHERE schema_name='main' ORDER BY index_name",
        ),
        slot,
      );
      const convert = (table: typeof views) =>
        Array.from(table, (row) => ({
          name: String(row.name),
          definition: String(row.definition),
        }));
      return {
        views: convert(views),
        macros: convert(macros),
        indexes: convert(indexes),
      };
    });
  }

  private async metadata<T>(
    domain: "challenge" | "sandbox",
    operation: (work: Work, slot: Slot) => Promise<T>,
  ): Promise<T> {
    if (this.active)
      throw new Error(
        "Wait for the active operation before refreshing metadata.",
      );
    const selection = this.selected();
    const work = this.newWork();
    this.active = work;
    this.onState("initializing", "Reading actual local catalog metadata…");
    try {
      const context = await work.wait(this.context(selection));
      if (domain === "sandbox" && context.dataset.id !== "index-lab")
        throw new Error(
          "Sandbox metadata is available only for the dedicated index lab.",
        );
      const slot = await this.create(
        work,
        context,
        context.dataset.previewVariant,
      );
      return await work.deadline(
        10_000,
        "Schema metadata query exceeded 10 seconds.",
        () => operation(work, slot),
      );
    } catch (error) {
      for (const slot of work.slots) this.terminate(slot);
      throw error;
    } finally {
      for (const slot of work.slots) this.terminate(slot);
      work.finish();
      if (this.active === work) this.active = undefined;
      // Without a settled message the status line keeps the in-progress
      // "Reading…" text after the read has finished.
      if (!this.disposed)
        this.onState("ready", "Local catalog metadata read. Engine ready.");
    }
  }

  async resetSandbox(): Promise<void> {
    this.indexWork?.cancel();
    if (this.sandbox) {
      this.active?.cancel();
      this.terminate(this.sandbox);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.dispose();
    for (const work of this.background) work.dispose();
    // `disposed` forces terminate down the destroying path, so nothing can be
    // pooled from here on; the workers already parked there still need killing.
    for (const slot of this.slots) this.terminate(slot);
    for (const host of this.pool.splice(0)) {
      host.worker.terminate();
      host.db.detach();
    }
  }
}
