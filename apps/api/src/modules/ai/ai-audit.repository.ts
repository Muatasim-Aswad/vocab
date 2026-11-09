import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { v7 as uuidv7 } from "uuid";

import { Database } from "../../infra/db/database.js";
import { AppError } from "../../shared/app-error.js";

const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value);
const hash = (value: unknown) => createHash("sha256").update(json(value)).digest("hex");

export interface PromptRecord {
  kind: "single" | "multiword" | "meaning-match";
  systemInstruction: string;
  inputTemplate: string;
  responseSchema: Record<string, unknown>;
  settings: { temperature: number; responseMimeType: string };
  validatorVersion: string;
}

export interface AttemptResponse {
  text: string | null;
  envelope: unknown;
  returnedModel?: string;
  providerResponseId?: string;
  finishReason?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  cachedTokens?: number;
}

export interface AuditDraft {
  id: string;
  index: number;
  parsed: unknown;
  returned: unknown;
}

export interface AiWriteProvenance {
  generationId: string;
  drafts: Array<{ draftId: string; editableBaseline?: Record<string, unknown> }>;
  adapterVersion?: string;
}

@Injectable()
export class AiAuditRepository {
  constructor(private readonly database: Database) {}

  bindAndStart(requestId: string, input: unknown): string {
    return this.database.sqlite.transaction(() => {
      const inputHash = hash(input);
      const existing = this.database.sqlite
        .prepare<[string], { inputHash: string }>(
          "SELECT input_hash AS inputHash FROM ai_requests WHERE request_id = ?",
        )
        .get(requestId);
      if (existing && existing.inputHash !== inputHash)
        throw new AppError("conflict", {
          message: "Mutation identity was reused with different content",
          reason: "MUTATION_IDENTITY_REUSED",
        });
      if (!existing)
        this.database.sqlite
          .prepare(
            "INSERT INTO ai_requests (request_id, input_json, input_hash, created_at) VALUES (?, ?, ?, ?)",
          )
          .run(requestId, json(input), inputHash, now());
      const next = this.database.sqlite
        .prepare<[string], { number: number }>(
          "SELECT COALESCE(MAX(execution_number), 0) + 1 AS number FROM ai_generations WHERE request_id = ?",
        )
        .get(requestId)!;
      const id = uuidv7();
      this.database.sqlite
        .prepare(
          "INSERT INTO ai_generations (id, request_id, execution_number, started_at, outcome) VALUES (?, ?, ?, ?, 'running')",
        )
        .run(id, requestId, next.number, now());
      return id;
    })();
  }

  prepareGeneration(
    id: string,
    preparedTerm: string,
    existing: unknown,
    requestedModel: string,
    prompt: PromptRecord,
  ): void {
    const sha = hash(prompt);
    this.database.sqlite.transaction(() => {
      this.database.sqlite
        .prepare(
          "INSERT OR IGNORE INTO ai_prompt_versions (sha256, kind, system_instruction, input_template, response_schema_json, settings_json, validator_version, first_used_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          sha,
          prompt.kind,
          prompt.systemInstruction,
          prompt.inputTemplate,
          json(prompt.responseSchema),
          json(prompt.settings),
          prompt.validatorVersion,
          now(),
        );
      this.database.sqlite
        .prepare(
          "UPDATE ai_generations SET prepared_term = ?, existing_context_json = ?, requested_model = ?, prompt_sha256 = ? WHERE id = ?",
        )
        .run(preparedTerm, json(existing), requestedModel, sha, id);
    })();
  }

  recordContext(id: string, preparedTerm: string, existing: unknown): void {
    this.database.sqlite
      .prepare(
        "UPDATE ai_generations SET prepared_term = ?, existing_context_json = ? WHERE id = ?",
      )
      .run(preparedTerm, json(existing), id);
  }

  startAttempt(generationId: string, number: number, request: unknown): string {
    const id = uuidv7();
    this.database.sqlite
      .prepare(
        "INSERT INTO ai_provider_attempts (id, generation_id, attempt_number, request_json, started_at, outcome) VALUES (?, ?, ?, ?, ?, 'running')",
      )
      .run(id, generationId, number, json(request), now());
    return id;
  }

  finishAttempt(id: string, response: AttemptResponse): void {
    this.database.sqlite
      .prepare(
        "UPDATE ai_provider_attempts SET response_text = ?, response_json = ?, returned_model = ?, provider_response_id = ?, finish_reason = ?, input_tokens = ?, output_tokens = ?, thinking_tokens = ?, cached_tokens = ?, finished_at = ?, outcome = 'response' WHERE id = ?",
      )
      .run(
        response.text,
        json(response.envelope),
        response.returnedModel ?? null,
        response.providerResponseId ?? null,
        response.finishReason ?? null,
        response.inputTokens ?? null,
        response.outputTokens ?? null,
        response.thinkingTokens ?? null,
        response.cachedTokens ?? null,
        now(),
        id,
      );
  }

