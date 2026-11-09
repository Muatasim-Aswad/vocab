import type { CaptureLink } from "./store.ts";

/** An entry ID from a route parameter, or undefined when it is not a positive safe integer. */
export function parseEntryId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

export const entryPath = (id: number) => `/entries/${id}`;
export const entryEditPath = (id: number) => `/entries/${id}/edit`;

export function isCaptureLink(value: unknown): value is CaptureLink {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "term" in value &&
    typeof value.term === "string"
  );
}
