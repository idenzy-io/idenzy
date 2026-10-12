import { configure } from "@idenzy/lynx";
import type { Idenzy } from "@idenzy/native-js";
import { IdenzyError } from "@idenzy/native-js/errors";
import { IdenzyProvider, useIdenzyStatus } from "@idenzy/native-js/react";
import { type ReactNode, useEffect, useState } from "@lynx-js/react";

// Port 9 on loopback: nothing listens, so the connection is refused before a byte is sent.
const UNREACHABLE = "http://127.0.0.1:9";

/**
 * The whole chain on a device, without an Idenzy server: the page, the Lynx module, the bridge, the
 * native SDK, the Rust core, the platform's HTTP stack, and back, then the status as the hooks
 * render it. The outcome is logged as one `IDENZY_SELF_TEST` line and drawn on the screen.
 */
export function SelfTest(): ReactNode {
  const [client, setClient] = useState<Idenzy | null>(null);
  const [outcome, setOutcome] = useState("running");
  useEffect(() => {
    void run(setClient).then((result) => {
      console.error(`IDENZY_SELF_TEST ${result}`);
      setOutcome(result);
    });
  }, []);
  return (
    <view style={{ padding: "64px 24px" }}>
      <text style={{ fontSize: "24px" }}>{`IDENZY_SELF_TEST ${outcome}`}</text>
      {client === null ? null : (
        <IdenzyProvider client={client}>
          <Status />
        </IdenzyProvider>
      )}
    </view>
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
  return <text>{`status: ${status.status}`}</text>;
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