  failAttempt(id: string, code: string, retryable: boolean): void {
    this.database.sqlite
      .prepare(
        "UPDATE ai_provider_attempts SET finished_at = ?, outcome = 'error', error_code = ?, retryable = ? WHERE id = ?",
      )
      .run(now(), code, retryable ? 1 : 0, id);
  }

  processing(id: string, outcome: string, issues?: unknown): void {
    this.database.sqlite
      .prepare(
        "UPDATE ai_provider_attempts SET processing_outcome = ?, validation_issues_json = ? WHERE id = ?",
      )
      .run(outcome, issues === undefined ? null : json(issues), id);
  }

  finishGeneration(id: string, outcome: string, stage?: string, code?: string): void {
    this.database.sqlite
      .prepare(
        "UPDATE ai_generations SET finished_at = ?, outcome = ?, error_stage = ?, error_code = ? WHERE id = ?",
      )
      .run(now(), outcome, stage ?? null, code ?? null, id);
  }

  completeGeneration(
    id: string,
    attemptId: string | null,
    drafts: AuditDraft[],
    outcome: string,
  ): void {
    if (attemptId) {
      const generation = this.database.sqlite
        .prepare<[string], { promptSha: string }>(
          "SELECT prompt_sha256 AS promptSha FROM ai_generations WHERE id = ?",
        )
        .get(id)!;
      const prompt = this.database.sqlite
        .prepare<[string], { version: string }>(
          "SELECT validator_version AS version FROM ai_prompt_versions WHERE sha256 = ?",
        )
        .get(generation.promptSha)!;
      const insert = this.database.sqlite.prepare(
        "INSERT INTO ai_drafts (id, generation_id, attempt_id, draft_index, draft_json, parsed_json, validator_version) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const draft of drafts)
        insert.run(
          draft.id,
          id,
          attemptId,
          draft.index,
          json(draft.returned),
          json(draft.parsed),
          prompt.version,
        );
    }
    this.finishGeneration(id, outcome);
  }

  hasDraft(id: string): boolean {
    return (
      this.database.sqlite.prepare("SELECT 1 FROM ai_drafts WHERE id = ?").get(id) !== undefined
    );
  }

  completeMatch(
    id: string,
    attemptId: string,
    draftId: string | undefined,
    match: unknown,
    validatorVersion: string,
  ): void {
    this.database.sqlite
      .prepare(
        "INSERT INTO ai_meaning_matches (generation_id, attempt_id, draft_id, match_json, validator_version) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, attemptId, draftId ?? null, json(match), validatorVersion);
    this.finishGeneration(id, "success");
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
    if (!provenance) return;
    for (const draft of provenance.drafts) {
      const exists = this.database.sqlite
        .prepare("SELECT 1 FROM ai_drafts WHERE id = ? AND generation_id = ?")
        .get(draft.draftId, provenance.generationId);
      if (!exists) throw new AppError("bad_request", { message: "Unknown AI draft reference" });
      this.database.sqlite
        .prepare(
          "INSERT INTO ai_draft_events (id, draft_id, event_type, mutation_id, operation, observed_at, editable_baseline_json, submitted_json, entry_id, revision_before, revision_after, previous_entry_json, persisted_entry_json) VALUES (?, ?, 'saved', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          uuidv7(),
          draft.draftId,
          write.mutationId,
          write.operation,
          now(),
          draft.editableBaseline === undefined ? null : json(draft.editableBaseline),
          json({ adapterVersion: provenance.adapterVersion, payload: write.submitted }),
          write.entry.id,
          write.previous && typeof write.previous === "object" && "revision" in write.previous
            ? write.previous.revision
            : null,
          write.entry.revision ?? 1,
          write.previous === undefined ? null : json(write.previous),
          json(write.entry),
        );
    }
  }

  recordObservedEvent(body: {
    eventId: string;
    draftId: string;
    eventType: "presented" | "skipped";
    editableBaseline?: Record<string, unknown>;
  }): { recorded: true } {
    const fingerprint = hash(body);
    return this.database.sqlite.transaction(() => {
      const previous = this.database.sqlite
        .prepare<[string], { eventHash: string }>(
          "SELECT event_hash AS eventHash FROM ai_draft_events WHERE client_event_id = ?",
        )
        .get(body.eventId);
      if (previous) {
        if (previous.eventHash !== fingerprint)
          throw new AppError("conflict", {
            message: "Event identity was reused with different content",
          });
        return { recorded: true as const };
      }
      if (!this.database.sqlite.prepare("SELECT 1 FROM ai_drafts WHERE id = ?").get(body.draftId))
        throw new AppError("bad_request", { message: "Unknown AI draft reference" });
      this.database.sqlite
        .prepare(
          "INSERT INTO ai_draft_events (id, draft_id, event_type, client_event_id, event_hash, observed_at, editable_baseline_json) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          uuidv7(),
          body.draftId,
          body.eventType,
          body.eventId,
          fingerprint,
          now(),
          body.editableBaseline === undefined ? null : json(body.editableBaseline),
        );
      return { recorded: true as const };
    })();
  }
}
