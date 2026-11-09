import { Body, Controller, Param, Query } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { AppError } from "../../shared/app-error.js";
import type { StoredStudyHistory } from "./study-history.repository.js";
import { StudyService } from "./study.service.js";

const historySummary = ({
  document: _document,
  schemaVersion: _version,
  ...row
}: StoredStudyHistory) => row;

/** Opaque keyset cursor over (startedAt, id), newest first. */
function historyCursor(cursor: string | undefined): { startedAt: string; id: string } | undefined {
  if (!cursor) return undefined;
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as unknown;
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    )
      return { startedAt: value[0], id: value[1] };
  } catch {
    // Reported below.
  }
  throw new AppError("bad_request", { message: "Invalid cursor", reason: "INVALID_CURSOR" });
}

@Controller()
export class StudyController {
  constructor(private readonly study: StudyService) {}

  @Contract(routes.studyInventory)
  inventory() {
    return this.study.getStudyInventory();
  }

  @Contract(routes.startStudy)
  start(@Body() body: z.output<typeof routes.startStudy.body>) {
    return this.study.start(body);
  }

  @Contract(routes.getStudy)
  get(@Param() params: z.output<typeof routes.getStudy.params>) {
    const session = this.study.findStudySession(params.id);
    if (!session) throw new AppError("not_found", { message: "Study session not found" });
    return this.study.response(session);
  }

  @Contract(routes.answerStudy)
  answer(
    @Param() params: z.output<typeof routes.answerStudy.params>,
    @Body() body: z.output<typeof routes.answerStudy.body>,
  ) {
    return this.study.answer(params, body);
  }

  @Contract(routes.endStudy)
  end(
    @Param() params: z.output<typeof routes.endStudy.params>,
    @Body() body: z.output<typeof routes.endStudy.body>,
  ) {
    return this.study.end(params, body);
  }

  @Contract(routes.listStudyHistory)
  history(@Query() query: z.output<typeof routes.listStudyHistory.query>) {
    const rows = this.study.listStudyHistory(query.limit + 1, historyCursor(query.cursor));
    const items = rows.slice(0, query.limit);
    const last = items.at(-1);
    return {
      items: items.map(historySummary),
      metadata: {
        next_cursor:
          rows.length > query.limit && last
            ? Buffer.from(JSON.stringify([last.startedAt, last.id])).toString("base64url")
            : null,
      },
    };
  }

  @Contract(routes.getStudyHistory)
  historyRecord(@Param() params: z.output<typeof routes.getStudyHistory.params>) {
    const record = this.study.findStudyHistory(params.id);
    if (!record) throw new AppError("not_found", { message: "Study history record not found" });
    return { ...historySummary(record), document: record.document };
  }
}
