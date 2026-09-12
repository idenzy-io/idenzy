import { ErrorCode } from "@idenzy/protocol/errors/codes";
import { describe, expect, it } from "vitest";
import {
  isRefusal,
  managementMessage,
  refusalIn,
  signInMessage,
} from "../../app/utils/sign-in-errors";

/**
 * Reading a refusal back into the shape the error contract promises.
 *
 * The panel is the first customer of that contract (PROJECT.md 3.3), and this is the seam
 * where it either holds or quietly does not: a failed fetch hands its caller a status line,
 * and a status line carries no code — so a screen that never reads the body says "something
 * went wrong" about a refusal the server explained exactly.
 */
describe("refusalIn", () => {
  const body = { error: { code: "conflict", message: "That hostname is already claimed." } };

  it("reads the document out of a body that was already parsed", () => {
    expect(refusalIn(body)?.code).toBe("conflict");
    expect(refusalIn(body)?.message).toBe("That hostname is already claimed.");
  });

  /* The delete path: success is an empty 204, so those calls never ask for JSON and their
     refusals arrive as text. */
  it("reads it out of text, for a call that did not ask for JSON", () => {
    expect(refusalIn(JSON.stringify(body))?.code).toBe("conflict");
  });

  it("answers null for a status line, which is what a failed fetch offers by default", () => {
    expect(refusalIn("Conflict")).toBeNull();
    expect(refusalIn("Internal Server Error")).toBeNull();
  });

  it("answers null for anything that is not the contract's shape", () => {
    expect(refusalIn(null)).toBeNull();
    expect(refusalIn({ message: "no code here" })).toBeNull();
    expect(refusalIn({ error: "a string, not a document" })).toBeNull();
    expect(refusalIn({ error: { message: "no code" } })).toBeNull();
    expect(refusalIn("<html>a proxy answered</html>")).toBeNull();
  });
});

describe("managementMessage", () => {
  it("says what the code means rather than what the server wrote", () => {
    const refusal = { code: ErrorCode.InsufficientScope, message: "role too junior" };
    expect(managementMessage(refusal)).toBe("Your role on this organisation does not allow that.");
  });

  it("falls back to one sentence for a code it does not know", () => {
    expect(managementMessage({ code: "some_code_from_a_newer_api" })).toBe(
      "Something went wrong. Try again.",
    );
  });

  /* A network failure, an abort, a thrown string: a handler that has already failed must not
     fail again working out what to say. */
  it("tolerates anything at all, including nothing", () => {
    expect(managementMessage("Failed to fetch")).toBe("Something went wrong. Try again.");
    expect(managementMessage(null)).toBe("Something went wrong. Try again.");
    expect(managementMessage(new Error("boom"))).toBe("Something went wrong. Try again.");
  });

  it("is a different vocabulary from a refused sign-in, which is why there are two", () => {
    const refusal = { code: ErrorCode.ValidationFailed };
    expect(managementMessage(refusal)).not.toBe(signInMessage(refusal));
  });
});

describe("isRefusal", () => {
  it("lets a dialog recognise the one refusal it has its own sentence for", () => {
    expect(isRefusal({ code: ErrorCode.Conflict }, ErrorCode.Conflict)).toBe(true);
    expect(isRefusal({ code: ErrorCode.NotFound }, ErrorCode.Conflict)).toBe(false);
  });

  it("is false for a refusal with no code at all rather than throwing", () => {
    expect(isRefusal("Conflict", ErrorCode.Conflict)).toBe(false);
    expect(isRefusal(null, ErrorCode.Conflict)).toBe(false);
  });
});
