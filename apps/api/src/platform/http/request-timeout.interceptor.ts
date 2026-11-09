import {
  Inject,
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { catchError, throwError, timeout, TimeoutError, type Observable } from "rxjs";

import { AppError } from "../../shared/app-error.js";
import { routeContractOf } from "./contract.js";
import { HTTP_OPTIONS, type HttpOptions } from "./options.js";

/** Bounds asynchronous handler work. Synchronous work (SQLite queries) cannot be preempted. */
@Injectable()
export class RequestTimeoutInterceptor implements NestInterceptor {
  constructor(
    @Inject(HTTP_OPTIONS) private readonly options: HttpOptions,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      timeout(routeContractOf(this.reflector, context)?.timeoutMs ?? this.options.requestTimeoutMs),
      catchError((error: unknown) =>
        throwError(() =>
          error instanceof TimeoutError
            ? new AppError("unavailable", {
                message: "Request timed out",
                internal: "Handler timeout",
                cause: error,
              })
            : error,
        ),
      ),
    );
  }
}
