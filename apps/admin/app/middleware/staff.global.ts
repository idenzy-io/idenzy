import type { OperatorMe } from "@idenzy/protocol/schemas/operator";

/**
 * Only staff past this point (ADR-0018).
 *
 * The API is what enforces it — every operator route answers 401 to anybody else — and this is
 * the console noticing early: no session goes to sign-in, and a session the API will not accept
 * as staff goes to sign-in with the reason, rather than to pages that would all fail.
 */
export default defineNuxtRouteMiddleware(async (to) => {
  if (to.path.startsWith("/auth/")) return;
  const operator = useState<OperatorMe | null>("operator", () => null);
  if (operator.value !== null) return;

  const { data, statusCode } = await useOperatorApi()("/v1/operator/me").get().json<OperatorMe>();
  if (data.value === null) {
    return navigateTo({
      path: "/auth/sign-in",
      query: statusCode.value === 401 ? { refused: "1" } : {},
    });
  }
  operator.value = data.value;
});
