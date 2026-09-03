import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { EmailProvider } from "@idenzy/domain/ports/email-provider";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../dist/app.module.js";
import { Mailer } from "../dist/delivery/mailer.js";
import { EmailOtpFlow } from "../dist/otp/email-otp.flow.js";
import { PasswordSignInFlow } from "../dist/password/password-sign-in.flow.js";
import { PasswordSignUpFlow } from "../dist/password/password-sign-up.flow.js";
import { RefreshService } from "../dist/session/refresh-service.js";
import { SessionService } from "../dist/session/session-service.js";
import { testConfig } from "./fixtures.js";

/**
 * Compiles the composition root, which is the only way to catch a whole class of DI
 * mistakes at test time rather than at boot.
 *
 * The specific one this exists for: a constructor dependency imported with `import type`
 * compiles and lints cleanly, then resolves to undefined in `design:paramtypes` and
 * fails at startup. Biome's useImportType rule will rewrite such an import given the
 * chance, which is why it is switched off for app source and why this test is here.
 *
 * AppConfig is overridden rather than the environment being set, so the test does not
 * mutate process-wide state and stays inside the one-place-reads-the-environment rule.
 */
describe("the composition root", () => {
  it("resolves every provider without touching the database", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(testConfig())
      .compile();

    expect(moduleRef.get(AppConfig)).toBeInstanceOf(AppConfig);
    expect(moduleRef.get(UnitOfWork)).toBeInstanceOf(UnitOfWork);
    expect(moduleRef.get(TokenIssuer)).toBeInstanceOf(TokenIssuer);
    expect(moduleRef.get(SessionService)).toBeInstanceOf(SessionService);
    expect(moduleRef.get(RefreshService)).toBeInstanceOf(RefreshService);
    // The flows are where a symbol-token mistake would show up, since FlowHooks and
    // FlowAudit are interfaces and cannot be resolved by type.
    expect(moduleRef.get(PasswordSignUpFlow)).toBeInstanceOf(PasswordSignUpFlow);
    expect(moduleRef.get(PasswordSignInFlow)).toBeInstanceOf(PasswordSignInFlow);
    expect(moduleRef.get(EmailOtpFlow)).toBeInstanceOf(EmailOtpFlow);
    // The delivery stack, whose transport refuses to construct outside development, so
    // this also pins that the test environment is the one it will accept.
    expect(moduleRef.get(Mailer)).toBeInstanceOf(Mailer);
    expect(moduleRef.get(EmailProvider)).toBeInstanceOf(EmailProvider);

    await moduleRef.close();
  });
});
