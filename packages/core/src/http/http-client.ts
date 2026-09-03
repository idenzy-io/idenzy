import { ProviderUnavailableError } from "../errors.js";

export interface HttpRequest {
  readonly url: string;
  readonly method: "GET" | "POST";
  readonly headers?: Readonly<Record<string, string>>;
  /** `application/x-www-form-urlencoded`, which is what every OAuth token endpoint takes. */
  readonly form?: Readonly<Record<string, string>>;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface JsonResponse<T> {
  readonly status: number;
  readonly data: T;
}

/**
 * Outbound HTTP, as a port (PROJECT.md 7.2.2).
 *
 * It exists so a provider adapter can be tested without the network, which for OAuth is
 * the difference between a conformance suite that runs in CI and one that does not.
 *
 * The port lives here and every implementation lives elsewhere, because `core` has no
 * Node types and no dependencies on purpose: the SDKs import it and ship to browsers.
 *
 * The base owns parsing and the failure translation, so no adapter decides for itself
 * what a timeout means. Note what it deliberately does not do: a 4xx is returned rather
 * than thrown, because `invalid_grant` from a token endpoint is a fact about the request
 * and not an outage, and the two need different answers.
 */
export abstract class HttpClient {
  protected abstract exchange(request: HttpRequest): Promise<HttpResponse>;

  async json<T>(request: HttpRequest): Promise<JsonResponse<T>> {
    const response = await this.exchange(request);
    if (response.status >= 500) {
      throw new ProviderUnavailableError({
        detail: { url: request.url, statusCode: response.status },
      });
    }
    try {
      return { status: response.status, data: JSON.parse(response.body) as T };
    } catch (error: unknown) {
      // A provider that answers 200 with an HTML error page is unavailable as far as we
      // are concerned, and saying so beats a JSON parse error surfacing as a 500.
      throw new ProviderUnavailableError({
        detail: { url: request.url, statusCode: response.status, reason: "response is not json" },
        cause: error,
      });
    }
  }
}
