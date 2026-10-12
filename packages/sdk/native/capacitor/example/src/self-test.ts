import { configure } from "@idenzy/capacitor";
import type { Idenzy } from "@idenzy/native-js";
import { IdenzyError } from "@idenzy/native-js/errors";

// Port 9 on loopback: nothing listens, so the connection is refused before a byte is sent.
const UNREACHABLE = "http://127.0.0.1:9";

/**
 * The whole chain on a device, without an Idenzy server: the web view, Capacitor's plugin bridge,
 * the JSON bridge, the native SDK, the Rust core, the platform's HTTP stack, and back, then the
 * status as the client reports it. The same checks as the React Native and Lynx examples.
 */
export async function selfTest(): Promise<string> {
  try {
    // First, while nothing is configured: afterwards any other key is refused for that reason.
    const secret = await refusal(() =>
      configure({ publishableKey: "sk_live_self", apiUrl: UNREACHABLE }),
    );
    if (secret?.code !== "validation_failed") return `FAIL a secret key was not refused: ${secret}`;

    const client = await configure({ publishableKey: "pk_test_self", apiUrl: UNREACHABLE });
    const signedOut = settled(client);
    const restored = await client.restore();
    if (restored !== null) return "FAIL restore found a session on a fresh install";

    const offline = await refusal(() =>
      client.signIn.withPassword({ email: "ada@example.com", password: "correct horse" }),
    );
    if (offline?.transportReason !== "notSent") return `FAIL expected notSent, got ${offline}`;

    const second = await refusal(() =>
      configure({ publishableKey: "pk_test_other", apiUrl: UNREACHABLE }),
    );
    if (second?.code !== "validation_failed")
      return `FAIL a second project was not refused: ${second}`;

    if (!(await signedOut)) return "FAIL the status never reached signedOut";
    return "PASS";
  } catch (error) {
    return `FAIL ${String(error)}`;
  }
}

/** True once the client reports signed out, false if it has not within five seconds. */
function settled(client: Idenzy): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 5000);
    client.subscribe((status) => {
      if (status.status !== "signedOut") return;
      clearTimeout(timeout);
      resolve(true);
    });
  });
}

/** The IdenzyError a call throws, or null when it does not throw one. */
async function refusal(call: () => Promise<unknown>): Promise<IdenzyError | null> {
  try {
    await call();
    return null;
  } catch (error) {
    return error instanceof IdenzyError ? error : null;
  }
}
