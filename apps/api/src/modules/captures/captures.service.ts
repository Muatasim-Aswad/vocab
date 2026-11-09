import { Injectable } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { MutationReceipts } from "../../infra/db/mutation-receipts.js";
import { AppError } from "../../shared/app-error.js";
import { normalizeTerm } from "../../shared/term.js";
import { CapturesRepository } from "./captures.repository.js";

@Injectable()
export class CapturesService {
  constructor(
    private readonly captures: CapturesRepository,
    private readonly receipts: MutationReceipts,
  ) {}

  createWithReceipt(body: z.output<typeof routes.createCapture.body>) {
    return this.receipts.execute(body.mutationId, "capture:create", body, () =>
      this.create(body.term),
    );
  }

  deleteWithReceipt(id: string, body: z.output<typeof routes.deleteCapture.body>) {
    return this.receipts.execute(body.mutationId, `capture:delete:${id}`, body, () =>
      this.delete(id),
    );
  }

  create(term: string) {
    if (!normalizeTerm(term).key)
      throw new AppError("bad_request", { message: "Term is required" });
    return this.captures.create(term);
  }

  findById(id: string) {
    const capture = this.captures.findById(id);
    if (!capture)
      throw new AppError("not_found", {
        message: "Capture not found",
        reason: "CAPTURE_NOT_FOUND",
      });
    return capture;
  }

  findByTerm(term: string) {
    return this.captures.findByTerm(term);
  }

  list(limit: number, after?: { createdAt: string; id: string }, prefix?: string) {
    return this.captures.list(limit, after, prefix);
  }

  delete(id: string) {
    const capture = this.captures.delete(id);
    if (!capture)
      throw new AppError("not_found", {
        message: "Capture not found",
        reason: "CAPTURE_NOT_FOUND",
      });
    return capture;
  }
}
