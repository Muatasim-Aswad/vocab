import { ApiError } from "@vocab/api-client";
import { describe, expect, it } from "vite-plus/test";

import { describeApiError, legacyCodeOf } from "../src/shared/errors.ts";

describe("API domain errors", () => {
  it("uses the reason regardless of server wording", () => {
    const error = new ApiError({
      error: {
        status: 409,
        code: "conflict",
        reason: "NO_CHANGES",
        message: "Changed wording",
        request_id: "r",
      },
    });
    expect(legacyCodeOf(error)).toBe("NO_CHANGES");
    expect(describeApiError(error)).toBe("No changes made.");
  });
});
