import { ResourceNotFoundError } from "@idenzy/core/errors";
import { PublicId } from "@idenzy/core/value-objects/public-id";
import { generateOpaqueToken, hashToken } from "@idenzy/crypto/tokens/random";
import {
  ApiKeyRepository,
  type ApiKeyRow,
} from "@idenzy/persistence/repository/api-key-repository";
import type { OrgContext } from "@idenzy/persistence/tenancy/org-context";
import { UnitOfWork } from "@idenzy/persistence/tenancy/unit-of-work";
import { ApiKeyKind } from "@idenzy/protocol/enums/tenancy";
import { ApiKeyPrefix, IdPrefix } from "@idenzy/protocol/schemas/common";
import type { ApiKeySummary, CreatedApiKey } from "@idenzy/protocol/schemas/management";
import { Injectable } from "@nestjs/common";
import { ProjectScope } from "../tenancy/project-scope.js";

/** 32 bytes from the CSPRNG. The panel documents this figure; it is not decoration. */
const KEY_BYTES = 32;

/**
 * Characters of the random body kept in the clear.
 *
 * Enough to name a row in a log line or an `.env` file, far too few to narrow a guess: the
 * remaining body is still 256 bits of randomness.
 *
 * Counted from the body rather than from the whole key, so the eight characters are eight
 * characters of randomness whatever the kind prefix is. `KEY_DISPLAY_LENGTH` in
 * `@idenzy/protocol` is the same figure seen from the other side — prefix plus these eight —
 * and is what a refusal shows the caller, so the dashboard and the error agree.
 */
const BODY_PREFIX_LENGTH = 8;

const KIND_PREFIXES: Record<ApiKeyKind, string> = {
  [ApiKeyKind.Publishable]: ApiKeyPrefix.Publishable,
  [ApiKeyKind.Secret]: ApiKeyPrefix.Secret,
};

/**
 * Issuing, listing and revoking a project's API keys (PROJECT.md 4.3).
 *
 * The key exists in one response and nowhere else. It is generated here, hashed here, and
 * the digest is what reaches the database — so a database backup is not a set of live
 * credentials, and nothing in this service can produce an existing key a second time.
 * A "show it again" feature would not be a missing convenience; it would be a different
 * and worse design.
 *
 * Every call goes through `ProjectScope`, which is what binds `app.project_id` and what
 * refuses to bind it for a project the caller's organisation does not own. Reaching for a
 * `TenantContext` built from the path parameter directly is the hole that would make every
 * customer's keys readable by anybody with an account.
 */
@Injectable()
export class ApiKeysService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly scope: ProjectScope,
  ) {}

  async list(context: OrgContext, projectId: string): Promise<ApiKeySummary[]> {
    const tenant = await this.scope.of(context, projectId);
    const rows = await this.uow.transaction((tx) => new ApiKeyRepository(tx, tenant).list());
    return rows.map(present);
  }

  /**
   * Mints one, and hands back the only copy that will ever exist.
   *
   * The hash is computed before the row is written and the plaintext is never passed to
   * the repository, so the layer that talks to the database has no way to store it even by
   * accident.
   */
  async create(context: OrgContext, projectId: string, kind: ApiKeyKind): Promise<CreatedApiKey> {
    const tenant = await this.scope.of(context, projectId);

    // Kind and then 32 bytes of base64url. The kind is the only thing that travels in the
    // clear, and it is there so a key pasted into the wrong field is refused on the prefix
    // before any lookup — which is the whole of what a reader can tell from a key's text.
    const head = KIND_PREFIXES[kind];
    const secret = `${head}${generateOpaqueToken(KEY_BYTES)}`;

    const row = await this.uow.transaction((tx) =>
      new ApiKeyRepository(tx, tenant).create({
        kind,
        prefix: secret.slice(0, head.length + BODY_PREFIX_LENGTH),
        hash: hashToken(secret),
        scopes: [],
      }),
    );
    return { key: present(row), secret };
  }

  /**
   * Revokes one. Not a delete: a key that signed requests is part of the record of what
   * happened, and `revoked_at` is what lets the trail still name it afterwards.
   */
  async revoke(context: OrgContext, projectId: string, keyId: string): Promise<ApiKeySummary> {
    const tenant = await this.scope.of(context, projectId);
    const id = PublicId.parse(IdPrefix.ApiKey, keyId).uuid;
    const row = await this.uow.transaction((tx) =>
      new ApiKeyRepository(tx, tenant).revoke(id, new Date()),
    );
    // Already revoked and never existed answer the same way. The first is not an error
    // worth a different code, and the second must not confirm that an id was real.
    if (row === null) throw new ResourceNotFoundError({ detail: { keyId } });
    return present(row);
  }
}

function present(row: ApiKeyRow): ApiKeySummary {
  return {
    id: PublicId.encode(IdPrefix.ApiKey, row.id).value,
    kind: row.kind,
    prefix: row.prefix,
    scopes: [...row.scopes],
    createdAt: row.createdAt.toISOString(),
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null,
  };
}
