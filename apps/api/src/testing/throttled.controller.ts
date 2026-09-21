import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { RateLimit } from "../throttling/rate-limit.decorator.js";

/** Small enough to reach in a test, and named here so the test asserts against one copy. */
export const TEST_IP_LIMIT = 4;
export const TEST_SUBJECT_LIMIT = 2;

/**
 * Routes that exist to be throttled, so the guard is covered against a real Valkey.
 *
 * It lives in `src` rather than in the test file for the reason every app test imports from
 * `dist`: Vitest transforms with Rolldown, which does not apply the legacy decorator
 * semantics Nest needs, so a decorated class declared in a `.test.ts` does not parse
 * (docs/guide/repo.md). Registered by the test module only; AppModule never imports it.
 *
 * One handler per thing under test, because a bucket is keyed on the handler. Sharing a
 * route would have each test spend the next one's budget, and the failure would read as
 * the limiter being wrong rather than the tests being coupled.
 */
@Controller("test/throttled")
export class ThrottledController {
  /** A subject budget small enough to reach, behind an address budget too big to. */
  @Post("subject")
  @RateLimit({
    ip: { limit: 1000, windowSeconds: 60 },
    subject: { limit: TEST_SUBJECT_LIMIT, windowSeconds: 60, from: ["email", "phone"] },
  })
  @HttpCode(200)
  subject(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }

  /** The mirror image: address only, which is what a burst naming fresh accounts meets. */
  @Post("address")
  @RateLimit({ ip: { limit: TEST_IP_LIMIT, windowSeconds: 60 } })
  @HttpCode(200)
  address(@Body() _body: unknown): { ok: true } {
    return { ok: true };
  }

  /** No spec at all, so the guard has to leave it alone. */
  @Post("open")
  @HttpCode(200)
  open(): { ok: true } {
    return { ok: true };
  }
}
