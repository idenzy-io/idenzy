# @idenzy/node

Verify Idenzy access tokens and webhook deliveries on your server.

```sh
npm install @idenzy/node
```

```ts
import { AccessTokenVerifier } from "@idenzy/node";

// Build once and keep it: it caches the key set.
const verifier = new AccessTokenVerifier({
  issuerUrl: "https://auth.acme.com",
  projectId: "prj_...",
});

const { userId, sessionId, claims } = await verifier.verifyRequest(request.headers);
```

Verification is offline: ES256 against the published key set, with the issuer, the audience
(your project) and the lifetime checked. A key set that cannot be fetched is rethrown as an
outage rather than reported as a bad token. `RevocationCache` (from
`@idenzy/node/revocations`, with your secret key) refuses revoked sessions within a poll
instead of at the token's expiry. `verifyWebhook` (from `@idenzy/node/webhooks`) checks a
delivery's signature and timestamp.

MIT licensed.
