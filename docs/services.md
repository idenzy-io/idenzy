# External services

Every third party this system talks to, what it is for, and whether anything in this
repository actually calls it yet.

Two documents already cover parts of this and are the authority for what they cover:
[subprocessors](./compliance/subprocessors.md) is the GDPR register, so it lists only the
vendors that process personal data, and PROJECT.md §6.2 is the Google Cloud component
table with the cost and reliability reasoning behind each choice. This page is the whole
set in one place, including the ones that see no personal data and therefore never reach
the register.

**Status** is the state of the code, not of a contract. Nothing here is contracted, and
the only two that have ever made a real network call from this repository are Have I Been
Pwned and the container registry. That is still true with the SES adapter written: it has
never been given credentials.

- **Built** — an adapter exists and is wired into the composition root.
- **Port only** — the abstract base and its conformance suite exist; no vendor adapter.
- **Not started** — named in PROJECT.md, no code.

## Infrastructure (Google Cloud)

One cloud, on purpose: running two would double the key-management story for no customer
benefit (PROJECT.md 6.2). One region too — residency is not offered (4.13.5), so there is no
second stack and no customer-facing choice of where any of this runs.

| Service | Purpose | Status |
|---|---|---|
| Cloud Run | Every app: `api`, `workers`, `landing` | Not started |
| Cloud SQL for PostgreSQL 17 | The only durable store. Regional HA, private IP, PITR | Built against Postgres 17; the managed instance is not provisioned |
| Memorystore for Valkey | Rate-limit counters, the revocation set, OTP state | Built (`@idenzy/cache`, `docker compose` locally) |
| Cloud KMS | Per-project ES256 signing keys and the envelope KEK | Not started. `TokenIssuer` and `FieldEncryptor` both refuse to boot outside development rather than sign or encrypt under a key we control in process |
| Global external LB, Cloud Armor, Cloud CDN, Certificate Manager | One anycast IP for every customer CNAME, WAF and edge rate limits, managed certs | Not started |
| Pub/Sub, Cloud Tasks | Outbox relay, webhook delivery with backoff | Cloud Tasks is built (`CloudTasksScheduler`, ADR-0012) and has never been called back by a real queue. The outbox is drained by pollers in `apps/workers`, not by Pub/Sub, which remains unused |
| BigQuery | MAU and usage analytics, streamed from `auth_event` | Not started |
| Cloud Logging, Monitoring, Trace | Observability, with OpenTelemetry from the Node SDK | Not started. `@idenzy/observability` writes structured logs through the field allowlist |
| Artifact Registry, Cloud Build, Cloud Deploy, Binary Authorization | Build and release, signed images only | Not started |
| Cloud Storage plus CDN | Static hosting for the `admin` and `client` SPA bundles | Not started |

## Email delivery

The base class owns suppression, quota and metering; an adapter supplies transport only,
and must pass `EmailProviderConformanceSuite` before it can be registered
(PROJECT.md 11.1).

| Service | Role | Status |
|---|---|---|
| AWS SES | Primary. Shared sending domain, per-customer domains as separate identities, SNS event feed into the suppression list | **Built** (`SesEmailProvider`, SES v2 REST with our own SigV4 over `node:crypto` rather than `@aws-sdk/*`, per PROJECT.md 7.6). Not wired to an account: no sending domain, no DKIM, and the SNS receiver does not exist, so nothing has ever been sent |
| Resend, Postmark, SendGrid, Mailgun | Secondary and bring-your-own | Not started |
| Generic SMTP | Bring-your-own, for customers who will not use a vendor | Not started |
| `LoggingEmailProvider` | The development transport. Prints the whole message and refuses to construct outside development | Built |

## SMS and WhatsApp delivery

The interesting part of this path is not the vendor. It is `SmsFraudGuard` and the
Postgres spend cap in front of it, because SMS is the one channel where a request costs us
money before it reaches anybody (PROJECT.md 4.8). `ProviderRouter` holds the per-country
routing table, picks the cheapest acceptable provider, and never retries: a failed dispatch
has already reserved the spend and cannot know whether the message went out.

