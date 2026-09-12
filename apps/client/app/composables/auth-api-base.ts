/**
 * Where the auth API lives, for the screens that have to print a URL a customer will copy.
 *
 * One reader rather than three, and it reads the SDK's own configuration rather than a
 * second key beside it. `@idenzy/nuxt` writes `apiUrl` into `runtimeConfig.public.idenzy`,
 * and that value is what the panel actually authenticates against — so a provider callback
 * or a revocation endpoint printed from anywhere else could name a host the SDK is not
 * talking to, which is a support ticket nobody can reproduce.
 *
 * The fallback is the documented shared host. Empty is not a URL, and a screen that has to
 * show a customer what to paste into a provider's console must show something.
 */
import { RUNTIME_CONFIG_KEY } from "@idenzy/nuxt/runtime/options";

/** The shared API host, which is where a project lives until it has an auth domain. */
const SHARED_HOST = "https://api.idenzy.io";

export function useAuthApiBase(): ComputedRef<string> {
  const runtime = useRuntimeConfig();
  return computed(() => {
    const idenzy = runtime.public[RUNTIME_CONFIG_KEY] as { apiUrl?: string } | undefined;
    const configured = idenzy?.apiUrl ?? "";
    return configured.length > 0 ? configured.replace(/\/$/, "") : SHARED_HOST;
  });
}
