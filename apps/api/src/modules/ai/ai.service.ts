import { Inject, Injectable } from "@nestjs/common";
import { aiDraft, type generateBody, type routes } from "@vocab/contracts";
import { v7 as uuidv7 } from "uuid";
import type { z } from "zod";

import { MutationReceipts } from "../../infra/db/mutation-receipts.js";
import { AppError } from "../../shared/app-error.js";
import { VocabularyService } from "../vocabulary/vocabulary.service.js";
import { AiAuditService, type AuditDraft, type AttemptResponse } from "./ai-audit.service.js";
import {
  AI_OPTIONS,
  AI_PROVIDER,
  AI_SLEEP,
  type AiOptions,
  type AiProvider,
} from "./ai.options.js";
import { generationSettings } from "./generation-settings.js";
import {
  meaningMatchInput,
  meaningMatchInputTemplate,
  meaningMatchResponseJsonSchema,
  meaningMatchSystemInstruction,
  type MatchEntry,
} from "./meaning-match-prompt.js";
import { checkMeaningMatch, type MeaningDecision } from "./meaning-match.js";
import { multiwordResponseJsonSchema, multiwordSystemInstruction } from "./multiword-prompt.js";
import { oneWordResponseJsonSchema, oneWordSystemInstruction } from "./one-word-prompt.js";
import { promptInput, promptInputTemplate } from "./prompt-input.js";

const delays = [8000, 16000];
const validatorVersion = "ai-draft-v1";
const matchValidatorVersion = "meaning-match-v1";
const modelDraft = aiDraft.omit({ draftId: true });
type Sleep = (ms: number, signal: AbortSignal) => Promise<void>;
type MatchBody = z.output<typeof routes.matchMeaning.body>;

/** Where a generation stands, so a failure is recorded with its stage and code. */
interface Progress {
  stage: string;
  code: string;
}

interface ProviderRequest {
  generationId: string;
  contents: string;
  systemInstruction: string;
  responseJsonSchema: Record<string, unknown>;
  /** Runs once configuration and capacity allow the call, before the first attempt. */
  onReady: () => void;
}

function property(value: unknown, key: string): unknown {
  return value !== null && typeof value === "object" && key in value
    ? Reflect.get(value, key)
    : undefined;
}

function retryable(error: unknown): boolean {
  const status = property(error, "status");
  const nested = property(error, "error");
  const nestedStatus = property(nested, "status");
  const nestedCode = property(nested, "code");
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("unavailable") ||
    message.includes("overloaded") ||
    message.includes("503") ||
    message.includes("429") ||
    status === "UNAVAILABLE" ||
    status === "RESOURCE_EXHAUSTED" ||
    nestedStatus === "UNAVAILABLE" ||
    nestedStatus === "RESOURCE_EXHAUSTED" ||
    nestedCode === 503 ||
    nestedCode === 429
  );
}

function providerErrorCode(error: unknown): string {
  const nested = property(error, "error");
  const code = property(nested, "code") ?? property(nested, "status") ?? property(error, "status");
  return code === 429 || code === "RESOURCE_EXHAUSTED"
    ? "rate_limited"
    : code === 503 || code === "UNAVAILABLE"
      ? "unavailable"
      : "provider_error";
}

