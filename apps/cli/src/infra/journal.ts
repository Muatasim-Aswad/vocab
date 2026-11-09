import { readFileSync } from "node:fs";

import type { ApiClient } from "@vocab/api-client";

import { configCopy } from "./config-copy.ts";
import { ConfigFileError, writePrivateJson } from "./config.ts";

type JournalFields = { mutationId: string; label: string; createdAt: string };
type CreateCapture = { route: "createCapture"; body: Parameters<ApiClient["createCapture"]>[0] };
type CreateEntry = { route: "createEntry"; body: Parameters<ApiClient["createEntry"]>[0] };
type UpdateEntry = {
  route: "updateEntry";
  target: number;
  body: Parameters<ApiClient["updateEntry"]>[1];
};
type DeleteEntry = {
  route: "deleteEntry";
  target: number;
  body: Parameters<ApiClient["deleteEntry"]>[1];
};
type StartStudy = { route: "startStudy"; body: Parameters<ApiClient["startStudy"]>[0] };
type AnswerStudy = {
  route: "answerStudy";
  target: string;
  body: Parameters<ApiClient["answerStudy"]>[1];
};
type EndStudy = { route: "endStudy"; target: string; body: Parameters<ApiClient["endStudy"]>[1] };

/** A write whose outcome is not yet confirmed; replayed with the same identity and body. */
export type PendingWrite = JournalFields &
  (CreateCapture | CreateEntry | UpdateEntry | DeleteEntry | StartStudy | AnswerStudy | EndStudy);

/** File-backed list of unconfirmed writes, so a restart cannot turn a retry into a duplicate. */
export class PendingJournal {
  constructor(private readonly path: string) {}

  list(): PendingWrite[] {
    let text: string;
    try {
      text = readFileSync(this.path, "utf8");
    } catch (error) {
      if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT")
        return [];
      throw new ConfigFileError(configCopy.readFailed(this.path), { cause: error });
    }
    try {
      const value = JSON.parse(text) as unknown;
      if (!Array.isArray(value)) throw new Error("not an array");
      // The CLI writes its own typed requests; keep the original body for exact replay.
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return value as PendingWrite[];
    } catch (error) {
      throw new ConfigFileError(configCopy.invalidJournal(this.path), {
        cause: error,
      });
    }
  }

  add(write: PendingWrite): void {
    writePrivateJson(this.path, [
      ...this.list().filter((item) => item.mutationId !== write.mutationId),
      write,
    ]);
  }

  remove(mutationId: string): void {
    const remaining = this.list().filter((item) => item.mutationId !== mutationId);
    writePrivateJson(this.path, remaining);
  }
}
