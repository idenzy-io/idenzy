# ADR-0021: A signing key per project, wrapped by KMS

- Status: accepted
- Date: 2026-10-11

## Context

The auth API could not start outside development. Its only issuer held one ephemeral key in the
process, so `CryptoModule` refused every other environment with "KmsEs256Issuer is not
implemented": a fleet of instances would each publish a different key set, and every restart would
invalidate every token.

PROJECT.md 4.2 sketched the answer as signing with KMS `asymmetricSign` against a key per project.
That puts a KMS round trip on the hottest path in the product (a token roughly every five minutes
per active user, about 158 per monthly active user), and from a VPS that round trip is an internet
call. A key per project held in KMS is also a fixed monthly cost per tenant.

`WrappedEs256Issuer`, `KmsKeyEncryption` and the `project_signing_keys` table were already written
for a cheaper design and never wired: the issuer took one project at construction, while the API
builds one issuer per process.

## Decision

**Every project signs with its own ES256 key.** The key is generated in the process the first time
the project needs one (a token, a revocation snapshot, a JWKS request), its private half wrapped by
the deployment's Cloud KMS key (`KMS_KEY_NAME`) with the project id as authenticated data, and
stored in `project_signing_keys`. A partial unique index keeps one primary per project, so two
processes making the first key at once settle on one without a lock.

**A process opens a project's key once.** The first token for a project costs one KMS `decrypt`;
the key is cached for the life of the process and every token after that is signed locally, in
microseconds. Public keys are cached for a minute, which keeps verification in our own API off the
database.

**The issuer finds the key from the audience.** Every token and statement is addressed to exactly
one project, so `aud` is the project and call sites did not change. The API's own verifier takes
the project from the request's tenant, never from the token, and checks the signature against that
project's keys and the audience against that project.

**Each project publishes its own key set** at `/v1/projects/{prj}/jwks.json`, public and cached for
five minutes (never a refusal). `@idenzy/node`, every SSR helper and keel's Go verifier fetch it.
There is no deployment-wide `/.well-known/jwks.json` or OpenID discovery document: with a key per
project neither could be right for more than one, and a discovery document whose `jwks_uri` is
right for one project is worse than none. `iss` stays the deployment's base URL.

**Field encryption uses one data key for the deployment, wrapped the same way.** It is made once
by the bootstrap command, stored only as `FIELD_KEY_WRAPPED` (a Secret Manager reference) and
unwrapped once at boot, so `encrypt` and `decrypt` stay synchronous with no KMS call. Not a key per
project, and deliberately: every value is already bound to its project as AES-GCM authenticated
data, so a ciphertext moved to another project's row does not open, and a key per project would
add a KMS call to each project's first request for no boundary the binding does not already hold.
A key per project becomes worth it with customer-held keys, and `projects.dek_wrapped` is there for
that day.

**Development runs the same code.** Locally the wrapping key is derived in the process
(`LocalKeyEncryption`) instead of living in KMS. Keys are still per project and stored, so a token
minted locally now survives a restart.

## Consequences

- The boundary is real: a verifier holding one project's key set rejects another project's token
  on its signature, before the audience check that used to be the only line.
- A leaked key forges one project's tokens, not every project's.
- The unwrapped private key is in process memory, which is a weaker posture than a non-exportable
  HSM key and the price of local signing. At rest it is encrypted under KMS, access to it is IAM and
  every unwrap is a KMS audit log entry.
- Not built yet: rotation (a second key published before it signs, then the first retired) and
  re-reading a rotated primary without a restart. The table and repository already hold both states.
- `projects.kms_key_name` is read by nothing and waits for a migration to drop it.
- The SDK changes before its first publish: `RemoteJwks` takes the project id.
