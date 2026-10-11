import { ResourceNotFoundError } from "@idenzy/core/errors";
import type { KeyEncryption } from "@idenzy/crypto/kms/key-encryption";
import {
  generateSigningKey,
  SigningKeyStore,
  type WrappedSigningKey,
} from "@idenzy/crypto/tokens/wrapped-es256-issuer";
import {
  ProjectSigningKeyRepository,
  type SigningKeyRow,
} from "@idenzy/persistence/repository/project-signing-key-repository";
import { TenantContext } from "@idenzy/persistence/tenancy/tenant-context";
import type { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { type Jwk, jwkSchema } from "@idenzy/protocol/schemas/discovery";

/**
 * Projects' signing keys in `project_signing_keys`, with the first one made on demand.
 *
 * The project is checked to exist before a key is generated, because the JWKS route is public and
 * a key costs a KMS call: without the check, anybody could make us generate and wrap keys for
 * project ids that will never exist. With it, the most a stranger can cause is the one key a real
 * project was going to get anyway.
 */
export class DatabaseSigningKeyStore extends SigningKeyStore {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly wrapping: KeyEncryption,
  ) {
    super();
  }

  override async primary(projectId: string): Promise<WrappedSigningKey> {
    const tenant = scope(projectId);
    const held = await this.uow.transaction((tx) =>
      new ProjectSigningKeyRepository(tx, tenant).primary(),
    );
    if (held !== null) return present(held);

    const exists = await this.uow.transaction((tx) =>
      new ProjectSigningKeyRepository(tx, tenant).projectExists(),
    );
    if (!exists) throw new ResourceNotFoundError({ detail: { entity: "project" } });

    // Generated and wrapped outside the transaction: a KMS call has no business holding a
    // database connection open.
    const created = await generateSigningKey(projectId, this.wrapping);
    const primary = await this.uow.transaction((tx) =>
      new ProjectSigningKeyRepository(tx, tenant).createPrimaryIfAbsent(created),
    );
    return present(primary);
  }

  override async publishable(projectId: string): Promise<readonly Jwk[]> {
    const live = await this.uow.transaction((tx) =>
      new ProjectSigningKeyRepository(tx, scope(projectId)).publishable(),
    );
    if (live.length > 0) return live.map((row) => jwkSchema.parse(row.publicJwk));
    return [(await this.primary(projectId)).publicJwk];
  }
}

function scope(projectId: string): TenantContext {
  return new TenantContext(projectId, "signing-keys", "system");
}

function present(row: SigningKeyRow): WrappedSigningKey {
  return {
    kid: row.kid,
    publicJwk: jwkSchema.parse(row.publicJwk),
    privateKeyWrapped: row.privateKeyWrapped,
  };
}
