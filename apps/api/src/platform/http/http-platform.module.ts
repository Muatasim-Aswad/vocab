import { Module, type DynamicModule } from "@nestjs/common";
import { APP_FILTER, APP_INTERCEPTOR } from "@nestjs/core";

import { ContractInterceptor } from "./contract.js";
import { HttpErrorFilter } from "./error.filter.js";
import { OpenApiController } from "./openapi.js";
import { HTTP_OPTIONS, type HttpOptions } from "./options.js";
import { RequestTimeoutInterceptor } from "./request-timeout.interceptor.js";

/** Global HTTP mechanisms: authentication, contract validation, timeouts, error mapping, OpenAPI. */
@Module({})
export class HttpPlatformModule {
  static forRoot(options: HttpOptions): DynamicModule {
    return {
      module: HttpPlatformModule,
      controllers: [OpenApiController],
      providers: [
        { provide: HTTP_OPTIONS, useValue: options },
        { provide: APP_INTERCEPTOR, useClass: RequestTimeoutInterceptor },
        { provide: APP_INTERCEPTOR, useClass: ContractInterceptor },
        { provide: APP_FILTER, useClass: HttpErrorFilter },
      ],
    };
  }
}
