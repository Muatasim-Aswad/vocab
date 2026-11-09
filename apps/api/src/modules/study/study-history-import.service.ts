import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

import { Injectable } from "@nestjs/common";

import type { Database } from "../../infra/db/database.js";
import {
  canonicalJson,
  historyRow,
  parseHistoryDocument,
  sessionHistoryDocument,
  type StudyHistoryDocument,
} from "./study-history.js";
import { StudyHistoryRepository } from "./study-history.repository.js";
import { StudySessionRepository } from "./study-session.repository.js";

type SourceFile = { name: string; sha256: string; bytes: Buffer };

/** A read of an explicit study-log directory: its JSON files and any entry that cannot be imported. */
export type StudyHistorySource = {
  root: string;
  /** SHA-256 over sorted relative names and bytes; equal to the legacy log-tree digest. */
  fingerprint: string;
  files: SourceFile[];
  unsupported: Array<{ name: string; problem: string }>;
};

type StudyHistoryInputReport = {
  name: string;
  sha256: string;
  size: number;
  status: "import" | "deduplicated" | "already-imported" | "invalid" | "conflict";
  historyId?: string;
  /** The durable session the record completes, when one exists. */
  sessionId?: string | null;
  outcome?: string | null;
  problem?: string;
};

export type StudyHistoryImportReport = {
  kind: "legacy" | "server-logs";
  source: string;
  sourceFingerprint: string;
  targetReady: boolean;
  ok: boolean;
  inputs: StudyHistoryInputReport[];
  unsupported: Array<{ name: string; problem: string }>;
  /** Ended sessions that would still have no final record: their outcome is unknown. */
  sessionsWithoutHistory: Array<{ id: string; startedAt: string; endedAt: string }>;
  totals: {
    inputs: number;
    imported: number;
    deduplicated: number;
    alreadyImported: number;
    invalid: number;
    conflicts: number;
    unsupported: number;
    linkedSessions: number;
    missingOutcome: number;
  };
};

/** Refusal carrying the full report, so callers can print every problem at once. */
export class StudyHistoryImportError extends Error {
  override readonly name = "StudyHistoryImportError";
  constructor(
    message: string,
    readonly report?: StudyHistoryImportReport,
  ) {
    super(message);
  }
}

/** Reads a study-log directory without following symlinks; nothing outside `root` is read. */
export function readStudyHistorySource(path: string): StudyHistorySource {
  const root = resolve(path);
  let stat;
  try {
    stat = lstatSync(root);
  } catch {
    throw new StudyHistoryImportError("Study log source does not exist");
  }
  if (stat.isSymbolicLink()) throw new StudyHistoryImportError("Study log source is a symlink");
  if (!stat.isDirectory()) throw new StudyHistoryImportError("Study log source is not a directory");
  const digest = createHash("sha256");
  const files: SourceFile[] = [];
  const unsupported: StudyHistorySource["unsupported"] = [];
  const visit = (dir: string, prefix: string) => {
    for (const entry of readdirSync(dir).toSorted()) {
      const full = join(dir, entry);
      const name = join(prefix, entry);
      const inside = relative(root, full);
      if (!inside || inside.startsWith("..") || isAbsolute(inside)) {
        unsupported.push({ name, problem: "path escapes the source directory" });
        continue;
      }
      const item = lstatSync(full);
      if (item.isSymbolicLink()) {
        digest.update(name).update("\0symlink");
        unsupported.push({ name, problem: "symlink" });
      } else if (item.isDirectory()) visit(full, name);
      else if (!item.isFile()) {
        digest.update(name).update("\0special");
        unsupported.push({ name, problem: "not a regular file" });
      } else {
        const bytes = readFileSync(full);
        digest.update(name).update("\0").update(bytes);
        if (entry.endsWith(".json"))
          files.push({ name, sha256: createHash("sha256").update(bytes).digest("hex"), bytes });
        else unsupported.push({ name, problem: "not a .json study log" });
      }
    }
  };
  visit(root, "");
  return { root, fingerprint: digest.digest("hex"), files, unsupported };
}

const withoutOutcome = ({ outcome: _outcome, ...rest }: StudyHistoryDocument) => rest;

/** Explicit offline import of historical JSON study logs into study history. */
@Injectable()
export class StudyHistoryImportService {
  constructor(
    private readonly history: StudyHistoryRepository,
    private readonly sessions: StudySessionRepository,
  ) {}

