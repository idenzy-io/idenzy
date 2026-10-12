import type { Idenzy } from "@idenzy/native-js";
import { IdenzyError } from "@idenzy/native-js/errors";
import { IdenzyProvider, useIdenzyStatus } from "@idenzy/native-js/react";
import { configure } from "@idenzy/react-native";
import { type ReactNode, useEffect, useState } from "react";
import { Text } from "react-native";

// Port 9 on loopback: nothing listens, so the connection is refused before a byte is sent.
const UNREACHABLE = "http://127.0.0.1:9";

/**
 * The whole chain on a device, without an Idenzy server: JavaScript, the Expo module, the bridge,
 * the native SDK, the Rust core, the platform's HTTP stack, and back, then the status as the
 * hooks render it. Built in with `EXPO_PUBLIC_IDENZY_SELF_TEST=1`, and read from the device log.
 */
export function SelfTest(): ReactNode {
  const [client, setClient] = useState<Idenzy | null>(null);
  useEffect(() => {
    void run(setClient).then(report);
  }, []);
  if (client === null) return null;
  return (
    <IdenzyProvider client={client}>
      <Status />
    </IdenzyProvider>
  );
}

let sawSignedOut = (): void => undefined;
/** Settles once `useIdenzyStatus` has rendered the signed-out status that `restore` leads to. */
const signedOutRendered = new Promise<void>((resolve) => {
  sawSignedOut = resolve;
});

function Status(): ReactNode {
  const status = useIdenzyStatus();
  useEffect(() => {
    if (status.status === "signedOut") sawSignedOut();
  }, [status]);
  return <Text>{status.status}</Text>;
}

// `console.error` because a release build forwards only errors to the device log, and this is
// read from the device log. It reports a pass as well as a failure.
function report(outcome: string): void {
  console.error(`IDENZY_SELF_TEST ${outcome}`);
}

async function run(show: (client: Idenzy) => void): Promise<string> {
  try {
    // First, while nothing is configured: afterwards any other key is refused for that reason.
    const secret = await refusal(() =>
      configure({ publishableKey: "sk_live_self", apiUrl: UNREACHABLE }),
    );
    if (secret?.code !== "validation_failed") return `FAIL a secret key was not refused: ${secret}`;

    const client = await configure({ publishableKey: "pk_test_self", apiUrl: UNREACHABLE });
    show(client);
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

    const timeout = new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5000));
    if ((await Promise.race([signedOutRendered, timeout])) === "timeout") {
      return "FAIL the hooks never rendered signedOut";
    }
    return "PASS";
  } catch (error) {
    return `FAIL ${String(error)}`;
  }
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
