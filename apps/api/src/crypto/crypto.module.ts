import { AppConfig } from "@idenzy/config/app-config";
import { Clock } from "@idenzy/core/time/clock";
import { FieldEncryptor } from "@idenzy/crypto/encryption/field-encryptor";
import { fieldEncryptorFor } from "@idenzy/crypto/encryption/field-key";
import { Argon2idHasher, PasswordHasher } from "@idenzy/crypto/hashing/password-hasher";
import { KeyEncryption } from "@idenzy/crypto/kms/key-encryption";
import { TokenIssuer } from "@idenzy/crypto/tokens/token-issuer";
import { IssuerTokenVerifier, TokenVerifier } from "@idenzy/crypto/tokens/token-verifier";
import { SigningKeyStore, WrappedEs256Issuer } from "@idenzy/crypto/tokens/wrapped-es256-issuer";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { keyEncryptionFor } from "@idenzy/providers-gcp/key-encryption-for";
import { Global, Module } from "@nestjs/common";
import { DatabaseSigningKeyStore } from "./database-signing-key-store.js";

/**
 * Signing and hashing (PROJECT.md 9.2).
 *
 * Every environment signs with a key per project, wrapped by a key it never holds itself
 * (ADR-0021). The one difference is where the wrapping key lives: Cloud KMS outside
 * development, a key derived in the process locally. So development exercises the production
 * path — keys made on first use, stored wrapped, opened once per process — and a token minted
 * locally survives a restart, which an ephemeral key did not.
 *
 * Outside development a missing `KMS_KEY_NAME` stops the API at boot rather than falling back
 * to anything: a deployment signing with a key derived from a constant would publish keys that
 * anybody with the source could reproduce.
 */
@Global()
@Module({
  providers: [
    {
      provide: KeyEncryption,
      inject: [AppConfig],
      useFactory: (config: AppConfig): KeyEncryption =>
        keyEncryptionFor(config.get("IDENZY_ENV"), config.get("KMS_KEY_NAME")),
    },
    {
      provide: SigningKeyStore,
      inject: [UnitOfWork, KeyEncryption],
      useFactory: (uow: UnitOfWork, wrapping: KeyEncryption): SigningKeyStore =>
        new DatabaseSigningKeyStore(uow, wrapping),
    },
    {
      provide: TokenIssuer,
      inject: [AppConfig, Clock, SigningKeyStore, KeyEncryption],
      useFactory: (
        config: AppConfig,
        clock: Clock,
        keys: SigningKeyStore,
        wrapping: KeyEncryption,
      ): TokenIssuer =>
        new WrappedEs256Issuer(
          clock,
          config.get("ISSUER_BASE_URL"),
          config.get("ACCESS_TOKEN_TTL_SECONDS"),
          keys,
          wrapping,
        ),
    },
    /**
     * Field-level encryption: one data key for the deployment, wrapped by the same KMS key and
     * opened once at boot, so encrypting stays synchronous (`fieldEncryptorFor` says why).
     */
    {
      provide: FieldEncryptor,
      inject: [AppConfig, KeyEncryption],
      useFactory: (config: AppConfig, wrapping: KeyEncryption): Promise<FieldEncryptor> =>
        fieldEncryptorFor(config.get("IDENZY_ENV"), config.get("FIELD_KEY_WRAPPED"), wrapping),
    },
    // No pepper yet: it lives in KMS (PROJECT.md 4.5) and arrives with the KMS work.
    // Introducing one is not transparent, because argon2.verify with a secret cannot
    // check a hash made without it. That is what passwordAlgoVersion is for: peppered
    // hashes get a new version, and the verifier picks the hasher by the stored version.
    { provide: PasswordHasher, useFactory: () => new Argon2idHasher() },
    {
      provide: TokenVerifier,
      inject: [TokenIssuer, AppConfig],
      useFactory: (issuer: TokenIssuer, config: AppConfig) =>
        new IssuerTokenVerifier(issuer, config.get("ISSUER_BASE_URL")),
    },
  ],
  exports: [TokenIssuer, TokenVerifier, PasswordHasher, FieldEncryptor, KeyEncryption],
})
export class CryptoModule {}
