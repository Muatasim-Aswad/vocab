import { z } from "zod";

import { utcTimestamp, uuidV7 } from "./primitives.ts";

export const recentSearchesQuery = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
/** Distinct terms searched since the latest clear, newest first, in their latest spelling. */
export const recentSearches = z.object({ terms: z.array(z.string()) });
/** IDs and times come from the client, so retries and replays append nothing new. */
export const searchRecord = z.object({
  id: uuidV7,
  term: z.string().min(1),
  searchedAt: utcTimestamp,
});
export const searchHistoryClear = z.object({ id: uuidV7, clearedAt: utcTimestamp });
