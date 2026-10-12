import type { NativeAnswer, NativeBridge } from "./native-bridge.js";

/**
 * The native SDKs' JSON bridge (`IDZBridge`'s JSON methods, `JsonBridge`) as a framework reaches
 * it: one call and one status watch, JSON both ways.
 */
export interface JsonCarrier {
  call(method: string, argumentsJson: string, done: (answerJson: string) => void): void;
  /** Reports each status as JSON, now and on every change, until the returned function is called. */
  watchStatus(report: (statusJson: string) => void): () => void;
}

/**
 * A JSON carrier as the shared client's `NativeBridge`, for a framework whose own value
 * marshalling is in the way: NativeScript hands native code a JavaScript object as a proxy. A
 * string crosses every framework as itself, so a carrier that moves strings converts nothing and
 * learns no framework's rules for numbers and nulls.
 */
export function jsonBridge(carrier: JsonCarrier): NativeBridge {
  return {
    call: (method, args) =>
      new Promise((resolve) => {
        carrier.call(method, JSON.stringify(args), (json) => resolve(answerFrom(json)));
      }),
    watchStatus: (listener) =>
      carrier.watchStatus((json) => {
        // The native side writes every status itself; one that does not parse is not one.
        const status = recordFrom(json);
        if (status !== null) listener(status);
      }),
  };
}

function answerFrom(json: string): NativeAnswer {
  const answer = recordFrom(json);
  const error = answer?.["error"];
  if (answer !== null && error === undefined) return { ok: answer["ok"] };
  if (isRecord(error) && typeof error["code"] === "string") {
    return {
      error: {
        code: error["code"],
        message: typeof error["message"] === "string" ? error["message"] : "",
        details: isRecord(error["details"]) ? error["details"] : {},
      },
    };
  }
  return {
    error: {
      code: "provider_unavailable",
      message: "The native SDK answered with something other than JSON.",
      details: { transportReason: "unexpectedResponse" },
    },
  };
}

function recordFrom(json: string): Readonly<Record<string, unknown>> | null {
  try {
    const value: unknown = JSON.parse(json);
    return isRecord(value) ? value : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
