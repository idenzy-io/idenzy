# Product and architecture understanding

Reviewed September 9, 2026, against the working tree, including the existing uncommitted dashboard work.

## What the customer is buying

Idenzy provides managed authentication, user administration and headless SDKs. Its promises are secure defaults, fast integration into the customer's own application, and understandable usage pricing. The dashboard's primary user is an application developer; support, security and billing staff have different secondary tasks.

The customer's end user is a different person from the signed-in dashboard member. Account security, project authentication rules and organisation membership must remain distinguishable in both navigation and confirmation copy.

## System map

| Layer | Responsibility | UX consequence |
| --- | --- | --- |
| `apps/client` | Nuxt SPA, Vue, Vuetify, Tailwind, Pinia, ECharts | This audit's scope; shared styling is appropriate, but page composition should follow the task. |
| `apps/landing` | Public marketing/documentation shell | Long integration and architecture explanations belong here, with concise help beside dashboard controls. |
| `apps/admin` | Separate internal operator console | Do not imply customer access to internal infrastructure controls. |
| `apps/api` (`src/management/`) | Management and billing, merged into the one API service | Both surfaces run in one process; `src/http/surface.ts` keeps their CORS and guard chains apart. |
| `apps/api` | Authentication, sessions, MFA, OAuth, claims and revocation | Some real capabilities exist here independently of the incomplete management plane. |
| `apps/workers` | Background processing; audit relay and revocation reconciliation exist | Delivery, exports, provisioning and other future jobs need their own observable job states. |
| `packages/protocol`, `core`, `domain` | Contracts, errors, invariants, flows and policies | UI examples and validation must use the actual contract; copied constants already disagree between pages. |
| `packages/persistence`, `crypto`, `cache` | Drizzle/Postgres, tenant RLS, credentials, Valkey | Preserve tenant scoping and security guarantees while simplifying their explanation. |
| `packages/sdk`, `tools/cli`, `examples` | Headless integration and customer-owned starter code | Onboarding should finish at a real successful sign-in, not merely at creating a key. |
| `infra`, compliance registers | Deployment plans, data classification and controls | A planned control must not appear as verified operational protection. |

Dependency direction is apps → feature/infrastructure packages → domain → protocol/core. Tenant data is bound to a project by the repository layer. Regional cells were built and removed (PROJECT.md 4.13.5). The intended shared `@idenzy/ui` package is not yet present: dashboard components and tokens live locally.

## What is implemented versus demonstrated

Page rendering, filtering, charting, local validation and some file parsing are real frontend behavior. Stores commonly seed sample data and simulate latency. A successful local mutation generally changes memory, not the deployed service. Reloading is therefore not a persistence test of a connected backend.

The two project fixtures expose useful contrasting states: Personal Team often has no domains, invoices or data requests, while Acme has populated examples. Several other Personal Team pages still contain substantial invented traffic and accounts.

Readiness cannot be inferred from a switch, a green badge or a timestamp in those fixtures. Particularly misleading examples include SMS vendors “Carrying traffic,” KMS custody stated as active, security automation choices, and completed data exports. `docs/services.md` and `todo.md` distinguish several of these as unbuilt. Those documents also contain historical descriptions: code and actual deployment evidence must settle a production claim.

## Product boundaries to preserve

- Do not propose hosted customer authentication screens. SDK examples and previews of customer-owned flows fit the headless product.
- Never put a management secret in the browser to make a dashboard action work. Use authenticated, permission-checked management endpoints.
- Do not let staff reveal or regenerate another user's recovery credentials.
- Keep OAuth return URIs, WebAuthn origins and CORS origins separate grants, while guiding setup across them.
- Distinguish immediate API session revocation from propagation to customer verifiers.
- Keep security defaults and server enforcement. Reducing explanation does not mean removing protection.
- No SOC 2/ISO certification or HIPAA contractual status is established by a dashboard badge.
- No third-party session replay is needed for the proposed usability work; use local observation and appropriately scoped first-party task measurements.

## Documentation reviewed

Product scope, security model, pricing design, dependency rules, frontend architecture and integration journey in [PROJECT.md](../PROJECT.md); setup in [README.md](../README.md); current dashboard conventions and security details in [CLAUDE.md](../CLAUDE.md); delivery status in [todo.md](../todo.md); [service inventory](../docs/services.md); [ADRs](../docs/adr); [compliance controls](../docs/compliance/controls.md), generated data-map/RoPA structure and subprocessors; [infrastructure status](../infra/terraform/README.md). Route, layout, component, store, utility and backend composition code were checked against these documents.

This is a product/UX architecture review, not a claim that every SDK adapter, migration or security property was exhaustively verified.

