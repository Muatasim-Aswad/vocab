import type { ApiClient } from "@vocab/api-client";

import type { AiSession, AiSource } from "../aiDraft.ts";
import type { Draft, Preparation } from "../draft.ts";
import type { Problem } from "../errors.ts";
import type { Capture, CreateBody, EntryDetail, UpdateBody } from "../types.ts";

export interface Notice {
  kind:
    | "exists"
    | "meaningsChanged"
    | "reviewRelations"
    | "uncertain"
    | "unauthorized"
    | "rejected"
    | "notSent";
  key?: string;
  requestId?: string;
}

/** A new entry, or an existing one edited in place (completing it when it is a stub). */
export type EntryWrite =
  | { kind: "create"; body: CreateBody }
  | { kind: "edit"; id: number; stub: boolean; body: UpdateBody };

/** A write whose outcome is unknown or in flight; only its exact retry may be sent. */
export type Pending = {
  write: EntryWrite;
  term: string;
  /** The AI suggestion this write saves. */
  suggestion: string | null;
} & ({ status: "saving" } | { status: "uncertain"; problem: Problem } | { status: "unauthorized" });

/** One save lifecycle, including the original payload whenever a write was sent. */
type SaveOperation =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "awaitingLogin" }
  | Pending;

/** The captured term this draft reviews; a successful save removes it in the same write. */
export type CaptureLink = Pick<Capture, "id" | "term">;

export interface DraftState {
  draft: Draft;
  /** The user changed the draft since an entry was opened for editing. */
  changed: boolean;
  /** The term was submitted, so its existing meanings are checked before the fields show. */
  termConfirmed: boolean;
  /** Preparation or edit lookup state, including the failure when a retry is needed. */
  lookup:
    | { status: "idle" }
    | { status: "preparing"; request: object }
    | { status: "failed"; problem: Problem };
  /** The entry chosen for editing is being read. */
  loadingEdit: boolean;
  preparation: Preparation | null;
  /** Revisions of existing meanings when the user started labeling them. */
  meaningBasis: Record<number, number> | null;
  errors: Record<string, string>;
  notice: Notice | null;
  operation: SaveOperation;
  /** The latest save from this draft; the page leaves once it changes. */
  saved: EntryDetail | null;
  capture: CaptureLink | null;
  focus: { id: string; seq: number } | null;
  /** AI suggestions for a term; they outlive saves so the others can still be reviewed. */
  ai: AiSession | null;
  /** The AI suggestion the form holds; the user's own draft has none. */
  aiSource: AiSource | null;
  /** AI was asked for with the term; it is requested once the term is new or gets another meaning. */
  aiRequested: boolean;
  /** Set when the last suggestion is skipped; the page leaves once it changes. */
  aiFinished: object | null;
}

export interface VocabularyState {
  searchOptionsOpen: boolean;
  lastSearch: string;
}

interface SaveOutcome {
  saved: EntryDetail;
  savedAs: "added" | "completed" | "updated";
  /** A capture the API would not consume with this save; it stays in Captures. */
  captureKept: string | null;
}

export interface StoreDeps {
  api: ApiClient;
  onUnauthorized(): void;
  onSaved(outcome: SaveOutcome): void;
}
