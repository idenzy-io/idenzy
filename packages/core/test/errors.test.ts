import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { describe, expect, it } from "vitest";
import {
  InternalError,
  InvalidCredentialsError,
  RateLimitedError,
  ValidationFailedError,
} from "../src/errors/errors.js";
import { isIdenzyError } from "../src/errors/idenzy-error.js";

describe("IdenzyError", () => {
  it("carries a stable code and status", () => {
    const error = new InvalidCredentialsError();
    expect(error.code).toBe(ErrorCode.InvalidCredentials);
    expect(error.status).toBe(401);
    expect(isIdenzyError(error)).toBe(true);
  });

  it("keeps internal detail out of the response body", () => {
    const error = new InvalidCredentialsError({
      detail: { userId: "usr_123", reason: "hash_mismatch" },
    });
    const body = error.toBody("req_1");
    expect(JSON.stringify(body)).not.toContain("usr_123");
    expect(JSON.stringify(body)).not.toContain("hash_mismatch");
    expect(error.detail).toEqual({ userId: "usr_123", reason: "hash_mismatch" });
  });

  it("fixes the internal error message so nothing leaks through the filter", () => {
    const error = new InternalError({ message: "connection to 10.0.0.4 refused" });
    expect(error.message).toBe("An internal error occurred.");
  });

  it("surfaces retryAfterSeconds only when set", () => {
    expect(new RateLimitedError(30).toBody("req_1").error.retryAfterSeconds).toBe(30);
    expect(new ValidationFailedError().toBody("req_1").error.retryAfterSeconds).toBeUndefined();
  });

  it("passes field errors through for validation failures", () => {
    const error = new ValidationFailedError({ fields: [{ path: "email", code: "invalid_email" }] });
    expect(error.toBody("req_1").error.fields).toEqual([{ path: "email", code: "invalid_email" }]);
  });
});
