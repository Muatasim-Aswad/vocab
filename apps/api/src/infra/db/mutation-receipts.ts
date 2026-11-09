import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";

import { AppError } from "../../shared/app-error.js";
import { Database } from "./database.js";

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, part]) => `${JSON.stringify(key)}:${stable(part)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

@Injectable()
export class MutationReceipts {
  private readonly pending = new Map<string, { hash: string; promise: Promise<unknown> }>();
  constructor(private readonly database: Database) {}

  private digest(route: string, body: unknown): string {
    return createHash("sha256").update(stable({ route, body })).digest("hex");
  }

  private existing(id: string, hash: string): unknown {
    const row = this.database.sqlite
      .prepare<[string], { hash: string; response: string }>(
        "SELECT request_hash AS hash, response_json AS response FROM mutation_receipts WHERE mutation_id = ?",
      )
      .get(id);
    if (!row) return undefined;
    if (row.hash !== hash)
      throw new AppError("conflict", {
        message: "Mutation identity was reused with different content",
        reason: "MUTATION_IDENTITY_REUSED",
      });
    return JSON.parse(row.response);
  }

  private restore<T>(value: unknown, _operation: () => T | Promise<T>): T {
    // The persisted hash binds the mutation ID to this route and request; that route owns T.
    // Retain historical response fields exactly, including pre-audit receipts.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    return value as T;
  }

  private save(id: string, hash: string, response: unknown): void {
    this.database.sqlite
      .prepare(
        "INSERT INTO mutation_receipts (mutation_id, request_hash, response_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(id, hash, JSON.stringify(response), new Date().toISOString());
  }

  execute<T>(id: string, route: string, body: unknown, operation: () => T): T {
    const hash = this.digest(route, body);
    return this.database.sqlite.transaction(() => {
      const previous = this.existing(id, hash);
      if (previous !== undefined) return this.restore<T>(previous, operation);
      const response = operation();
      this.save(id, hash, response);
      return response;
    })();
  }

  async executeAsync<T>(
    id: string,
    route: string,
    body: unknown,
    operation: () => Promise<T>,
    commit?: (response: T) => void,
  ): Promise<T> {
    const hash = this.digest(route, body);
    const previous = this.existing(id, hash);
    if (previous !== undefined) return this.restore<T>(previous, operation);
    const inFlight = this.pending.get(id);
    if (inFlight) {
      // A changed-content retry must not receive another request's result.
      if (inFlight.hash !== hash)
        throw new AppError("conflict", {
          message: "Mutation identity was reused with different content",
          reason: "MUTATION_IDENTITY_REUSED",
        });
      return inFlight.promise.then((response) => this.restore<T>(response, operation));
    }
    const task = operation()
      .then((response) => {
        this.database.sqlite.transaction(() => {
          commit?.(response);
          this.save(id, hash, response);
        })();
        return response;
      })
      .finally(() => {
        this.pending.delete(id);
      });
    this.pending.set(id, { hash, promise: task });
    return task;
  }
}