  /** Classifies every input against the database; never writes. */
  inventory(
    source: StudyHistorySource,
    kind: StudyHistoryImportReport["kind"],
  ): StudyHistoryImportReport {
    const targetReady = this.history.ready();
    const inputs: StudyHistoryInputReport[] = [];
    const batch = new Map<string, { canonical: string; index: number }>();
    const linked = new Set<string>();
    for (const file of source.files) {
      const input: StudyHistoryInputReport = {
        name: file.name,
        sha256: file.sha256,
        size: file.bytes.length,
        status: "import",
      };
      inputs.push(input);
      const parsed = parseHistoryDocument(file.bytes.toString("utf8"));
      if (!parsed.ok) {
        input.status = "invalid";
        input.problem = parsed.problem;
        continue;
      }
      const document = parsed.document;
      const canonical = canonicalJson(document);
      input.historyId = document.sessionId;
      input.outcome = document.outcome?.status ?? null;
      const earlier = batch.get(document.sessionId);
      if (earlier) {
        if (earlier.canonical !== canonical) {
          input.status = "conflict";
          input.problem = `differs from ${inputs[earlier.index]!.name} with the same sessionId`;
          const first = inputs[earlier.index]!;
          if (first.status !== "invalid") {
            first.status = "conflict";
            first.problem ??= `differs from ${file.name} with the same sessionId`;
          }
        } else
          input.status =
            targetReady && this.history.findSourceHistoryId(file.sha256)
              ? "already-imported"
              : "deduplicated";
        input.sessionId = inputs[earlier.index]!.sessionId ?? null;
        continue;
      }
      batch.set(document.sessionId, { canonical, index: inputs.length - 1 });
      if (!targetReady) {
        input.sessionId = this.sessions.findForHistory(document.sessionId)
          ? document.sessionId
          : null;
        continue;
      }
      const stored = this.history.findById(document.sessionId);
      if (stored) {
        input.sessionId = stored.sessionId;
        if (canonicalJson(stored.document) !== canonical) {
          input.status = "conflict";
          input.problem = "differs from the stored history record with the same ID";
        } else
          input.status = this.history.findSourceHistoryId(file.sha256)
            ? "already-imported"
            : "deduplicated";
        continue;
      }
      this.classifySession(input, document, linked);
    }
    const count = (status: StudyHistoryInputReport["status"]) =>
      inputs.filter((input) => input.status === status).length;
    const sessionsWithoutHistory = targetReady
      ? this.history.endedSessionsWithoutHistory().filter((session) => !linked.has(session.id))
      : [];
    const totals = {
      inputs: inputs.length,
      imported: count("import"),
      deduplicated: count("deduplicated"),
      alreadyImported: count("already-imported"),
      invalid: count("invalid"),
      conflicts: count("conflict"),
      unsupported: source.unsupported.length,
      linkedSessions: linked.size,
      missingOutcome: inputs.filter((input) => input.status === "import" && input.outcome === null)
        .length,
    };
    return {
      kind,
      source: source.root,
      sourceFingerprint: source.fingerprint,
      targetReady,
      ok: targetReady && totals.invalid === 0 && totals.conflicts === 0 && totals.unsupported === 0,
      inputs,
      unsupported: source.unsupported,
      sessionsWithoutHistory,
      totals,
    };
  }

  private classifySession(
    input: StudyHistoryInputReport,
    document: StudyHistoryDocument,
    linked: Set<string>,
  ): void {
    const session = this.sessions.findForHistory(document.sessionId);
    input.sessionId = session ? session.id : null;
    if (!session) return;
    if (!session.endedAt) {
      input.status = "conflict";
      input.problem = "its study session is still open";
      return;
    }
    const derived = sessionHistoryDocument(session, session.endedAt, "completed");
    const mismatched = Object.keys({ ...withoutOutcome(derived), ...withoutOutcome(document) })
      .filter(
        (key) =>
          canonicalJson((withoutOutcome(derived) as Record<string, unknown>)[key]) !==
          canonicalJson((withoutOutcome(document) as Record<string, unknown>)[key]),
      )
      .toSorted();
    if (mismatched.length) {
      input.status = "conflict";
      input.problem = `differs from its stored study session: ${mismatched.join(", ")}`;
    } else linked.add(session.id);
  }

  /**
   * Validates everything, then imports in one transaction with its provenance. Rolls back when
   * any input is refused or the source changed while it was read.
   */
  apply(
    source: StudyHistorySource,
    params: {
      kind: StudyHistoryImportReport["kind"];
      expectedFingerprint: string;
      importedAt: string;
      reread?: () => StudyHistorySource;
    },
  ): StudyHistoryImportReport {
    if (source.fingerprint !== params.expectedFingerprint)
      throw new StudyHistoryImportError("Study log source fingerprint differs from expected");
    return this.history.transaction(() => {
      const report = this.inventory(source, params.kind);
      if (!report.ok)
        throw new StudyHistoryImportError(
          report.targetReady
            ? "Study history import refused; nothing was imported"
            : "Target database migrations are not applied",
          report,
        );
      const newSource = (input: StudyHistoryInputReport) =>
        (input.status === "import" || input.status === "deduplicated") &&
        !this.history.findSourceHistoryId(input.sha256);
      // An identical retry changes nothing, not even provenance.
      if (!report.inputs.some(newSource)) return report;
      const importId = this.history.recordImport({
        kind: params.kind,
        sourceFingerprint: source.fingerprint,
        report,
        importedAt: params.importedAt,
      });
      const stored = new Set<string>();
      for (const [index, input] of report.inputs.entries()) {
        const file = source.files[index]!;
        if (input.status === "import") {
          const parsed = parseHistoryDocument(file.bytes.toString("utf8"));
          if (!parsed.ok) throw new StudyHistoryImportError(`Input ${file.name} changed`);
          this.history.insert(
            historyRow(parsed.document, {
              sessionId: input.sessionId ?? null,
              origin: "import",
              recordedAt: params.importedAt,
            }),
          );
        }
        if (newSource(input) && !stored.has(file.sha256)) {
          this.history.insertSource(importId, {
            sha256: file.sha256,
            historyId: input.historyId!,
            sourceName: file.name,
            content: file.bytes,
          });
          stored.add(file.sha256);
        }
      }
      const after = (params.reread ?? (() => readStudyHistorySource(source.root)))();
      if (after.fingerprint !== source.fingerprint)
        throw new StudyHistoryImportError("Study log source changed during import");
      return report;
    });
  }
}

/** Offline composition for the study-history import command, which runs without Nest. */
export function createStudyHistoryImporter(database: Database): StudyHistoryImportService {
  return new StudyHistoryImportService(
    new StudyHistoryRepository(database),
    new StudySessionRepository(database),
  );
}
