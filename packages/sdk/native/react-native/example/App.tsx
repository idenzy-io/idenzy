import type { Idenzy } from "@idenzy/native-js";
import { IdenzyError, IdenzySignInCancelled } from "@idenzy/native-js/errors";
import { IdenzyProvider, useIdenzyStatus } from "@idenzy/native-js/react";
import { configure } from "@idenzy/react-native";
import { useEffect, useState } from "react";
import { Button, SafeAreaView, Text, TextInput } from "react-native";

/**
 * A few buttons and a status line, written to show which call does what rather than how a
 * sign-in should look. The screens in a real app are yours: Idenzy ships no authentication UI.
 */
export default function App() {
  const [client, setClient] = useState<Idenzy | null>(null);
  const [failure, setFailure] = useState("");
  useEffect(() => {
    configure({ publishableKey: "pk_test_example", apiUrl: "http://localhost:3000" })
      .then(async (configured) => {
        setClient(configured);
        // Offline at launch is not signed out: the status stays loading until a call settles it.
        await configured.restore().catch(() => null);
      })
      .catch((error: unknown) => setFailure(String(error)));
  }, []);
  if (client === null) return failure === "" ? null : <Text>{failure}</Text>;
  return (
    <IdenzyProvider client={client}>
      <SignInScreen client={client} />
    </IdenzyProvider>
  );
}

function SignInScreen({ client }: { readonly client: Idenzy }) {
  const status = useIdenzyStatus();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");

  const attempt = async (call: () => Promise<unknown>) => {
    try {
      await call();
    } catch (error) {
      if (error instanceof IdenzySignInCancelled) setMessage("Cancelled.");
      else if (error instanceof IdenzyError) setMessage(`${error.code}: ${error.message}`);
    }
  };

  return (
    <SafeAreaView style={{ padding: 16, gap: 8 }}>
      <Text>
        {status.status === "signedIn"
          ? `Signed in as ${status.user.email ?? status.user.id}`
          : status.status}
      </Text>
      <TextInput placeholder="Email" value={email} onChangeText={setEmail} autoCapitalize="none" />
      <Button
        title="Send a code"
        onPress={() => attempt(() => client.signIn.withEmailOtp({ email }))}
      />
      <TextInput placeholder="Code" value={code} onChangeText={setCode} keyboardType="number-pad" />
      <Button title="Verify" onPress={() => attempt(() => client.signIn.verifyOtp({ code }))} />
      <Button title="Sign in with Apple" onPress={() => attempt(() => client.signIn.withApple())} />
      <Button title="Sign out" onPress={() => attempt(() => client.signOut())} />
      <Text>{message}</Text>
    </SafeAreaView>
  );
}
