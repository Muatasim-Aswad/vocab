import { Body, Controller, Param, Query } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { AppError } from "../../shared/app-error.js";
import { CapturesService } from "./captures.service.js";

function decodeCursor(cursor: string | undefined): { createdAt: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    )
      return { createdAt: value[0], id: value[1] };
  } catch {
    // Reported below.
  }
  throw new AppError("bad_request", { message: "Invalid cursor", reason: "INVALID_CURSOR" });
}

@Controller()
export class CapturesController {
  constructor(private readonly captures: CapturesService) {}

  @Contract(routes.listCaptures)
  list(@Query() query: z.output<typeof routes.listCaptures.query>) {
    if (query.term !== undefined) {
      const item = this.captures.findByTerm(query.term);
      return { items: item ? [item] : [], metadata: { next_cursor: null } };
    }
    const rows = this.captures.list(query.limit + 1, decodeCursor(query.cursor), query.prefix);
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items,
      metadata: {
        next_cursor:
          rows.length > query.limit && last
            ? Buffer.from(JSON.stringify([last.createdAt, last.id])).toString("base64url")
            : null,
      },
    };
  }

  @Contract(routes.getCapture)
  get(@Param() params: z.output<typeof routes.getCapture.params>) {
    return this.captures.findById(params.id);
  }

  @Contract(routes.createCapture)
  create(@Body() body: z.output<typeof routes.createCapture.body>) {
    return this.captures.createWithReceipt(body);
  }

  @Contract(routes.deleteCapture)
  delete(
    @Param() params: z.output<typeof routes.deleteCapture.params>,
    @Body() body: z.output<typeof routes.deleteCapture.body>,
  ) {
    return this.captures.deleteWithReceipt(params.id, body);
  }
}
