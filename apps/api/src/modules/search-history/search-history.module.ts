import { Module } from "@nestjs/common";

import { SearchHistoryController } from "./search-history.controller.js";
import { SearchHistoryRepository } from "./search-history.repository.js";
import { SearchHistoryService } from "./search-history.service.js";

@Module({
  controllers: [SearchHistoryController],
  providers: [SearchHistoryRepository, SearchHistoryService],
})
export class SearchHistoryModule {}