function extractJson(raw: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)\s*```/i.exec(raw);
  const text = fenced?.[1] ?? raw;
  const firstArray = text.indexOf("[");
  const firstObject = text.indexOf("{");
  const start =
    firstArray >= 0 && (firstObject < 0 || firstArray < firstObject) ? firstArray : firstObject;
  const end = start === firstArray ? text.lastIndexOf("]") : text.lastIndexOf("}");
  try {
    return JSON.parse(start >= 0 && end > start ? text.slice(start, end + 1) : text);
  } catch {
    throw new AppError("unavailable", { message: "AI returned invalid JSON", reason: "AI_FAILED" });
  }
}

@Injectable()
export class AiService {
  private active = 0;
  constructor(
    @Inject(AI_OPTIONS) private readonly options: AiOptions,
    @Inject(AI_PROVIDER) private readonly provider: AiProvider,
    @Inject(AI_SLEEP) private readonly sleep: Sleep,
    private readonly vocabulary: VocabularyService,
    private readonly receipts: MutationReceipts,
    private readonly audit: AiAuditService,
  ) {}

  /**
   * Calls the provider within the configured concurrency and timeout, retrying unavailable and
   * rate-limited attempts at 8 and 16 seconds; every attempt is audited.
   */
  private async callProvider(request: ProviderRequest, progress: Progress) {
    if (!this.options.apiKey) {
      progress.stage = "configuration";
      progress.code = "unconfigured";
      throw new AppError("unavailable", {
        message: "AI generation is not configured",
        reason: "AI_UNCONFIGURED",
      });
    }
    if (this.active >= this.options.maxConcurrent) {
      progress.stage = "capacity";
      progress.code = "busy";
      throw new AppError("unavailable", {
        message: "AI generation is busy; retry later",
        reason: "AI_BUSY",
      });
    }
    this.active++;
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error("AI generation timed out")),
      this.options.timeoutMs,
    );
    try {
      request.onReady();
      for (let attempt = 0; ; attempt++) {
        const attemptId = this.audit.startAttempt(request.generationId, attempt + 1, {
          model: this.options.model,
          contents: request.contents,
          config: {
            systemInstruction: request.systemInstruction,
            responseJsonSchema: request.responseJsonSchema,
            ...generationSettings,
          },
        });
        let received: AttemptResponse;
        try {
          progress.stage = "provider";
          progress.code = "provider_error";
          received = await Promise.race([
            this.provider.generate({
              apiKey: this.options.apiKey,
              model: this.options.model,
              contents: request.contents,
              systemInstruction: request.systemInstruction,
              responseJsonSchema: request.responseJsonSchema,
              signal: controller.signal,
            }),
            new Promise<never>((_resolve, reject) =>
              controller.signal.addEventListener("abort", () => reject(controller.signal.reason), {
                once: true,
              }),
            ),
          ]);
        } catch (error) {
          const retry = !controller.signal.aborted && attempt < delays.length && retryable(error);
          progress.code = controller.signal.aborted ? "timeout" : providerErrorCode(error);
          this.audit.failAttempt(attemptId, progress.code, retry);
          if (controller.signal.aborted)
            throw new AppError("unavailable", {
              message: "AI generation timed out",
              reason: "AI_TIMEOUT",
              cause: error,
            });
          if (!retry)
            throw new AppError("unavailable", {
              message: "AI generation failed",
              reason: "AI_FAILED",
              cause: error,
            });
          try {
            await this.sleep(delays[attempt]!, controller.signal);
          } catch (sleepError) {
            if (controller.signal.aborted) {
              progress.code = "timeout";
              throw new AppError("unavailable", {
                message: "AI generation timed out",
                reason: "AI_TIMEOUT",
                cause: sleepError,
              });
            }
            throw sleepError;
          }
          continue;
        }
        this.audit.finishAttempt(attemptId, received);
        return { response: received, attemptId };
      }
    } finally {
      clearTimeout(timer);
      this.active--;
    }
  }

  /** The provider's text as JSON; unparsable text is recorded on its attempt. */
  private parsed(response: AttemptResponse, attemptId: string, progress: Progress): unknown {
    progress.stage = "parsing";
    progress.code = "invalid_json";
    try {
      return extractJson(response.text ?? "");
    } catch (error) {
      this.audit.processing(attemptId, "invalid_json");
      throw error;
    }
  }

  async generate(body: z.output<typeof generateBody>) {
    let generationId: string | undefined;
    let sourceAttemptId: string | null = null;
    const auditDrafts: AuditDraft[] = [];
    let finalOutcome = "success";
    return this.receipts.executeAsync(
      body.requestId,
      "ai:generate",
      body,
      async () => {
        generationId = this.audit.bindAndStart(body.requestId, body);
        const progress: Progress = { stage: "preparation", code: "preparation_failed" };
        try {
          const term = this.vocabulary.prepareAddTerm(body.term);
          const existing = this.vocabulary
            .findEntriesByLemma(term)
            .map((entry) => ({ id: entry.id, lemma: entry.lemma, senseCue: entry.senseCue }));
          this.audit.recordContext(generationId, term, existing);
          if (existing.length && !body.allowExisting) {
            finalOutcome = "short_circuit";
            return { generationId, drafts: [], warnings: [], existing };
          }
          const multiword = term.split(/\s+/).length > 1 && !/^(de|het|zich)\s/i.test(term);
          const prompt = multiword ? multiwordSystemInstruction : oneWordSystemInstruction;
          const schema = multiword ? multiwordResponseJsonSchema : oneWordResponseJsonSchema;
          const id = generationId;
          const { response, attemptId } = await this.callProvider(
            {
              generationId: id,
              contents: promptInput(body),
              systemInstruction: prompt,
              responseJsonSchema: schema,
              onReady: () =>
                this.audit.prepareGeneration(id, term, existing, this.options.model, {
                  kind: multiword ? "multiword" : "single",
                  systemInstruction: prompt,
                  inputTemplate: promptInputTemplate,
                  responseSchema: schema,
                  settings: generationSettings,
                  validatorVersion,
                }),
            },
            progress,
          );
          sourceAttemptId = attemptId;
          const payload = this.parsed(response, attemptId, progress);
          const array = Array.isArray(payload) ? payload : [payload];
          if (!array.length) {
            progress.code = "no_drafts";
            this.audit.processing(attemptId, "no_drafts");
            throw new AppError("unavailable", {
              message: "AI returned no drafts",
              reason: "AI_FAILED",
            });
          }
          progress.stage = "validation";
          progress.code = "invalid_draft";
          const drafts = array.map((item, index) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
              this.audit.processing(attemptId, "invalid_draft", { index, reason: "not_object" });
              throw new AppError("unavailable", {
                message: "AI returned an invalid draft",
                reason: "AI_FAILED",
              });
            }
            const data = Object.fromEntries(Object.entries(item));
            const parsed = modelDraft.safeParse({ ...data, corrected: data.corrected ?? false });
            if (!parsed.success) {
              this.audit.processing(attemptId, "invalid_draft", {
                index,
                issues: parsed.error.issues.map(({ path, code }) => ({ path, code })),
              });
              throw new AppError("unavailable", {
                message: "AI returned an invalid draft",
                reason: "AI_FAILED",
                cause: parsed.error,
              });
            }
            const draftId = uuidv7();
            const returned = { ...parsed.data, draftId };
            auditDrafts.push({ id: draftId, index, parsed: item, returned });
            return returned;
          });
          this.audit.processing(attemptId, "valid");
          return { generationId, drafts, warnings: [], existing };
        } catch (error) {
          this.audit.finishGeneration(generationId, "failure", progress.stage, progress.code);
          if (error instanceof AppError) throw error;
          throw new AppError("unavailable", {
            message: "AI generation failed",
            reason: "AI_FAILED",
            cause: error,
          });
        }
      },
      () =>
        this.audit.completeGeneration(generationId!, sourceAttemptId, auditDrafts, finalOutcome),
    );
  }

  /** The compared entries as the model sees them; each must be a meaning of the draft's term. */
  private matchEntries(body: MatchBody) {
    const lemma = this.vocabulary.prepareAddTerm(body.draft.term);
    const entries = this.vocabulary.findEntriesByIds(body.entryIds);
    if (entries.length !== new Set(body.entryIds).size)
      throw new AppError("not_found", { message: "Entry not found", reason: "ENTRY_NOT_FOUND" });
    const meanings = new Set(this.vocabulary.findEntriesByLemma(lemma).map((entry) => entry.id));
    if (entries.some((entry) => !meanings.has(entry.id)))
      throw new AppError("bad_request", {
        message: "Compared entries must be meanings of the draft's term",
      });
    const relatedIds = entries.flatMap((entry) =>
      (entry.relations ?? []).map((relation) => relation.targetEntryId),
    );
    const related = new Map(
      this.vocabulary.findEntriesByIds([...new Set(relatedIds)]).map((entry) => [entry.id, entry]),
    );
    const shown: MatchEntry[] = entries.map((entry) => {
      const relations = (entry.relations ?? []).flatMap(({ type, targetEntryId }) => {
        const target = related.get(targetEntryId);
        if (!target) return [];
        return [
          {
            type,
            term: target.lemma,
            ...(target.senseCue?.trim() && { senseCue: target.senseCue }),
          },
        ];
      });
      return {
        id: entry.id,
        status: entry.status === "stub" ? "stub" : "active",
        ...(entry.senseCue?.trim() && { senseCue: entry.senseCue }),
        ...(entry.partOfSpeech && { partOfSpeech: entry.partOfSpeech }),
        ...(entry.extra && { extra: entry.extra }),
        ...(entry.examples?.length && { examples: entry.examples }),
        ...(entry.forms?.length && { forms: entry.forms }),
        ...(relations.length && { relations }),
      };
    });
    const compared = entries.map((entry) => ({ id: entry.id, revision: entry.revision ?? 1 }));
    return { lemma: entries[0]!.lemma, shown, compared };
  }

  /**
   * Asks whether a candidate meaning is one of its term's entries or a new meaning, with labels for
   * a new one. Read-only: the decision is a recommendation the client applies through the ordinary
   * entry writes.
   */
  async matchMeaning(body: MatchBody) {
    let generationId: string | undefined;
    let sourceAttemptId: string | undefined;
    let decision: MeaningDecision | undefined;
    return this.receipts.executeAsync(
      body.requestId,
      "ai:meaning-match",
      body,
      async () => {
        if (body.draftId && !this.audit.hasDraft(body.draftId))
          throw new AppError("bad_request", { message: "Unknown AI draft reference" });
        const { lemma, shown, compared } = this.matchEntries(body);
        generationId = this.audit.bindAndStart(body.requestId, body);
        const progress: Progress = { stage: "preparation", code: "preparation_failed" };
        try {
          this.audit.recordContext(generationId, lemma, shown);
          const id = generationId;
          const { response, attemptId } = await this.callProvider(
            {
              generationId: id,
              contents: meaningMatchInput(lemma, body.draft, shown),
              systemInstruction: meaningMatchSystemInstruction,
              responseJsonSchema: meaningMatchResponseJsonSchema,
              onReady: () =>
                this.audit.prepareGeneration(id, lemma, shown, this.options.model, {
                  kind: "meaning-match",
                  systemInstruction: meaningMatchSystemInstruction,
                  inputTemplate: meaningMatchInputTemplate,
                  responseSchema: meaningMatchResponseJsonSchema,
                  settings: generationSettings,
                  validatorVersion: matchValidatorVersion,
                }),
            },
            progress,
          );
          sourceAttemptId = attemptId;
          const payload = this.parsed(response, attemptId, progress);
          progress.stage = "validation";
          progress.code = "invalid_match";
          const checked = checkMeaningMatch(payload, lemma, shown);
          if (!checked.ok) {
            this.audit.processing(attemptId, "invalid_match", { issues: checked.issues });
            throw new AppError("unavailable", {
              message: "AI returned an invalid decision",
              reason: "AI_FAILED",
            });
          }
          this.audit.processing(attemptId, "valid");
          decision = checked.match;
          return { ...checked.match, compared };
        } catch (error) {
          this.audit.finishGeneration(generationId, "failure", progress.stage, progress.code);
          if (error instanceof AppError) throw error;
          throw new AppError("unavailable", {
            message: "AI generation failed",
            reason: "AI_FAILED",
            cause: error,
          });
        }
      },
      () =>
        this.audit.completeMatch(
          generationId!,
          sourceAttemptId!,
          body.draftId,
          decision,
          matchValidatorVersion,
        ),
    );
  }
}
