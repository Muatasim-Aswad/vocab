import { Module, type DynamicModule } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import type { AppConfig } from "./config.js";
import { DatabaseModule } from "./infra/db/database.module.js";
import { AiModule } from "./modules/ai/ai.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AuthService } from "./modules/auth/auth.service.js";
import { CapturesModule } from "./modules/captures/captures.module.js";
import { SearchHistoryModule } from "./modules/search-history/search-history.module.js";
import { StudyModule } from "./modules/study/study.module.js";
import { SystemModule } from "./modules/system/system.module.js";
import { VocabularyModule } from "./modules/vocabulary/vocabulary.module.js";
import { HttpPlatformModule } from "./platform/http/http-platform.module.js";
import { AUTH_CAPABILITY, SessionAuthGuard } from "./platform/http/session-auth.guard.js";

/** Composition root: wires configuration into infrastructure, platform, and feature modules. */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        DatabaseModule.forRoot(config.database),
        AuthModule.register({
          apiToken: config.http.apiToken,
          // Container listeners bind all interfaces even when browser access is loopback-only.
          cookieSecure:
            config.http.publicOrigin?.startsWith("https://") === true ||
            config.http.allowedHosts.some(
              (host) => !["127.0.0.1", "localhost", "[::1]"].includes(host),
            ),
          corsOrigins: config.http.corsOrigins,
          publicOrigin: config.http.publicOrigin,
        }),
        HttpPlatformModule.forRoot({ version: config.version, ...config.http }),
        SystemModule.register({ version: config.version }),
        VocabularyModule,
        CapturesModule,
        SearchHistoryModule,
        StudyModule,
        AiModule.register(config.ai),
      ],
      providers: [
        { provide: AUTH_CAPABILITY, useExisting: AuthService },
        { provide: APP_GUARD, useClass: SessionAuthGuard },
      ],
    };
  }
}
