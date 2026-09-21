import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../../dist/app.module.js";
import { ClaimsService } from "../../dist/management/claims/claims-service.js";
import { ProvidersService } from "../../dist/management/providers/providers-service.js";
import { SessionsService } from "../../dist/management/sessions/sessions-service.js";
import { SettingsService } from "../../dist/management/settings/settings-service.js";
import { UsersService } from "../../dist/management/users/users-service.js";
import { testConfig } from "../fixtures.js";

/**
 * Compiles the composition root and resolves the **dashboard** surface's providers.
 *
 * Its twin is `test/wiring.test.ts`, which compiles the same module and resolves the auth
 * surface's. Two files rather than one because they answer for two halves that were two
 * services until the merge: a single list would grow to forty providers and stop being
 * read, and each half is still the thing its own half of the app is wired from.
 *
 * Compiling the root is the only way to catch a whole class of DI mistake at test time
 * rather than at boot. This is exactly how `ProvidersService` shipped asking for a
 * `FieldEncryptor` its module could not resolve: every unit test passed, every integration
 * test passed — they construct services directly — and the failure appeared only when the
 * process tried to start.
 *
 * The other thing it pins is quieter. `CryptoModule` exported `FieldEncryptor` and nothing
 * had ever imported it, so the binding was dead code; a module graph that resolves is the
 * only check that a provider is reachable from the thing that needs it.
 */
describe("the management API composition root", () => {
  it("resolves every service without touching the database", async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AppConfig)
      .useValue(testConfig())
      .compile();

    expect(moduleRef.get(UnitOfWork)).toBeInstanceOf(UnitOfWork);
    expect(moduleRef.get(UsersService)).toBeInstanceOf(UsersService);
    expect(moduleRef.get(SessionsService)).toBeInstanceOf(SessionsService);
    expect(moduleRef.get(SettingsService)).toBeInstanceOf(SettingsService);
    expect(moduleRef.get(ClaimsService)).toBeInstanceOf(ClaimsService);
    // The one that failed at boot: it needs FieldEncryptor from a module nobody imported.
    expect(moduleRef.get(ProvidersService)).toBeInstanceOf(ProvidersService);

    await moduleRef.close();
  });
});
