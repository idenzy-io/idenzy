import { InvalidCredentialsError } from "@idenzy/core/errors/errors";
import { Controller, Get } from "@nestjs/common";

/** Not an Error at all, which is a real failure mode: libraries throw plain values. */
class UnrecognizedFailure {
  constructor(readonly message: string) {}
}

/**
 * Routes that always fail, so the exception filter's output is covered by tests rather
 * than only its happy path.
 *
 * Registered by the test module only; AppModule never imports it.
 */
@Controller("test")
export class FailingController {
  @Get("boom")
  boom(): never {
    throw new InvalidCredentialsError({ detail: { userId: "usr_secret", note: "internal" } });
  }

  @Get("unhandled")
  unhandled(): never {
    // Deliberately not an IdenzyError, and deliberately not even an Error, to prove the
    // filter turns anything it does not recognize into a generic 500.
    throw new UnrecognizedFailure("an unexpected internal failure with a revealing message");
  }
}
