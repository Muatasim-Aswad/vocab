import { Injectable } from "@nestjs/common";
import { entry as entrySchema, routes } from "@vocab/contracts";
import { z } from "zod";

import { MutationReceipts } from "../../infra/db/mutation-receipts.js";
import { AppError } from "../../shared/app-error.js";
import { AiAuditService } from "../ai/ai-audit.service.js";
import { CapturesService } from "../captures/captures.service.js";
import {
  createEntry,
  createEntryWithSenseCueBackfills,
  findEntriesByForm,
  findEntriesByLemma,
  findEntriesByTerm,
  prepareAddTerm,
  type SenseCueBackfill,
} from "./add-entry.js";
import { deleteTerm, resolveDeleteTerm } from "./delete-entry.js";
import { applyEditTerm, resolveEditTerm } from "./edit-entry.js";
import { resolveForms } from "./form-resolution.js";
import { listEntries, type ListEntriesInput } from "./list-entries.js";
import { isPhraseEntry, resolvePartOfSpeechInput, resolveTagInputs } from "./nl/input-inference.js";
import { deduceDutchWordInfo } from "./nl/utils/deduceDutchWordInfo.js";
import { separablePart } from "./nl/utils/separablePart.js";
import { searchEntries, type SearchEntriesOptions } from "./search-entries.js";
import type { CreateVocabEntry, UpdateVocabEntry, VocabEntry } from "./vocab.types.js";
import { SqliteVocabRepository } from "./vocabulary.repository.js";
import { parseTermInput } from "./word-normalization.js";

const detailedEntry = entrySchema.loose().extend({
  meta: entrySchema.shape.meta.loose(),
  memory: entrySchema.shape.memory.unwrap().loose().optional(),
  relations: z.array(entrySchema.shape.relations.unwrap().element.loose()).optional(),
});

/** The contract's entry summary; the article lets linked words display like headwords. */
export function summarizeEntry(entry: VocabEntry) {
  const article = entry.grammar?.article;
  return {
    id: entry.id,
    revision: entry.revision ?? 1,
    lemma: entry.lemma,
    status: entry.status,
    senseCue: entry.senseCue,
    partOfSpeech: entry.partOfSpeech,
    extra: entry.extra,
    ...((article === "de" || article === "het") && { article }),
  };
}

/** Vocabulary operations shared by HTTP and the study feature. */
@Injectable()
export class VocabularyService {
  constructor(
    private readonly repo: SqliteVocabRepository,
    private readonly receipts: MutationReceipts,
    private readonly captures: CapturesService,
    private readonly aiAudit: AiAuditService,
  ) {}

  prepareAddTerm(rawTerm: string) {
    return prepareAddTerm(rawTerm);
  }
  findEntriesByTerm(rawTerm: string) {
    return findEntriesByTerm(rawTerm, this.repo);
  }
  findEntriesByLemma(rawTerm: string) {
    return findEntriesByLemma(rawTerm, this.repo);
  }
  findEntriesByForm(rawTerm: string) {
    return findEntriesByForm(rawTerm, this.repo);
  }
  findEntryById(id: number) {
    return this.repo.findById(id);
  }
  findEntriesByIds(ids: number[]) {
    return this.repo.findByIds(ids);
  }
  createEntry(input: CreateVocabEntry) {
    return createEntry(this.repo, input);
  }
  createEntryWithSenseCueBackfills(input: CreateVocabEntry, backfills: SenseCueBackfill[]) {
    return createEntryWithSenseCueBackfills(this.repo, input, backfills);
  }
  resolveDeleteTerm(input: string) {
    return resolveDeleteTerm(input, this.repo);
  }
  deleteTerm(id: number) {
    return deleteTerm(this.repo, id);
  }
  deleteEntryAtRevision(id: number, expectedRevision: number) {
    const result = this.repo.deleteById(id, expectedRevision);
    if (!result.success || !result.entry)
      throw new AppError("not_found", { message: "Entry not found", reason: "ENTRY_NOT_FOUND" });
    return result.entry;
  }
  resolveEditTerm(input: string) {
    return resolveEditTerm(input, this.repo);
  }
  applyEditTerm(id: number, updateData: UpdateVocabEntry) {
    return applyEditTerm(this.repo, id, updateData);
  }
  listEntries(input: ListEntriesInput) {
    return listEntries(this.repo, input);
  }
  searchEntries(params: { query: string; options: SearchEntriesOptions }) {
    return searchEntries(this.repo, params);
  }

  private consumeCapture(captureId: string | undefined, entry: VocabEntry) {
    if (!captureId) return;
    const capture = this.captures.findById(captureId);
    if (
      entry.status === "stub" ||
      parseTermInput(capture.term).lemma !== parseTermInput(entry.lemma).lemma
    )
      throw new AppError("bad_request", {
        message: "Capture must be completed as an active entry with the same term",
        reason: "CAPTURE_MISMATCH",
      });
    this.captures.delete(captureId);
  }