| Service | Role | Status |
|---|---|---|
| Twilio Programmable SMS | Primary, global reach | Port only |
| AWS End User Messaging | Secondary, for failover and cost | Port only |
| Vonage | Alternate route | Not started |
| MSG91 | India, where DLT registration makes a local provider cheaper | Not started |
| Regional providers (Turkey, MENA) | Where Twilio is expensive | Not started |
| WhatsApp Cloud API (Meta) | OTP over WhatsApp, roughly a fifth the cost of SMS in most regions | Not started. Its API sends pre-approved template messages rather than free text, so it is a provider and a template pipeline of its own rather than a branch in the OTP flow |
| `LoggingSmsProvider` | The development transport | Built |

We deliberately do **not** use Twilio Verify. It is about $0.05 per verification on top of
the SMS itself, where raw SMS is three to five times cheaper, and generating the code
ourselves keeps the template, the retry policy and the fraud logic where we can see them.

## Abuse and attestation

| Service | Purpose | Status |
|---|---|---|
| reCAPTCHA Enterprise **or** Cloudflare Turnstile | Proving a human is behind an SMS send from the web | Port only. `UnconfiguredAttestation` answers false for everything, so a project that requires attestation sends nothing until one is wired. That is the intended failure: a verifier that accepted what it cannot check would make the setting read as protection while being none |
| Apple App Attest | The same gate on iOS | Not started |
| Google Play Integrity | The same gate on Android | Not started |
| Cloud Armor | WAF and edge rate limiting before traffic costs us CPU | Not started |

## Identity providers

Eighteen social providers are built and pass `OAuthProviderConformanceSuite`: Google,
Apple, GitHub, Microsoft, Facebook, Discord, Twitch, LinkedIn, X, GitLab, Bitbucket,
Slack, Spotify, Notion, Figma, Kakao, LINE and Zoom. The nineteenth name in the enum,
`oidc`, is the generic enterprise connector and belongs to phase 4 with SAML.

We hold no credentials with any of them beyond the shared "instant dev mode" apps, which
are restricted to `localhost` and `*.idenzy.io`. In production the OAuth client id and
secret belong to the customer's own app, stored envelope encrypted per project.

## Other outbound calls

| Service | Purpose | Status |
|---|---|---|
| Have I Been Pwned (range API) | Breached-password check at sign-up and reset. k-anonymity, so only five hex characters of the SHA-1 ever leave the process | Built (`HibpRangeChecker`) |
| Stripe | Billing, metered against usage. Sees a billing contact and usage totals, never end-user data | Not started |
| PagerDuty, Slack | Incident alerting. Operational metadata only | Not started |

## Development and release

None of these run in production or see customer data, which is why none of them appears in
the subprocessor register.

| Service | Purpose |
|---|---|
| GitHub | Source, pull requests, CI |
| npm registry | Dependencies, and eventually the published SDK scope, with provenance and CI-only publishing (PROJECT.md 7.6) |
| Docker Hub | `postgres:17-alpine` and `valkey:8-alpine` for `docker compose` and Testcontainers |
| Terraform (Google provider) | Roles, KMS rings and everything else a migration must not create |

## Deliberately not used

- **No third-party analytics** on the customer dashboard or the operator console. The
  marketing site only, self-hosted or cookieless (PROJECT.md 10.3).
- **No third-party script anywhere near an authentication flow**, which costs us nothing
  because we render no authentication pages at all (ADR-0002).
- **No session-replay or error-reporting vendor** with access to customer data.
- **No second cloud.** Multi-cloud here would double the residency and key-management
  story to hedge a risk a single well-run region already covers.

## HIPAA-tier restriction

A project on the HIPAA compliance tier may use only subprocessors covered by a business
associate agreement. Delivery vendors without one are unavailable to that project, and
that is enforced by `projects.compliance_tier` rather than by policy.
