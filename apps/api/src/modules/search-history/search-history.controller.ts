import { Body, Controller, Query } from "@nestjs/common";
import { routes } from "@vocab/contracts";
import type { z } from "zod";

import { Contract } from "../../platform/http/contract.js";
import { SearchHistoryService } from "./search-history.service.js";

@Controller()
export class SearchHistoryController {
  constructor(private readonly history: SearchHistoryService) {}

  @Contract(routes.listRecentSearches)
  recent(@Query() query: z.output<typeof routes.listRecentSearches.query>) {
    return { terms: this.history.recent(query.limit) };
  }

  @Contract(routes.recordSearch)
  record(@Body() body: z.output<typeof routes.recordSearch.body>) {
    return this.history.record(body);
  }

  @Contract(routes.clearSearchHistory)
  clear(@Body() body: z.output<typeof routes.clearSearchHistory.body>) {
    return this.history.clear(body);
  }
}
