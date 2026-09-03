import { AppConfig } from "@idenzy/config/app-config";
import { InternalError } from "@idenzy/core/errors/errors";
import { Clock } from "@idenzy/core/time/clock";
import { Argon2idHasher, PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { LocalEs256Issuer } from "@idenzy/crypto/tokens/local-es256-issuer";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { Global, Module } from "@nestjs/common";

/**
 * Signing and hashing (PROJECT.md 9.2).
 *
 * The token issuer refuses to start outside development, and that is the point rather
 * than an oversight. KmsEs256Issuer is not written yet, and the local issuer holds an
 * ephemeral in-process key: every instance would publish a different JWKS, every restart
 * would invalidate every token, and none of it would be visible until a customer's
 * verifier started failing. Failing at boot is the loud version of that.
 */
@Global()
@Module({
  providers: [
    {
      provide: TokenIssuer,
      inject: [AppConfig, Clock],
      useFactory: (config: AppConfig, clock: Clock): Promise<TokenIssuer> => {
        if (config.get("IDENZY_ENV") !== "development") {
          return Promise.reject(
            new InternalError({
              detail: {
                reason: "KmsEs256Issuer is not implemented",
                rule: "an in-process signing key is development only (PROJECT.md 4.2)",
              },
            }),
          );
        }
        return LocalEs256Issuer.create(
          clock,
          config.get("ISSUER_BASE_URL"),
          config.get("ACCESS_TOKEN_TTL_SECONDS"),
        );
      },
    },
    // No pepper yet: it lives in KMS (PROJECT.md 4.5) and arrives with the KMS work.
    // Introducing one is not transparent, because argon2.verify with a secret cannot
    // check a hash made without it. That is what passwordAlgoVersion is for: peppered
    // hashes get a new version, and the verifier picks the hasher by the stored version.
    { provide: PasswordHasher, useFactory: () => new Argon2idHasher() },
  ],
  exports: [TokenIssuer, PasswordHasher],
})
export class CryptoModule {}
