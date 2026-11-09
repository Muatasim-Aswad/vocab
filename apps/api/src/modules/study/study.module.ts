import { Module } from "@nestjs/common";

import { VocabularyModule } from "../vocabulary/vocabulary.module.js";
import { StudyHistoryRepository } from "./study-history.repository.js";
import { StudyMemoryModule } from "./study-memory.module.js";
import { StudyProjectionRepository } from "./study-projection.repository.js";
import { StudySessionRepository } from "./study-session.repository.js";
import { StudyController } from "./study.controller.js";
import { StudyService } from "./study.service.js";

@Module({
  controllers: [StudyController],
  imports: [VocabularyModule, StudyMemoryModule],
  providers: [
    StudySessionRepository,
    StudyHistoryRepository,
    StudyProjectionRepository,
    StudyService,
  ],
  exports: [StudyService],
})
export class StudyModule {}
