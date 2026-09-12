import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors";
import { developmentDataKey } from "@idenzy/crypto/encryption/development-key";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { Module } from "@nestjs/common";
import { ConfigModule } from "../config/config.module.js";

/**
 * The one primitive the control plane needs of its own: field-level encryption.
 *
 * A webhook signing secret has to be readable again — a digest cannot sign (ADR-0012) — so it is
 * stored encrypted under the project's data key with the project id as additional authenticated
 * data. Nothing else here holds key material: dashboard tokens are verified with `@idenzy/node`
 * against our published keys, and an API key is a digest.
 *
 * The provider is deliberately the same shape as auth-api's, refusal included. The real data key is
 * per project and wrapped by the cell KMS key; until that exists there is one derived from the cell
 * code, which is not a secret, so this refuses to build outside development. A deployment that
 * quietly encrypted customers' signing secrets under a key printed in the source would be worse
 * than one that would not start.
 */
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: FieldEncryptor,
      inject: [AppConfig],
      useFactory: (config: AppConfig): FieldEncryptor => {
        if (config.get("IDENZY_ENV") !== "development") {
          throw new InternalError({
            detail: {
              reason: "the per-project KMS-wrapped data key is not implemented",
              rule: "field encryption under a derived key is development only (PROJECT.md 4.13.4)",
            },
          });
        }
        return new FieldEncryptor(developmentDataKey(config.get("CELL_CODE")));
      },
    },
  ],
  exports: [FieldEncryptor],
})
export class CryptoModule {}
