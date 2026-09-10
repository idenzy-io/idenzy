# Client dashboard UI/UX audit

Reviewed September 9, 2026. Covers **all 32 signed-in dashboard pages**, plus the **five authentication entry pages**. This is a review of the current working tree and local prototype, not a production certification. No application code was changed for this audit.

## Main conclusion

Keep the consistent design system. Change the information hierarchy to match each task: investigation, configuration, integration setup, editing, job execution or financial review. Giving every page different colours would not solve the confusing decisions, repeated technical explanations or misleading readiness states.

Each dashboard page note contains the user's task, what to preserve, a desktop wireframe, mobile arrangement, section order, button placement, dialog flow, prioritized problems, proposed fixes and acceptance checks. Wireframes describe **proposed behavior**, including capabilities that require backend work; they are not screenshots of existing functionality.

## Start here

1. [Architecture and product understanding](architecture.md) — product boundaries, implementation status and documentation reviewed.
2. [Shared layout blueprint](layout-blueprint.md) — shell, grid, spacing, typography, page families, buttons, fields, dialogs and states.
3. [Shared experience](shared-experience.md) and [dialog rules](dialogs.md) — problems that recur across pages.
4. [Implementation priorities](priorities.md) — fix trust-breaking outcomes first, then validate the main journeys.
5. [Evidence and limitations](evidence.md) — what was inspected, reproduced and not verified.

P1 indicates a consequential misunderstanding, blocked task, lost work or false outcome. P2 indicates a meaningful clarity or efficiency improvement. These are UX priorities, not security vulnerability scores. “Acceptance checks” are proposed implementation tests, not claims that the current prototype passes them.

## Page notes

| Area | Current route | Review and mockup |
| --- | --- | --- |
| Overview | `/` | [Overview](overview.md) |
| Customer operations | `/users` | [Users](users.md) |
| Customer operations | `/sessions` | [Sessions](sessions.md) |
| Customer operations | `/import` | [Import](import.md) |
| Authentication | `/methods/passwords` | [Passwords](methods-passwords.md) |
| Authentication | `/methods/passkeys` | [Passkeys](methods-passkeys.md) |
| Authentication | `/methods/otp` | [Codes and magic links](methods-otp.md) |
| Authentication | `/methods/providers` | [Social providers](methods-providers.md) |
| Additional verification | `/mfa/totp` | [Authenticator apps](mfa-totp.md) |
| Additional verification | `/mfa/recovery` | [Recovery codes](mfa-recovery.md) |
| Additional verification | `/mfa/step-up` | [Step-up](mfa-step-up.md) |
| Tokens | `/tokens/claims` | [Claims](tokens-claims.md) |
| Tokens | `/tokens/lifetimes` | [Lifetimes](tokens-lifetimes.md) |
| Tokens | `/tokens/revocation` | [Revocation](tokens-revocation.md) |
| Email | `/email/templates` | [Templates](email-templates.md) |
| Email | `/email/domains` | [Sending domains](email-domains.md) |
| Email | `/email/suppressions` | [Suppressions](email-suppressions.md) |
| Application integration | `/domains` | [Authentication domains](domains.md) |
| Application integration | `/domains/origins` | [Browser origins](domains-origins.md) |
| SMS | `/sms/policy` | [SMS policy](sms-policy.md) |
| SMS | `/sms/providers` | [SMS providers](sms-providers.md) |
| Monitoring | `/audit` | [Audit log](audit.md) |
| Monitoring | `/security` | [Security](security.md) |
| Monitoring | `/usage` | [Usage](usage.md) |
| Billing | `/settings/billing` | [Billing](settings-billing.md) |
| Developer integration | `/keys` | [API keys](keys.md) |
| Developer integration | `/webhooks` | [Webhooks](webhooks.md) |
| Developer integration | `/hooks` | [Authentication hooks](hooks.md) |
| Privacy operations | `/data-requests` | [Data requests](data-requests.md) |
| Settings | `/settings` | [Project settings](settings.md) |
| Settings | `/settings/members` | [Members](settings-members.md) |
| Personal | `/account` | [My account](account.md) |

### Supplemental entry journey

These five pages belong to the client app but are outside the signed-in dashboard navigation. Their notes also include proposed layouts and interaction guidance.

| Current route | Review and mockup |
| --- | --- |
| `/auth/login` | [Login](auth-login.md) |
| `/auth/register` | [Registration](auth-register.md) |
| `/auth/recover` | [Password recovery](auth-recover.md) |
| `/auth/account-verification` | [Account verification](auth-account-verification.md) |
| `/auth/two-factor` | [Second-factor verification](auth-two-factor.md) |

## How to implement from a note

Read the user task and findings before copying the wireframe. Resolve capability and scope questions, then implement its sections and controls using the existing components. Add loading, error, empty, permission, pending and recovery states alongside the happy path. Finish with the page's acceptance checks and representative-user observation; do not treat a mockup as validated usability.
