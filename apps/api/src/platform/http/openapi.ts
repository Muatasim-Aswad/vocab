import { Controller, Inject } from "@nestjs/common";
import { apiErrorResponse, requestIdHeader, routes, type RouteContract } from "@vocab/contracts";
import { z } from "zod";

import { Contract } from "./contract.js";
import { HTTP_OPTIONS, type HttpOptions } from "./options.js";

const schema = (type: z.ZodType) => z.toJSONSchema(type, { io: "output", unrepresentable: "any" });

const errorResponse = {
  description: "Error",
  headers: { [requestIdHeader]: { $ref: "#/components/headers/RequestId" } },
  content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
};

function queryParameters(query: z.ZodType) {
  const { properties = {}, required = [] } = schema(query) as {
    properties?: Record<string, unknown>;
    required?: string[];
  };
  return Object.entries(properties).map(([name, property]) => ({
    in: "query",
    name,
    required: required.includes(name),
    schema: property,
  }));
}

function operation(route: RouteContract) {
  return {
    summary: route.summary,
    ...(route.auth === "bearer" && { security: [{ bearer: [] }] }),
    ...(route.auth === "either" && { security: [{ bearer: [] }, { sessionCookie: [] }] }),
    ...(route.query && { parameters: queryParameters(route.query) }),
    ...(route.params && {
      parameters: [
        ...(route.query ? queryParameters(route.query) : []),
        ...queryParameters(route.params).map((parameter) => ({
          ...parameter,
          in: "path",
          required: true,
        })),
      ],
    }),
    ...(route.body && {
      requestBody: {
        required: true,
        content: { "application/json": { schema: schema(route.body) } },
      },
    }),
    responses: {
      200: {
        description: "Success",
        headers: { [requestIdHeader]: { $ref: "#/components/headers/RequestId" } },
        content: { "application/json": { schema: schema(route.response) } },
      },
      default: errorResponse,
    },
  };
}

/** OpenAPI 3.1 document derived from the shared route contracts. */
export function openApiDocument(version: string) {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const route of Object.values(routes) as RouteContract[]) {
    (paths[route.path] ??= {})[route.method.toLowerCase()] = operation(route);
  }
  return {
    openapi: "3.1.0",
    info: { title: "Vocab API", version },
    paths,
    components: {
      schemas: { ApiError: schema(apiErrorResponse) },
      headers: { RequestId: { description: "Request correlation ID", schema: { type: "string" } } },
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        sessionCookie: { type: "apiKey", in: "cookie", name: "vocab_session" },
      },
    },
  };
}

@Controller()
export class OpenApiController {
  private readonly document: ReturnType<typeof openApiDocument>;

  constructor(@Inject(HTTP_OPTIONS) options: HttpOptions) {
    this.document = openApiDocument(options.version);
  }

  @Contract(routes.openapi)
  get() {
    return this.document;
  }
}
