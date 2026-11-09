import { Module } from "@nestjs/common";

import { Database } from "../../infra/db/database.js";
import { AiAuditModule } from "../ai/ai-audit.module.js";
import { CapturesModule } from "../captures/captures.module.js";
import { StudyMemoryModule } from "../study/study-memory.module.js";
import { StudyMemoryService } from "../study/study-memory.service.js";
import { VocabularyController } from "./vocabulary.controller.js";
import { SqliteVocabRepository } from "./vocabulary.repository.js";
import { VocabularyService } from "./vocabulary.service.js";

@Module({
  imports: [AiAuditModule, CapturesModule, StudyMemoryModule],
  controllers: [VocabularyController],
  providers: [
    {
      provide: SqliteVocabRepository,
      useFactory: (database: Database, memory: StudyMemoryService) =>
        new SqliteVocabRepository(database, memory),
      inject: [Database, StudyMemoryService],
    },
    VocabularyService,
  ],
  exports: [VocabularyService],
})
export class VocabularyModule {}
