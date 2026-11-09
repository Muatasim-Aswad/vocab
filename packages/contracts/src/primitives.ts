import { z } from "zod";

/** Vocabulary entry ID: a positive safe integer, kept from the existing entry data. */
export const entryId = z.int().positive();

/** UUIDv7 ID for new record types, such as sessions and mutations. */
export const uuidV7 = z.uuid({ version: "v7" });

/** ISO 8601 timestamp in UTC (`Z` suffix, no offset). */
export const utcTimestamp = z.iso.datetime();
