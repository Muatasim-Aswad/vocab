import { ApiError, ApiNetworkError, ApiResponseError } from "@vocab/api-client";
import { describe, expect, it } from "vite-plus/test";

import { describeError, mayHaveCommitted } from "./errors.ts";

const apiError = (
  status: number,
  code: ApiError["code"],
  message: string,
  issues?: ApiError["issues"],
  reason?: string,
) =>
  new ApiError({
    error: {
      status,
      code,
      message,
      request_id: "req-7",
      ...(reason && { reason }),
      ...(issues && { issues }),
    },
  });

describe("API error presentation", () => {
  it("maps stable vocabulary reasons to localized keys and fields", () => {
    expect(
      describeError(apiError(409, "conflict", "Changed wording", undefined, "SENSE_CUE_DUPLICATE")),
    ).toEqual({
      key: "vocab.error.labelDuplicate",
      field: "senseCue",
      requestId: "req-7",
    });
    expect(
      describeError(apiError(409, "conflict", "Changed wording", undefined, "REVISION_CONFLICT")),
    ).toMatchObject({
      key: "vocab.error.meaningsChanged",
      field: "meanings",
    });
  });

  it("maps validation paths and unknown codes without exposing server text", () => {
    expect(
      describeError(
        apiError(400, "validation_failed", "Request validation failed", [
          { path: ["entry", "lemma"], message: "Too small" },
        ]),
      ),
    ).toEqual({ key: "vocab.error.invalid", field: "term", requestId: "req-7" });
    expect(describeError(apiError(503, "unavailable", "Anything"))).toEqual({
      key: "vocab.error.code.unavailable",
      requestId: "req-7",
    });
    expect(describeError(new ApiNetworkError("down")).key).toBe("vocab.error.network");
    expect(describeError(new DOMException("slow", "TimeoutError")).key).toBe("vocab.error.timeout");
  });

  it("treats only rejected contract errors as certainly not committed", () => {
    expect(mayHaveCommitted(apiError(409, "conflict", "x"))).toBe(false);
    expect(mayHaveCommitted(apiError(401, "unauthorized", "x"))).toBe(false);
    expect(mayHaveCommitted(apiError(500, "internal", "x"))).toBe(true);
    expect(mayHaveCommitted(new ApiNetworkError("lost"))).toBe(true);
    expect(mayHaveCommitted(new ApiResponseError("bad", 200, "r"))).toBe(true);
    expect(mayHaveCommitted(new DOMException("slow", "TimeoutError"))).toBe(true);
  });
});
