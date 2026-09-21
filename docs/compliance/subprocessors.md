# Subprocessors

Third parties that may process customer data on our behalf, and what each one sees.

Required for a GDPR DPA and asked for by every enterprise security review. Hand-
maintained: update it in the same pull request that adds or removes a vendor.

**Nothing here is contracted yet.** This is the intended set for the architecture in
PROJECT.md, recorded now so the register exists before the first vendor does.

This register is scoped to third parties that process personal data, which is what a DPA
asks for. The wider list, including the services that see none, is in
[docs/services.md](../services.md).

## Infrastructure

| Subprocessor | Purpose | Data processed | Regions in use today |
|---|---|---|---|
| Google Cloud | Compute, database, cache, key management, networking | All customer and end-user data, per cell | **US only (`us1`, `us-central1`).** An EU cell is planned and does not exist. |

The regions column records what is **provisioned**, not what the architecture allows. PROJECT.md
4.13.5 describes cells in EU, US and Asia; one cell exists, it is in the United States, and every
project is therefore US-resident. Saying otherwise here would be the exact failure this register
exists to prevent.

## Delivery

A delivery vendor processes the recipient's address or phone number, so its region is part of
the residency claim and not a deployment detail. A cell that sends through an endpoint outside
its own jurisdiction transfers personal data on every sign-in, which would undo the cell.

| Subprocessor | Purpose | Data processed | Region | Notes |
|---|---|---|---|---|
| AWS (SES) | Transactional email | Recipient address, message content | `us-east-1` | Primary. Must be `eu-west-1` for an EU cell. Customers may bring their own and we then process nothing. |
| Twilio | SMS | Recipient phone number, message content | Global, routed per country | Routing is by recipient country, not by cell |
| AWS End User Messaging | SMS | Recipient phone number, message content | Follows the cell | Secondary, for failover and cost |
| Meta (WhatsApp Cloud API) | WhatsApp OTP | Recipient phone number, message content | Global (Meta-operated) | Cheaper than SMS in most regions |

An SMS or WhatsApp recipient's number is disclosed to a carrier in their own country by the
nature of the service, so "regional routing" bounds cost and deliverability rather than
residency. Email is the one delivery channel where the endpoint region is ours to choose, which
is why it is the one with a hard requirement above.

## Operations

| Subprocessor | Purpose | Data processed | Notes |
|---|---|---|---|
| Stripe | Billing | Customer billing contact, usage totals | No end-user data |
| PagerDuty | Incident alerting | Operational metadata only | No customer or end-user data |

## International transfers

**Nothing below is in place.** This section records what a transfer out of the EEA would need,
because the register previously recorded no transfer mechanism at all — which read as though
none were required.

One cell exists and it is in the United States. So for a customer in the EEA, the UK or
Switzerland, **every** piece of end-user personal data reaching Idenzy is an international
transfer today, and remains one for their own account data even after an EU cell exists, because
the control plane is global (PROJECT.md 4.13.5).

What that requires, and none of it is done:

| | Needed |
|---|---|
| EEA | Standard Contractual Clauses in the DPA — Module 2 where the customer is a controller, Module 3 where they are themselves a processor — plus a transfer impact assessment |
| UK | The ICO's International Data Transfer Addendum on top of the SCCs |
| Switzerland | SCCs with the Swiss annex |
| Onward | The same obligations passed down to every subprocessor above |

Two things worth stating plainly so nobody assumes them:

- **Google Cloud and AWS being certified under the EU-US Data Privacy Framework does not cover
  Idenzy.** They are our subprocessors; the transfer from the customer to *us* is a separate
  transfer with us as importer. Idenzy holds no DPF certification.
- **An EU cell narrows this but does not close it.** It removes the transfer for end-user data.
  Customer account data — organisation names, invitation email addresses, dashboard sign-ins —
  stays in the global control plane and stays a transfer.

Consistent with the rest of this repository: this is a description of the architecture and what
it would take, not a compliance claim, and none of it may be quoted to a customer
(PROJECT.md 4.13.10).

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
