import { Injectable } from "@nestjs/common";
import type { Capture } from "@vocab/contracts";
import { v7 as uuidv7 } from "uuid";

import { Database } from "../../infra/db/database.js";
import { normalizeTerm } from "../../shared/term.js";

const columns = "id, term, created_at AS createdAt";

@Injectable()
export class CapturesRepository {
  constructor(private readonly database: Database) {}

  findById(id: string): Capture | null {
    return (
      this.database.sqlite
        .prepare<[string], Capture>(`SELECT ${columns} FROM captures WHERE id = ?`)
        .get(id) ?? null
    );
  }

  findByTerm(term: string): Capture | null {
    const key = normalizeTerm(term).key;
    return (
      this.database.sqlite
        .prepare<[string], Capture>(`SELECT ${columns} FROM captures WHERE term_key = ?`)
        .get(key) ?? null
    );
  }

  create(term: string): Capture {
    const normalized = normalizeTerm(term);
    const id = uuidv7();
    const createdAt = new Date().toISOString();
    this.database.sqlite
      .prepare(
        "INSERT INTO captures (id, term, term_key, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(term_key) DO NOTHING",
      )
      .run(id, normalized.term, normalized.key, createdAt);
    return this.findByTerm(normalized.term)!;
  }

  /**
   * Newest first; `after` is the last (createdAt, id) of the previous page. A prefix matches the
   * start of the normalized term, with LIKE wildcards in it taken literally.
   */
  list(limit: number, after?: { createdAt: string; id: string }, prefix?: string): Capture[] {
    const conditions = [
      ...(after ? ["(created_at < @createdAt OR (created_at = @createdAt AND id < @id))"] : []),
      ...(prefix === undefined ? [] : ["term_key LIKE @pattern ESCAPE '\\'"]),
    ];
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const pattern =
      prefix === undefined ? undefined : `${normalizeTerm(prefix).key.replace(/[\\%_]/g, "\\$&")}%`;
    return this.database.sqlite
      .prepare<[Record<string, unknown>], Capture>(
        `SELECT ${columns} FROM captures ${where} ORDER BY created_at DESC, id DESC LIMIT @limit`,
      )
      .all({ limit, ...after, ...(pattern !== undefined && { pattern }) });
  }

  delete(id: string): Capture | null {
    const capture = this.findById(id);
    if (capture) this.database.sqlite.prepare("DELETE FROM captures WHERE id = ?").run(id);
    return capture;
  }
}
