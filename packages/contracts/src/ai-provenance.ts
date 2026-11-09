import { z } from "zod";

import { uuidV7 } from "./primitives.ts";

export const aiProvenance = z.object({
  generationId: uuidV7,
  drafts: z
    .array(
      z.object({ draftId: uuidV7, editableBaseline: z.record(z.string(), z.unknown()).optional() }),
    )
    .min(1),
  adapterVersion: z.string().min(1).optional(),
});
