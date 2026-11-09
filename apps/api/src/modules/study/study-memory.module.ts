import { Module } from "@nestjs/common";

import { StudyMemoryRepository } from "./study-memory.repository.js";
import { StudyMemoryService } from "./study-memory.service.js";

@Module({
  providers: [StudyMemoryRepository, StudyMemoryService],
  exports: [StudyMemoryRepository, StudyMemoryService],
})
export class StudyMemoryModule {}
