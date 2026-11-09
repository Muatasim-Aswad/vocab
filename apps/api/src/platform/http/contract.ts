import {
  applyDecorators,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Patch,
  Post,
  Put,
  SetMetadata,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RouteContract, ValidationIssue } from "@vocab/contracts";
import type { Request } from "express";
import { map, type Observable } from "rxjs";
import type { z } from "zod";

import { AppError, ValidationError } from "../../shared/app-error.js";

const routeContractKey = Symbol("routeContract");

const methodDecorators = { GET: Get, POST: Post, PUT: Put, PATCH: Patch, DELETE: Delete };

/** Binds a handler to its shared route contract: method, path, auth, and validation all come from it. */
export const Contract = (route: RouteContract) =>
  applyDecorators(
    SetMetadata(routeContractKey, route),
    methodDecorators[route.method](route.path),
    HttpCode(200),
  );

export function routeContractOf(
  reflector: Reflector,
  context: ExecutionContext,
): RouteContract | undefined {
  return reflector.get<RouteContract | undefined>(routeContractKey, context.getHandler());
}

function toIssues(error: z.ZodError, prefix: string): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: [prefix, ...issue.path.map((key) => (typeof key === "symbol" ? String(key) : key))],
    message: issue.message,
    code: issue.code,
  }));
}

/** Validates requests against the route contract, then validates and strips responses to it. */
@Injectable()
export class ContractInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const route = routeContractOf(this.reflector, context);
    if (!route) {
      throw new AppError("internal", {
        internal: `${context.getClass().name}.${context.getHandler().name} has no route contract`,
      });
    }

    const req = context.switchToHttp().getRequest<Request>();
    const issues: ValidationIssue[] = [];
    if (route.body) {
      const body = route.body.safeParse(req.body);
      if (body.success) req.body = body.data;
      else issues.push(...toIssues(body.error, "body"));
    }
    if (route.query) {
      const query = route.query.safeParse(req.query);
      // Express 5 exposes `query` as a getter
      if (query.success) Object.defineProperty(req, "query", { value: query.data });
      else issues.push(...toIssues(query.error, "query"));
    }
    if (route.params) {
      const params = route.params.safeParse(req.params);
      if (params.success) Object.defineProperty(req, "params", { value: params.data });
      else issues.push(...toIssues(params.error, "params"));
    }
    if (issues.length) throw new ValidationError(issues);

    return next.handle().pipe(
      map((value: unknown) => {
        const result = route.response.safeParse(value);
        if (result.success) return result.data;
        throw new AppError("internal", {
          internal: "Response does not match its contract",
          details: {
            private: {
              route: `${route.method} ${route.path}`,
              issues: toIssues(result.error, "response"),
            },
          },
        });
      }),
    );
  }
}
