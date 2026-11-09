import { studyHistoryDocument, type StudyHistoryDocument } from "@vocab/contracts";

export type { StudyHistoryDocument };
type StudyHistoryOutcome = "completed" | "quit" | "error";

type HistorySourceSession = {
  id: string;
  startedAt: string;
  state: {
    sessionWords: Array<{ id: number; lemma: string; priority: number | null }>;
    selection: StudyHistoryDocument["selection"];
    reviews: StudyHistoryDocument["reviews"];
    stats: object;
  };
};

/** Columns derived once from an immutable document; the document stays the authoritative record. */
export type StudyHistoryRow = {
  id: string;
  sessionId: string | null;
  origin: "api" | "import";
  schemaVersion: number;
  startedAt: string;
  endedAt: string | null;
  outcome: StudyHistoryOutcome | null;
  reviewCount: number;
  documentJson: string;
  recordedAt: string;
};

/** Key-order independent JSON, used to compare documents semantically. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, part]) => part !== undefined)
      .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, part]) => `${JSON.stringify(key)}:${canonicalJson(part)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** The schema-v2 document for an ended durable session, in the legacy log's field layout. */
export function sessionHistoryDocument(
  session: HistorySourceSession,
  endedAt: string,
  outcome: "completed" | "quit",
): StudyHistoryDocument {
  return {
    schemaVersion: 2,
    sessionId: session.id,
    startedAt: session.startedAt,
    endedAt,
    selection: session.state.selection,
    sortResult: session.state.sessionWords.map((word) => ({
      id: word.id,
      term: word.lemma,
      priority: word.priority,
    })),
    reviews: session.state.reviews,
    stats: { ...session.state.stats },
    outcome: { status: outcome },
  };
}

export type ParsedHistoryDocument =
  | { ok: true; document: StudyHistoryDocument }
  | { ok: false; problem: string };

/** Validates one historical JSON log; unknown fields are kept, unsupported shapes are refused. */
export function parseHistoryDocument(text: string): ParsedHistoryDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, problem: "not valid JSON" };
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ok: false, problem: "not a JSON object" };
  if ((value as { schemaVersion?: unknown }).schemaVersion !== 2)
    return { ok: false, problem: "unsupported schemaVersion (expected 2)" };
  const parsed = studyHistoryDocument.safeParse(value);
  if (!parsed.success)
    return {
      ok: false,
      problem: parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "document"}: ${issue.message}`)
        .join("; "),
    };
  // The parse result must equal the input exactly, so nothing was coerced or dropped.
  if (canonicalJson(parsed.data) !== canonicalJson(value))
    return { ok: false, problem: "document would not round-trip unchanged" };
  return { ok: true, document: parsed.data };
}

export function historyRow(
  document: StudyHistoryDocument,
  params: { sessionId: string | null; origin: "api" | "import"; recordedAt: string },
): StudyHistoryRow {
  return {
    id: document.sessionId,
    sessionId: params.sessionId,
    origin: params.origin,
    schemaVersion: document.schemaVersion,
    startedAt: document.startedAt,
    endedAt: document.endedAt ?? null,
    outcome: document.outcome?.status ?? null,
    reviewCount: document.reviews.length,
    documentJson: JSON.stringify(document),
    recordedAt: params.recordedAt,
  };
}
