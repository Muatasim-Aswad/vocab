import { describe, expect, it } from "vite-plus/test";

import { apiErrorResponse } from "./errors.ts";

const base = { status: 404, code: "not_found", message: "Route not found", request_id: "r1" };

describe("apiErrorResponse", () => {
  it("accepts the minimal error body", () => {
    expect(apiErrorResponse.parse({ error: base })).toEqual({ error: base });
  });

  it("preserves known and future reasons while accepting older responses", () => {
    for (const reason of ["REVISION_CONFLICT", "FUTURE_REASON"]) {
      expect(apiErrorResponse.parse({ error: { ...base, reason } }).error.reason).toBe(reason);
    }
    expect(apiErrorResponse.parse({ error: base }).error.reason).toBeUndefined();
  });

  it("accepts public details and validation issues", () => {
    const body = {
      error: {
        ...base,
        status: 400,
        code: "validation_failed",
        details: { field: "name" },
        issues: [{ path: ["name", 0], message: "Required", code: "invalid_type" }],
      },
    };
    expect(apiErrorResponse.parse(body)).toEqual(body);
  });

  it.each([
    ["an unknown code", { ...base, code: "teapot" }],
    ["a non-error status", { ...base, status: 200 }],
    ["a missing request ID", { status: 404, code: "not_found", message: "x" }],
  ])("rejects %s", (_, error) => {
    expect(apiErrorResponse.safeParse({ error }).success).toBe(false);
  });

  it("rejects Nest's default error shape", () => {
    const nest = { message: "Cannot GET /x", error: "Not Found", statusCode: 404 };
    expect(apiErrorResponse.safeParse(nest).success).toBe(false);
  });
});
