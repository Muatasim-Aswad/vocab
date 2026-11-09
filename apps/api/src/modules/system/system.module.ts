import { Module, type DynamicModule } from "@nestjs/common";

import { SystemController } from "./system.controller.js";
import { SYSTEM_OPTIONS, type SystemOptions } from "./system.options.js";
import { SystemService } from "./system.service.js";

/** Liveness, readiness, and application status. */
@Module({})
export class SystemModule {
  static register(options: SystemOptions): DynamicModule {
    return {
      module: SystemModule,
      controllers: [SystemController],
      providers: [{ provide: SYSTEM_OPTIONS, useValue: options }, SystemService],
    };
  }
}
