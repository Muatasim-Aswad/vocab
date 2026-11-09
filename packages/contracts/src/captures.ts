import { z } from "zod";

import { cursorPage } from "./pagination.ts";
import { utcTimestamp, uuidV7 } from "./primitives.ts";

export const capture = z.object({
  id: uuidV7,
  term: z.string(),
  createdAt: utcTimestamp,
});

export const capturePage = cursorPage(capture);
export const captureIdParams = z.object({ id: uuidV7 });
export const listCapturesQuery = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  /** Exact term match after case and whitespace normalization. */
  term: z.string().min(1).optional(),
  /** Terms starting with this text after case and whitespace normalization; pages like the full list. */
  prefix: z.string().min(1).optional(),
});
export const createCaptureBody = z.object({ mutationId: uuidV7, term: z.string().min(1) });
export const deleteCaptureBody = z.object({ mutationId: uuidV7 });

export type Capture = z.output<typeof capture>;
