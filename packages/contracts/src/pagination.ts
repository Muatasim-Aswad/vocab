import { z } from "zod";

/** Cursor page: `{ items, metadata: { next_cursor } }`; `next_cursor` is `null` at the end. */
export const cursorPage = <Item extends z.ZodType>(item: Item) =>
  z.object({
    items: z.array(item),
    metadata: z.object({
      next_cursor: z.string().nullable(),
    }),
  });
