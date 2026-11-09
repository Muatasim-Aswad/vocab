import type {
  CreateVocabEntry,
  EntryListOrder,
  GenericLangSpec,
  PaginatedVocabEntryResult,
  Result,
  SearchQueryOptions,
  UpdateVocabEntry,
  VocabEntry,
} from "./vocab.types.js";

export interface VocabRepositoryPort<S extends GenericLangSpec = GenericLangSpec> {
  terms: string[];
  findByLemma(
    lemma: string,
    options?: {
      excludeId?: number;
    },
  ): VocabEntry<S>[];
  findByForm(form: string): VocabEntry<S>[];
  findByTerm(term: string): VocabEntry<S>[];
  findById(id: number): VocabEntry<S> | null;
  findByIds(ids: number[]): VocabEntry<S>[];
  findLast(): VocabEntry<S> | null;
  search(query: string, options?: SearchQueryOptions): PaginatedVocabEntryResult<S>;
  create(data: CreateVocabEntry<S>): Result<S>;
  createWithSenseCueBackfills(
    data: CreateVocabEntry<S>,
    backfills: Array<{ id: number; expectedRevision: number; senseCue: string }>,
  ): Result<S>;
  updateById(id: number, updateData: UpdateVocabEntry<S>): Result<S>;
  deleteById(id: number): Result<S>;
  paginate(options?: {
    cursor?: number;
    limit?: number;
    typeFilter?: string;
    order?: EntryListOrder;
  }): PaginatedVocabEntryResult<S>;
}
