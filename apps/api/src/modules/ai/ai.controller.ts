import { Body, Controller } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { AiAuditService } from "./ai-audit.service.js";
import { AiService } from "./ai.service.js";

@Controller()
export class AiController {
  constructor(
    private readonly ai: AiService,
    private readonly audit: AiAuditService,
  ) {}
  @Contract(routes.generateDraft)
  generate(@Body() body: z.output<typeof routes.generateDraft.body>) {
    return this.ai.generate(body);
  }

  @Contract(routes.matchMeaning)
  matchMeaning(@Body() body: z.output<typeof routes.matchMeaning.body>) {
    return this.ai.matchMeaning(body);
  }

  @Contract(routes.recordAiDraftEvent)
  recordEvent(@Body() body: z.output<typeof routes.recordAiDraftEvent.body>) {
    return this.audit.recordObservedEvent(body);
  }
}
