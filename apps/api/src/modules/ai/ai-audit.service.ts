import { Injectable } from "@nestjs/common";

import {
  AiAuditRepository,
  type AiWriteProvenance,
  type AttemptResponse,
  type AuditDraft,
  type PromptRecord,
} from "./ai-audit.repository.js";

export type {
  AiWriteProvenance,
  AttemptResponse,
  AuditDraft,
  PromptRecord,
} from "./ai-audit.repository.js";

@Injectable()
export class AiAuditService {
  constructor(private readonly repo: AiAuditRepository) {}

  bindAndStart(requestId: string, input: unknown): string {
    return this.repo.bindAndStart(requestId, input);
  }
  prepareGeneration(
    id: string,
    preparedTerm: string,
    existing: unknown,
    requestedModel: string,
    prompt: PromptRecord,
  ): void {
    this.repo.prepareGeneration(id, preparedTerm, existing, requestedModel, prompt);
  }
  recordContext(id: string, preparedTerm: string, existing: unknown): void {
    this.repo.recordContext(id, preparedTerm, existing);
  }
  startAttempt(generationId: string, number: number, request: unknown): string {
    return this.repo.startAttempt(generationId, number, request);
  }
  finishAttempt(id: string, response: AttemptResponse): void {
    this.repo.finishAttempt(id, response);
  }
  failAttempt(id: string, code: string, retryable: boolean): void {
    this.repo.failAttempt(id, code, retryable);
  }
  processing(id: string, outcome: string, issues?: unknown): void {
    this.repo.processing(id, outcome, issues);
  }
  finishGeneration(id: string, outcome: string, stage?: string, code?: string): void {
    this.repo.finishGeneration(id, outcome, stage, code);
  }
  completeGeneration(
    id: string,
    attemptId: string | null,
    drafts: AuditDraft[],
    outcome: string,
  ): void {
    this.repo.completeGeneration(id, attemptId, drafts, outcome);
  }
  hasDraft(id: string): boolean {
    return this.repo.hasDraft(id);
  }
  completeMatch(
    id: string,
    attemptId: string,
    draftId: string | undefined,
    match: unknown,
    validatorVersion: string,
  ): void {
    this.repo.completeMatch(id, attemptId, draftId, match, validatorVersion);
  }
  recordSaved(
    provenance: AiWriteProvenance | undefined,
    write: {
      mutationId: string;
      operation: "create" | "update";
      submitted: unknown;
      entry: { id: number; revision?: number };
      previous?: unknown;
    },
  ): void {
    this.repo.recordSaved(provenance, write);
  }
  recordObservedEvent(body: {
    eventId: string;
    draftId: string;
    eventType: "presented" | "skipped";
    editableBaseline?: Record<string, unknown>;
  }): { recorded: true } {
    return this.repo.recordObservedEvent(body);
  }
}
