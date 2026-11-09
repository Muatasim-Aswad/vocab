import { Module, type DynamicModule } from "@nestjs/common";

import { VocabularyModule } from "../vocabulary/vocabulary.module.js";
import { AiAuditModule } from "./ai-audit.module.js";
import { AiController } from "./ai.controller.js";
import { AI_OPTIONS, AI_PROVIDER, AI_SLEEP, type AiOptions } from "./ai.options.js";
import { AiService } from "./ai.service.js";
import { GeminiProvider } from "./gemini.provider.js";

@Module({})
export class AiModule {
  static register(options: AiOptions): DynamicModule {
    return {
      module: AiModule,
      imports: [VocabularyModule, AiAuditModule],
      controllers: [AiController],
      providers: [
        { provide: AI_OPTIONS, useValue: options },
        { provide: AI_PROVIDER, useClass: GeminiProvider },
        AiService,
        {
          provide: AI_SLEEP,
          useValue: (ms: number, signal: AbortSignal) =>
            new Promise<void>((resolve, reject) => {
              const timer = setTimeout(resolve, ms);
              signal.addEventListener(
                "abort",
                () => {
                  clearTimeout(timer);
                  reject(signal.reason);
                },
                { once: true },
              );
            }),
        },
      ],
    };
  }
}
