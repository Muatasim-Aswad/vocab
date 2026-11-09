import { Body, Controller, Param, Query } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { AppError } from "../../shared/app-error.js";
import type { VocabEntry } from "./vocab.types.js";
import { VocabularyService } from "./vocabulary.service.js";

function offset(cursor: string | undefined, key: string): number {
  if (!cursor) return 0;
  try {
    const decoded: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      !("key" in decoded) ||
      decoded.key !== key ||
      !("offset" in decoded) ||
      typeof decoded.offset !== "number" ||
      !Number.isSafeInteger(decoded.offset) ||
      decoded.offset < 0
    )
      throw new Error("bad cursor");
    return decoded.offset;
  } catch {
    throw new AppError("bad_request", { message: "Invalid cursor", reason: "INVALID_CURSOR" });
  }
}

@Controller()
export class VocabularyController {
  constructor(private readonly vocabulary: VocabularyService) {}

  private page(result: { entries: VocabEntry[]; endIndex: number; total: number }, key: string) {
    const next = result.endIndex;
    return {
      items: this.vocabulary.listItems(result.entries),
      total: result.total,
      metadata: {
        next_cursor:
          next < result.total
            ? Buffer.from(JSON.stringify({ offset: next, key })).toString("base64url")
            : null,
      },
    };
  }

  @Contract(routes.searchEntries)
  search(@Query() query: z.output<typeof routes.searchEntries.query>) {
    const key = JSON.stringify([query.query, query.typeFilter, query.includeAllFields]);
    const page = this.vocabulary.searchEntries({
      query: query.query,
      options: {
        cursor: Math.floor(offset(query.cursor, key) / query.limit) + 1,
        limit: query.limit,
        typeFilter: query.typeFilter,
        includeAllFields: query.includeAllFields,
      },
    }).page;
    return this.page(page, key);
  }

  @Contract(routes.listEntries)
  list(@Query() query: z.output<typeof routes.listEntries.query>) {
    const key = JSON.stringify([query.typeFilter, query.order]);
    return this.page(
      this.vocabulary.listEntries({
        cursor: Math.floor(offset(query.cursor, key) / query.limit) + 1,
        limit: query.limit,
        typeFilter: query.typeFilter,
        order: query.order,
      }),
      key,
    );
  }

  @Contract(routes.lookupEntry)
  lookup(@Query() query: z.output<typeof routes.lookupEntry.query>) {
    return this.vocabulary
      .findEntriesByTerm(query.term)
      .map((entry) => this.vocabulary.detail(entry));
  }

  @Contract(routes.getEntry)
  get(@Param() params: z.output<typeof routes.getEntry.params>) {
    return this.vocabulary.detail(this.vocabulary.findEntryById(params.id));
  }

  @Contract(routes.prepareEntry)
  prepare(@Body() body: z.output<typeof routes.prepareEntry.body>) {
    return this.vocabulary.prepare(body);
  }

  @Contract(routes.resolveForms)
  forms(@Body() body: z.output<typeof routes.resolveForms.body>) {
    return this.vocabulary.forms(body);
  }

  @Contract(routes.createEntry)
  create(@Body() body: z.output<typeof routes.createEntry.body>) {
    return this.vocabulary.create(body);
  }

  @Contract(routes.updateEntry)
  update(
    @Param() params: z.output<typeof routes.updateEntry.params>,
    @Body() body: z.output<typeof routes.updateEntry.body>,
  ) {
    return this.vocabulary.update(params, body);
  }

  @Contract(routes.deleteEntry)
  delete(
    @Param() params: z.output<typeof routes.deleteEntry.params>,
    @Body() body: z.output<typeof routes.deleteEntry.body>,
  ) {
    return this.vocabulary.delete(params, body);
  }
}
