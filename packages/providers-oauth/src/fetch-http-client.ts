import { ProviderUnavailableError } from "@idenzy/core/errors/errors";
import { HttpClient, type HttpRequest, type HttpResponse } from "@idenzy/core/http/http-client";

/**
 * `fetch`, with a deadline.
 *
 * The timeout is the point. Without it an unresponsive provider holds a sign-in open
 * until the browser gives up, and a request that hangs is worse than one that fails: the
 * user has no idea whether to try again, and neither does the customer's UI.
 *
 * It lives here rather than in `@idenzy/core` because core carries no Node types and no
 * dependencies, so that the SDKs can import it and ship to a browser.
 */
export class FetchHttpClient extends HttpClient {
  constructor(private readonly timeoutMs: number = 5000) {
    super();
  }

  protected override async exchange(request: HttpRequest): Promise<HttpResponse> {
    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: {
          accept: "application/json",
          ...(request.form === undefined
            ? {}
            : { "content-type": "application/x-www-form-urlencoded" }),
          ...request.headers,
        },
        ...(request.form === undefined
          ? {}
          : { body: new URLSearchParams({ ...request.form }).toString() }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      return { status: response.status, body: await response.text() };
    } catch (error: unknown) {
      throw new ProviderUnavailableError({
        detail: { url: request.url, reason: "the request did not complete" },
        cause: error,
      });
    }
  }
}
