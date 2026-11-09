import { Module } from "@nestjs/common";

import { AiAuditRepository } from "./ai-audit.repository.js";
import { AiAuditService } from "./ai-audit.service.js";

@Module({
  providers: [AiAuditRepository, AiAuditService],
  exports: [AiAuditService],
})
export class AiAuditModule {}