  detail(entry: VocabEntry | null) {
    if (!entry)
      throw new AppError("not_found", { message: "Entry not found", reason: "ENTRY_NOT_FOUND" });
    const relations = (entry.relations ?? []).flatMap((relation) => {
      const target = this.findEntryById(relation.targetEntryId);
      return target ? [{ type: relation.type, entry: summarizeEntry(target) }] : [];
    });
    const part =
      entry.language === "nl" && entry.grammar?.isSeparable === true
        ? separablePart(entry.lemma, entry.forms)
        : undefined;
    return {
      entry: detailedEntry.parse(entry),
      relations,
      siblings: this.findEntriesByLemma(entry.lemma)
        .filter((other) => other.id !== entry.id)
        .map(summarizeEntry),
      ...(part && { separablePart: part }),
    };
  }

  /** Entries as list rows; a stub, having nothing else to show, carries its related words. */
  listItems(entries: VocabEntry[]) {
    const stubTargets = entries.flatMap((entry) =>
      entry.status === "stub"
        ? (entry.relations ?? []).map((relation) => relation.targetEntryId)
        : [],
    );
    const targets = new Map(
      this.findEntriesByIds([...new Set(stubTargets)]).map((target) => [target.id, target]),
    );
    return entries.map((entry) => {
      const relations =
        entry.status === "stub"
          ? (entry.relations ?? []).flatMap((relation) => {
              const target = targets.get(relation.targetEntryId);
              return target ? [{ type: relation.type, entry: summarizeEntry(target) }] : [];
            })
          : [];
      return {
        ...summarizeEntry(entry),
        examples: entry.examples,
        ...(relations.length && { relations }),
      };
    });
  }

  prepare(body: z.output<typeof routes.prepareEntry.body>) {
    const term = this.prepareAddTerm(body.term);
    const parsed = parseTermInput(term);
    const isMultiWord = isPhraseEntry(term);
    const deduced = isMultiWord ? undefined : deduceDutchWordInfo(term);
    const grammar = {
      ...parsed.grammar,
      ...(deduced?.verbInfo?.isSeparable && { isSeparable: true }),
      ...(deduced?.verbInfo?.irregular && { irregular: true }),
    };
    const matches = this.findEntriesByLemma(term);
    const formOf = this.findEntriesByForm(term).filter(
      (entry) => !matches.some((match) => match.id === entry.id),
    );
    return {
      term,
      matches: this.listItems(matches),
      formOf: this.listItems(formOf),
      inferred: {
        lemma: parsed.lemma,
        isMultiWord,
        ...(Object.keys(grammar).length > 0 && { grammar }),
        ...(deduced?.partOfSpeech && {
          partOfSpeech: resolvePartOfSpeechInput(deduced.partOfSpeech),
        }),
        ...(deduced?.tags && { tags: resolveTagInputs(deduced.tags) }),
        ...(deduced?.verbInfo?.forms && { forms: deduced.verbInfo.forms }),
        ...(deduced?.nounInfo?.forms && { forms: deduced.nounInfo.forms }),
        ...(deduced?.adjectiveInfo?.forms && { forms: deduced.adjectiveInfo.forms }),
      },
    };
  }

  forms(body: z.output<typeof routes.resolveForms.body>) {
    return resolveForms(body);
  }

  create(body: z.output<typeof routes.createEntry.body>) {
    return this.receipts.execute(body.mutationId, "entry:create", body, () => {
      const created = this.createEntryWithSenseCueBackfills(body.entry, body.senseCueBackfills);
      this.consumeCapture(body.captureId, created);
      if (body.ai)
        this.aiAudit.recordSaved(body.ai, {
          mutationId: body.mutationId,
          operation: "create",
          submitted: {
            entry: body.entry,
            senseCueBackfills: body.senseCueBackfills,
            captureId: body.captureId,
          },
          entry: this.findEntryById(created.id) ?? created,
        });
      return this.detail(created);
    });
  }

  update(
    params: z.output<typeof routes.updateEntry.params>,
    body: z.output<typeof routes.updateEntry.body>,
  ) {
    return this.receipts.execute(body.mutationId, `entry:update:${params.id}`, body, () => {
      const previous = body.ai ? this.findEntryById(params.id) : undefined;
      const updated = this.applyEditTerm(params.id, {
        ...body.changes,
        expectedRevision: body.expectedRevision,
      });
      this.consumeCapture(body.captureId, updated);
      if (body.ai)
        this.aiAudit.recordSaved(body.ai, {
          mutationId: body.mutationId,
          operation: "update",
          submitted: {
            entryId: params.id,
            expectedRevision: body.expectedRevision,
            changes: body.changes,
            captureId: body.captureId,
          },
          entry: this.findEntryById(updated.id) ?? updated,
          ...(previous && { previous }),
        });
      return this.detail(updated);
    });
  }

  delete(
    params: z.output<typeof routes.deleteEntry.params>,
    body: z.output<typeof routes.deleteEntry.body>,
  ) {
    return this.receipts.execute(body.mutationId, `entry:delete:${params.id}`, body, () =>
      this.detail(this.deleteEntryAtRevision(params.id, body.expectedRevision)),
    );
  }
}
