import { randomBytes } from "node:crypto";

import {
  ApiError,
  ApiNetworkError,
  ApiResponseError,
  createApiClient,
  type ApiClient,
  type AuthenticatedRequestOptions,
} from "@vocab/api-client";
import type { Entry } from "@vocab/contracts";

import { formatDisplayTerm, type EntryLookup } from "../shared/display-term.ts";
import {
  CliError,
  describeApiError,
  pageOutOfRangeMessage,
  type ErrorContext,
} from "../shared/errors.ts";
import { apiCopy } from "./api-copy.ts";
import type { Connection } from "./config.ts";
import { type PendingJournal, type PendingWrite } from "./journal.ts";

export type { Entry };
export type EntryDetail = Awaited<ReturnType<ApiClient["getEntry"]>>;
type EntrySummary = EntryDetail["siblings"][number];
export type EntryInput = Parameters<ApiClient["createEntry"]>[0]["entry"];
export type EntryChanges = Parameters<ApiClient["updateEntry"]>[1]["changes"];
export type PreparedEntry = Awaited<ReturnType<ApiClient["prepareEntry"]>>;
export type FormsResolution = Awaited<ReturnType<ApiClient["resolveForms"]>>;
export type StudySession = Awaited<ReturnType<ApiClient["startStudy"]>>;
export type StudyInventory = Awaited<ReturnType<ApiClient["studyInventory"]>>;
export type AnswerResult = Awaited<ReturnType<ApiClient["answerStudy"]>>;
export type GeneratedDrafts = Awaited<ReturnType<ApiClient["generateDraft"]>>;
export type Capture = Awaited<ReturnType<ApiClient["createCapture"]>>;
type AnswerBody = Parameters<ApiClient["answerStudy"]>[1];

