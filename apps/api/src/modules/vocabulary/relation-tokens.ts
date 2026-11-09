import type { RelationshipType } from "./vocab.types.js";
import { formatDisplayTerm, parseTermInput } from "./word-normalization.js";

const EXPLICIT_ID_PATTERN = /^id:(\d+)$/i;

export type ParsedRelationToken =
  | {
      type: RelationshipType;
      raw: string;
      targetEntryId: number;
    }
  | {
      type: RelationshipType;
      raw: string;
      term: string;
    };

function normalizeSpace(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseTypePrefix(rawToken: string): {
  type: RelationshipType;
  rest: string;
} {
  if (rawToken.startsWith("+")) {
    return { type: "synonym", rest: rawToken.slice(1).trim() };
  }
  if (rawToken.startsWith("-")) {
    return { type: "antonym", rest: rawToken.slice(1).trim() };
  }
  if (rawToken.startsWith("~")) {
    // wordFamily = same-language shared root/stem with partial semantic continuity.
    // Not for inflectional forms (those belong in entry.forms).
    return { type: "wordFamily", rest: rawToken.slice(1).trim() };
  }
  if (rawToken.startsWith("^")) {
    // posVariation = same-language relation where the primary contrast is POS/category shift.
    return { type: "posVariation", rest: rawToken.slice(1).trim() };
  }
  return { type: "related", rest: rawToken.trim() };
}

function normalizeRelationLookupTerm(rawTerm: string): string {
  return formatDisplayTerm(parseTermInput(rawTerm)).toLowerCase();
}

export function parseRelatedToken(rawToken: string): ParsedRelationToken | null {
  const trimmed = rawToken.trim();
  if (!trimmed) {
    return null;
  }

  const { type, rest } = parseTypePrefix(trimmed);
  if (!rest) {
    return null;
  }

  const explicitId = rest.match(EXPLICIT_ID_PATTERN);
  if (explicitId) {
    const targetEntryId = Number.parseInt(explicitId[1]!, 10);
    if (targetEntryId <= 0 || !Number.isFinite(targetEntryId)) {
      return null;
    }
    return {
      type,
      raw: trimmed,
      targetEntryId,
    };
  }

  const normalizedTerm = normalizeSpace(rest);
  if (!normalizedTerm) {
    return null;
  }

  return {
    type,
    raw: trimmed,
    term: normalizeRelationLookupTerm(normalizedTerm),
  };
}
