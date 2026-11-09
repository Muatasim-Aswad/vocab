import { Module } from "@nestjs/common";

import { CapturesController } from "./captures.controller.js";
import { CapturesRepository } from "./captures.repository.js";
import { CapturesService } from "./captures.service.js";

@Module({
  controllers: [CapturesController],
  providers: [CapturesRepository, CapturesService],
  exports: [CapturesService],
})
export class CapturesModule {}
