import "reflect-metadata";
import { AppConfig } from "@idenzy/config/app-config";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { Test } from "@nestjs/testing";
import { describe, expect, it } from "vitest";
import { AppModule } from "../dist/app.module.js";
import { ClaimsService } from "../dist/claims/claims-service.js";
import { ProvidersService } from "../dist/providers/providers-service.js";
import { SessionsService } from "../dist/sessions/sessions-service.js";
import { SettingsService } from "../dist/settings/settings-service.js";
import { UsersService } from "../dist/users/users-service.js";
import { testConfig } from "./fixtures.js";

/**
 * Compiles the composition root, which is the only way to catch a whole class of DI
 * mistake at test time rather than at boot.
 *
 * `auth-api` has had one of these since phase 0 and this service did not, which is exactly
 * how `ProvidersService` shipped asking for a `FieldEncryptor` its module could not resolve:
 * every unit test passed, every integration test passed — they construct services directly —
 * and the failure appeared only when the process tried to start.
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
