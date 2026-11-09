import { Injectable } from "@nestjs/common";
import { studyHistoryDocument } from "@vocab/contracts";

import { Database } from "../../infra/db/database.js";
import type { StudyHistoryDocument, StudyHistoryRow } from "./study-history.js";

export type StoredStudyHistory = Omit<StudyHistoryRow, "documentJson"> & {
  document: StudyHistoryDocument;
};

export type StudyHistorySource = {
  sha256: string;
  historyId: string;
  sourceName: string;
  content: Buffer;
};

type Row = {
  id: string;
  sessionId: string | null;
  origin: "api" | "import";
  schemaVersion: number;
  startedAt: string;
  endedAt: string | null;
  outcome: StudyHistoryRow["outcome"];
  reviewCount: number;
  documentJson: string;
  recordedAt: string;
};

const columns =
  "id, session_id AS sessionId, origin, schema_version AS schemaVersion, started_at AS startedAt, ended_at AS endedAt, outcome, review_count AS reviewCount, document_json AS documentJson, recorded_at AS recordedAt";

const stored = ({ documentJson, ...row }: Row): StoredStudyHistory => ({
  ...row,
  document: studyHistoryDocument.parse(JSON.parse(documentJson)),
});

/** Study-owned persistence for final history records and their import provenance. */
@Injectable()
export class StudyHistoryRepository {
  constructor(private readonly database: Database) {}

  insert(row: StudyHistoryRow): void {
    this.database.sqlite
      .prepare(
        "INSERT INTO study_history (id, session_id, origin, schema_version, started_at, ended_at, outcome, review_count, document_json, recorded_at) VALUES (@id, @sessionId, @origin, @schemaVersion, @startedAt, @endedAt, @outcome, @reviewCount, @documentJson, @recordedAt)",
      )
      .run(row);
  }

  findById(id: string): StoredStudyHistory | null {
    const row = this.database.sqlite
      .prepare<[string], Row>(`SELECT ${columns} FROM study_history WHERE id = ?`)
      .get(id);
    return row ? stored(row) : null;
  }

  findBySessionId(sessionId: string): StoredStudyHistory | null {
    const row = this.database.sqlite
      .prepare<[string], Row>(`SELECT ${columns} FROM study_history WHERE session_id = ?`)
      .get(sessionId);
    return row ? stored(row) : null;
  }

  /** Newest first; `after` is the last (startedAt, id) of the previous page. */
  list(limit: number, after?: { startedAt: string; id: string }): StoredStudyHistory[] {
    const rows = after
      ? this.database.sqlite
          .prepare<[{ startedAt: string; id: string; limit: number }], Row>(
            `SELECT ${columns} FROM study_history WHERE started_at < @startedAt OR (started_at = @startedAt AND id < @id) ORDER BY started_at DESC, id DESC LIMIT @limit`,
          )
          .all({ ...after, limit })
      : this.database.sqlite
          .prepare<[number], Row>(
            `SELECT ${columns} FROM study_history ORDER BY started_at DESC, id DESC LIMIT ?`,
          )
          .all(limit);
    return rows.map(stored);
  }

  findSourceHistoryId(sha256: string): string | null {
    const row = this.database.sqlite
      .prepare<[string], { historyId: string }>(
        "SELECT history_id AS historyId FROM study_history_sources WHERE sha256 = ?",
      )
      .get(sha256);
    return row?.historyId ?? null;
  }

  recordImport(params: {
    kind: "legacy" | "server-logs";
    sourceFingerprint: string;
    report: unknown;
    importedAt: string;
  }): number {
    return Number(
      this.database.sqlite
        .prepare(
          "INSERT INTO study_history_imports (kind, source_fingerprint, report_json, imported_at) VALUES (?, ?, ?, ?)",
        )
        .run(
          params.kind,
          params.sourceFingerprint,
          JSON.stringify(params.report),
          params.importedAt,
        ).lastInsertRowid,
    );
  }

  insertSource(importId: number, source: StudyHistorySource): void {
    this.database.sqlite
      .prepare(
        "INSERT INTO study_history_sources (sha256, history_id, import_id, source_name, size, content) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        source.sha256,
        source.historyId,
        importId,
        source.sourceName,
        source.content.length,
        source.content,
      );
  }

  /** Ended sessions that have no final history record, oldest first. */
  endedSessionsWithoutHistory(): Array<{ id: string; startedAt: string; endedAt: string }> {
    return this.database.sqlite
      .prepare<[], { id: string; startedAt: string; endedAt: string }>(
        "SELECT s.id, s.started_at AS startedAt, s.ended_at AS endedAt FROM study_sessions s LEFT JOIN study_history h ON h.session_id = s.id WHERE s.ended_at IS NOT NULL AND h.id IS NULL ORDER BY s.started_at, s.id",
      )
      .all();
  }

  /** False until the history migrations are applied. */
  ready(): boolean {
    return Boolean(
      this.database.sqlite
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'study_history'")
        .get(),
    );
  }

  transaction<T>(operation: () => T): T {
    return this.database.sqlite.transaction(operation)();
  }
}
