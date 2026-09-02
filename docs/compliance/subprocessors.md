# Subprocessors

Third parties that may process customer data on our behalf, and what each one sees.

Required for a GDPR DPA and asked for by every enterprise security review. Hand-
maintained: update it in the same pull request that adds or removes a vendor.

**Nothing here is contracted yet.** This is the intended set for the architecture in
PROJECT.md, recorded now so the register exists before the first vendor does.

## Infrastructure

| Subprocessor | Purpose | Data processed | Regions |
|---|---|---|---|
| Google Cloud | Compute, database, cache, key management, networking | All customer and end-user data, per cell | EU, US, Asia (pinned per project) |

## Delivery

| Subprocessor | Purpose | Data processed | Notes |
|---|---|---|---|
| AWS (SES) | Transactional email | Recipient address, message content | Primary. Customers may bring their own and we then process nothing. |
| Twilio | SMS | Recipient phone number, message content | Regional routing |
| AWS End User Messaging | SMS | Recipient phone number, message content | Secondary, for failover and cost |
| Meta (WhatsApp Cloud API) | WhatsApp OTP | Recipient phone number, message content | Cheaper than SMS in most regions |

## Operations

| Subprocessor | Purpose | Data processed | Notes |
|---|---|---|---|
| Stripe | Billing | Customer billing contact, usage totals | No end-user data |
| PagerDuty | Incident alerting | Operational metadata only | No customer or end-user data |

## Not used, deliberately

- No third-party analytics on the customer dashboard or the operator console. Analytics
  runs on the marketing site only, self-hosted or cookieless (PROJECT.md 10.3).
- No third-party script anywhere near an authentication flow, which is straightforward
  for us because we render no authentication pages at all (PROJECT.md 1.1).
- No session-replay or error-reporting vendor with access to customer data.

## HIPAA-tier restriction

A project on the HIPAA compliance tier may only use subprocessors covered by a business
associate agreement. Delivery vendors without one are unavailable to that project, which
is enforced by `projects.compliance_tier` rather than by policy.
