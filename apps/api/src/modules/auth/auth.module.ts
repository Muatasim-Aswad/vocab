import { Module, type DynamicModule } from "@nestjs/common";

import { AuthController } from "./auth.controller.js";
import { AUTH_OPTIONS, type AuthOptions } from "./auth.options.js";
import { AuthService } from "./auth.service.js";

@Module({})
export class AuthModule {
  static register(options: AuthOptions): DynamicModule {
    return {
      module: AuthModule,
      controllers: [AuthController],
      providers: [{ provide: AUTH_OPTIONS, useValue: options }, AuthService],
      exports: [AuthService],
    };
  }
}