/** UUIDv7: 48-bit millisecond time, version and variant bits, random remainder. */
function uuidV7(now: number = Date.now()): string {
  const bytes = randomBytes(16);
  bytes.writeUIntBE(now, 0, 6);
  bytes[6] = (bytes[6]! & 0x0f) | 0x70;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export type VocabApiOptions = {
  connection: () => Connection;
  /** Where the user fixes the token; named in authentication messages. */
  connectionHint: string;
  journal: PendingJournal;
  notify: (message: string) => void;
  fetch?: typeof fetch;
  newId?: () => string;
  /** Delays between automatic retries of an unconfirmed write. */
  retryDelaysMs?: readonly number[];
  requestTimeoutMs?: number;
  aiTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

export type CapturePageResult = {
  captures: Capture[];
  page: number;
  limit: number;
  startIndex: number;
  hasMore: boolean;
};

export type PageResult = {
  entries: EntrySummary[];
  total: number;
  page: number;
  limit: number;
  startIndex: number;
  endIndex: number;
};

/** Loaded entries for rendering: relation targets and same-term meanings, fetched in parallel. */
export type DisplayContext = { resolve: EntryLookup; siblingsOf: (entry: Entry) => Entry[] };

const retryableCodes = new Set(["unavailable", "rate_limited"]);

/** The CLI's only route to vocabulary data: `@vocab/api-client` with bearer auth and write reconciliation. */
export class VocabApi {
  private readonly fetchFn: typeof fetch | undefined;
  private readonly newId: () => string;
  private readonly retryDelaysMs: readonly number[];
  private readonly requestTimeoutMs: number;
  private readonly aiTimeoutMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: VocabApiOptions) {
    this.fetchFn = options.fetch;
    this.newId = options.newId ?? (() => uuidV7());
    this.retryDelaysMs = options.retryDelaysMs ?? [300, 1000, 3000];
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.aiTimeoutMs = options.aiTimeoutMs ?? 100_000;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  get apiUrl(): string {
    return this.options.connection().apiUrl;
  }

  hasToken(): boolean {
    return Boolean(this.options.connection().token);
  }

  private translate(error: unknown, connection: Connection, context: ErrorContext): CliError {
    if (error instanceof CliError) return error;
    if (error instanceof ApiError) {
      if (error.code === "unauthorized")
        return new CliError(
          apiCopy.rejectedToken(connection.apiUrl, this.options.connectionHint),
          "auth",
          { apiError: error },
        );
      if (retryableCodes.has(error.code))
        return new CliError(error.message, "network", { apiError: error });
      return new CliError(describeApiError(error, context), "api", { apiError: error });
    }
    if (error instanceof ApiResponseError)
      return new CliError(apiCopy.unexpectedResponse(connection.apiUrl, error.status), "network", {
        cause: error,
      });
    if (
      error instanceof ApiNetworkError ||
      (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError"))
    )
      return new CliError(apiCopy.unreachable(connection.apiUrl), "network", { cause: error });
    throw error;
  }

  private async call<T>(
    run: (client: ApiClient, options: AuthenticatedRequestOptions) => Promise<T>,
    context: ErrorContext = {},
    timeoutMs = this.requestTimeoutMs,
  ): Promise<T> {
    const connection = this.options.connection();
    if (!connection.token)
      throw new CliError(apiCopy.missingToken(this.options.connectionHint), "auth");
    const client = createApiClient({ baseUrl: connection.apiUrl, fetch: this.fetchFn });
    try {
      return await run(client, { token: connection.token, signal: AbortSignal.timeout(timeoutMs) });
    } catch (error) {
      throw this.translate(error, connection, context);
    }
  }

  status() {
    return this.call((client, options) => client.status(options));
  }

  /** `null` when the entry does not exist. */
  async getEntry(id: number, context: ErrorContext = {}): Promise<EntryDetail | null> {
    try {
      return await this.call((client, options) => client.getEntry(id, options), { id, ...context });
    } catch (error) {
      if (error instanceof CliError && error.apiError?.code === "not_found") return null;
      throw error;
    }
  }

  lookup(term: string): Promise<EntryDetail[]> {
    return this.call((client, options) => client.lookupEntry(term, options), { term });
  }

  prepare(term: string): Promise<PreparedEntry> {
    return this.call((client, options) => client.prepareEntry({ term }, options), {
      term,
      operation: "add",
    });
  }

  resolveForms(body: Parameters<ApiClient["resolveForms"]>[0]): Promise<FormsResolution> {
    return this.call((client, options) => client.resolveForms(body, options));
  }

  studyInventory(): Promise<StudyInventory> {
    return this.call((client, options) => client.studyInventory(options), { operation: "study" });
  }

  /** Full entries for summaries, fetched concurrently and returned in input order. */
  async fullEntries(ids: readonly number[]): Promise<Entry[]> {
    const details = await Promise.all(ids.map((id) => this.getEntry(id)));
    return details.flatMap((detail) => (detail ? [detail.entry] : []));
  }

  /** Relation targets (and optionally same-term meanings) for rendering, loaded in one parallel wave. */
  async displayContext(
    entries: readonly Entry[],
    options: { siblings?: boolean } = {},
  ): Promise<DisplayContext> {
    const byId = new Map<number, Entry>(entries.map((entry) => [entry.id, entry]));
    const targetIds = [
      ...new Set(
        entries.flatMap((entry) =>
          (entry.relations ?? []).map((relation) => relation.targetEntryId),
        ),
      ),
    ].filter((id) => !byId.has(id));
    const terms = options.siblings
      ? [...new Set(entries.map((entry) => formatDisplayTerm(entry)))]
      : [];
    const [targets, siblingLists] = await Promise.all([
      this.fullEntries(targetIds),
      Promise.all(terms.map((term) => this.lookup(term))),
    ]);
    for (const target of targets) byId.set(target.id, target);
    const siblings = new Map(
      terms.map((term, index) => [term, siblingLists[index]!.map((detail) => detail.entry)]),
    );
    return {
      resolve: (id) => byId.get(id) ?? null,
      siblingsOf: (entry) => siblings.get(formatDisplayTerm(entry)) ?? [],
    };
  }

  /**
   * Legacy page `page` of `limit` rows. Cursors are opaque, so the CLI walks them from the start;
   * API pages hold at most 100 rows.
   */
  async page(
    kind: "list" | "search",
    params: { query?: string; typeFilter?: string; includeAllFields?: boolean },
    page: number | undefined,
    limit: number,
    context: ErrorContext,
  ): Promise<PageResult> {
    const current = page ?? 1;
    const apiLimit = Math.min(limit, 100);
    const start = (current - 1) * limit;
    const end = start + limit;
    const entries: EntrySummary[] = [];
    let offset = 0;
    let cursor: string | undefined;
    let total = 0;
    while (true) {
      const query = {
        limit: apiLimit,
        ...(cursor && { cursor }),
        ...(params.typeFilter && { typeFilter: params.typeFilter }),
      };
      const result = await this.call(
        (client, options) =>
          kind === "list"
            ? client.listEntries(query, options)
            : client.searchEntries(
                {
                  ...query,
                  query: params.query ?? "",
                  includeAllFields: params.includeAllFields ?? false,
                },
                options,
              ),
        context,
      );
      total = result.total;
      for (const item of result.items) {
        if (offset >= start && offset < end) entries.push(item);
        offset += 1;
      }
      if (offset >= end || !result.metadata.next_cursor) break;
      cursor = result.metadata.next_cursor;
    }
    if (entries.length === 0 && page !== undefined && total > 0)
      throw new CliError(pageOutOfRangeMessage(current, total, limit, kind), "api");
    return {
      entries,
      total,
      page: current,
      limit,
      startIndex: start,
      endIndex: start + entries.length,
    };
  }

  /** Captures page `page` of `limit` rows, newest first, walking the opaque cursors from the start. */
  async capturePage(page: number | undefined, limit: number): Promise<CapturePageResult> {
    const current = page ?? 1;
    const start = (current - 1) * limit;
    const end = start + limit;
    const captures: Capture[] = [];
    let offset = 0;
    let cursor: string | undefined;
    let hasMore = false;
    while (true) {
      const result = await this.call(
        (client, options) =>
          client.listCaptures({ limit: Math.min(limit, 100), ...(cursor && { cursor }) }, options),
        { operation: "captures" },
      );
      for (const item of result.items) {
        if (offset >= start && offset < end) captures.push(item);
        offset += 1;
      }
      if (offset >= end) {
        hasMore = offset > end || Boolean(result.metadata.next_cursor);
        break;
      }
      if (!result.metadata.next_cursor) break;
      cursor = result.metadata.next_cursor;
    }
    if (captures.length === 0 && page !== undefined && offset > 0)
      throw new CliError(
        apiCopy.capturePage(current, Math.ceil(offset / limit), offset, limit),
        "api",
      );
    return { captures, page: current, limit, startIndex: start, hasMore };
  }

  private dispatch(write: PendingWrite): Promise<unknown> {
    return this.call<unknown>((client, options) => {
      switch (write.route) {
        case "createCapture":
          return client.createCapture(write.body, options);
        case "createEntry":
          return client.createEntry(write.body, options);
        case "updateEntry":
          return client.updateEntry(write.target, write.body, options);
        case "deleteEntry":
          return client.deleteEntry(write.target, write.body, options);
        case "startStudy":
          return client.startStudy(write.body, options);
        case "answerStudy":
          return client.answerStudy(write.target, write.body, options);
        case "endStudy":
          return client.endStudy(write.target, write.body, options);
        default:
          throw new Error("Unknown pending write route");
      }
    });
  }

  /** Sends a journaled write, retrying unconfirmed outcomes with the same identity. */
  private async deliver<T>(
    write: PendingWrite,
    context: ErrorContext,
    delays: readonly number[],
    send: () => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await send();
        this.options.journal.remove(write.mutationId);
        return result;
      } catch (error) {
        const failure =
          error instanceof CliError
            ? error
            : this.translate(error, this.options.connection(), context);
        if (failure.kind === "api") {
          this.options.journal.remove(write.mutationId);
          const apiError = failure.apiError;
          throw apiError
            ? new CliError(describeApiError(apiError, context), "api", { apiError })
            : failure;
        }
        if (failure.kind === "auth")
          throw new CliError(apiCopy.keptForAuth(failure.message, write.label), "auth", {
            cause: failure,
            journaled: true,
          });
        const delay = delays[attempt];
        if (delay !== undefined) {
          await this.sleep(delay);
          continue;
        }
        throw new CliError(apiCopy.notConfirmed(failure.message, write.label), "network", {
          cause: failure,
          journaled: true,
        });
      }
    }
  }

  /** Retries every unconfirmed write in order; stops at the first one that stays unconfirmed. */
  async reconcilePending(): Promise<boolean> {
    for (const write of this.options.journal.list()) {
      try {
        await this.deliver(write, {}, [], () => this.dispatch(write));
        this.options.notify(apiCopy.confirmed(write.label));
      } catch (error) {
        if (!(error instanceof CliError)) throw error;
        if (error.kind === "api") {
          this.options.notify(apiCopy.rejected(write.label, error.message));
          continue;
        }
        return false;
      }
    }
    return true;
  }

  hasPending(): boolean {
    return this.options.journal.list().length > 0;
  }

  private async write<T>(
    write: PendingWrite,
    context: ErrorContext,
    send: (client: ApiClient, options: AuthenticatedRequestOptions) => Promise<T>,
  ): Promise<T> {
    const { label } = write;
    if (this.hasPending() && !(await this.reconcilePending())) {
      const blocking = this.options.journal.list()[0]!;
      this.options.journal.add(write);
      throw new CliError(apiCopy.queued(blocking.label, label), "network", { journaled: true });
    }
    this.options.journal.add(write);
    return this.deliver(write, context, this.retryDelaysMs, () => this.call(send, context));
  }

  /** Appends to the server's search history. Best effort: never journaled, never throws. */
  async recordSearch(term: string): Promise<void> {
    const search = { id: this.newId(), term, searchedAt: new Date().toISOString() };
    try {
      await this.call((client, options) => client.recordSearch(search, options));
    } catch {
      // A lost history entry must not hold back searching or queued vocabulary writes.
    }
  }

  /** Saves a term for later review; the API reuses an existing capture of the same term. */
  createCapture(term: string): Promise<Capture> {
    const body = { mutationId: this.newId(), term };
    return this.write(
      {
        route: "createCapture",
        body,
        mutationId: body.mutationId,
        label: apiCopy.captureLabel(term),
        createdAt: new Date().toISOString(),
      },
      {
        operation: "capture",
        term,
      },
      (client, options) => client.createCapture(body, options),
    );
  }

  createEntry(
    entry: EntryInput,
    senseCueBackfills: Array<{ id: number; expectedRevision: number; senseCue: string }>,
    context: ErrorContext = {},
  ): Promise<EntryDetail> {
    const body = { mutationId: this.newId(), entry, senseCueBackfills };
    return this.write(
      {
        route: "createEntry",
        body,
        mutationId: body.mutationId,
        label: apiCopy.addLabel(entry.lemma),
        createdAt: new Date().toISOString(),
      },
      {
        operation: "add",
        ...context,
      },
      (client, options) => client.createEntry(body, options),
    );
  }

  updateEntry(
    id: number,
    expectedRevision: number,
    changes: EntryChanges,
    context: ErrorContext = {},
  ): Promise<EntryDetail> {
    const body = { mutationId: this.newId(), expectedRevision, changes };
    return this.write(
      {
        route: "updateEntry",
        target: id,
        body,
        mutationId: body.mutationId,
        label: apiCopy.editLabel(id),
        createdAt: new Date().toISOString(),
      },
      {
        operation: "edit",
        id,
        ...context,
      },
      (client, options) => client.updateEntry(id, body, options),
    );
  }

  deleteEntry(
    id: number,
    expectedRevision: number,
    context: ErrorContext = {},
  ): Promise<EntryDetail> {
    const body = { mutationId: this.newId(), expectedRevision };
    return this.write(
      {
        route: "deleteEntry",
        target: id,
        body,
        mutationId: body.mutationId,
        label: apiCopy.deleteLabel(id),
        createdAt: new Date().toISOString(),
      },
      {
        operation: "delete",
        id,
        ...context,
      },
      (client, options) => client.deleteEntry(id, body, options),
    );
  }

  startStudy(selection: {
    maxWords: number;
    startId?: number;
    endId?: number;
  }): Promise<StudySession> {
    const body = { mutationId: this.newId(), ...selection };
    return this.write(
      {
        route: "startStudy",
        body,
        mutationId: body.mutationId,
        label: apiCopy.studyStartLabel,
        createdAt: new Date().toISOString(),
      },
      { operation: "study" },
      (client, options) => client.startStudy(body, options),
    );
  }

  answerStudy(sessionId: string, answer: Omit<AnswerBody, "mutationId">): Promise<AnswerResult> {
    const body = { mutationId: this.newId(), ...answer };
    return this.write(
      {
        route: "answerStudy",
        target: sessionId,
        body,
        mutationId: body.mutationId,
        label: apiCopy.studyAnswerLabel(answer.entryId),
        createdAt: new Date().toISOString(),
      },
      {
        operation: "study",
      },
      (client, options) => client.answerStudy(sessionId, body, options),
    );
  }

  endStudy(
    sessionId: string,
    expectedRevision: number,
    outcome: "completed" | "quit",
  ): Promise<StudySession> {
    const body = { mutationId: this.newId(), expectedRevision, outcome };
    return this.write(
      {
        route: "endStudy",
        target: sessionId,
        body,
        mutationId: body.mutationId,
        label: apiCopy.studyEndLabel,
        createdAt: new Date().toISOString(),
      },
      { operation: "study" },
      (client, options) => client.endStudy(sessionId, body, options),
    );
  }

  /** AI drafts are not saved, but the request identity still makes a lost response safe to repeat. */
  async generateDraft(term: string, allowExisting: boolean): Promise<GeneratedDrafts> {
    const requestId = this.newId();
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.call(
          (client, options) => client.generateDraft({ requestId, term, allowExisting }, options),
          { term },
          this.aiTimeoutMs,
        );
      } catch (error) {
        const delay = this.retryDelaysMs[attempt];
        if (
          !(error instanceof CliError) ||
          error.kind !== "network" ||
          error.apiError ||
          delay === undefined
        )
          throw error;
        await this.sleep(delay);
      }
    }
  }
}
