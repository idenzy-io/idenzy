# Subprocessors

Third parties that may process customer data on our behalf, and what each one sees.

Required for a GDPR DPA and asked for by every enterprise security review. Hand-
maintained: update it in the same pull request that adds or removes a vendor.

**Nothing here is contracted yet.** This is the intended set for the architecture in
PROJECT.md, recorded now so the register exists before the first vendor does.

This register is scoped to third parties that process personal data, which is what a DPA
asks for. The wider list, including the services that see none, is in
[docs/services.md](../services.md).

## One deployment

Idenzy runs as a single stack in a single region. There are no regional cells, no separate
control plane, and no way to pin a project to a jurisdiction. Every table below should be read
with that in mind: a vendor's region is a property of *the* deployment, not of a customer's
choice, and a customer cannot be given a different one.

Which region that is remains a deployment fact rather than a property of this repository, so
this register does not assert one — `infra/terraform` takes it as a required variable with no
default, precisely so nobody inherits an answer by accident. What must not happen is this file
naming a region that the deployment does not actually use, which is the failure the register
exists to prevent.

## Infrastructure

| Subprocessor | Purpose | Data processed | Notes |
|---|---|---|---|
| Google Cloud | Compute, database, cache, key management, networking | All customer and end-user data | One project, one region, one stack |

## Delivery

A delivery vendor processes the recipient's address or phone number, so where it sends from is
a transfer question in its own right, independent of where our stack runs.

| Subprocessor | Purpose | Data processed | Region | Notes |
|---|---|---|---|---|
| AWS (SES) | Transactional email | Recipient address, message content | Set by `AWS_REGION`; unset in development, where nothing is sent | Primary. Customers may verify their own sending domain, and we then process the message but not the reputation |
| Twilio | SMS | Recipient phone number, message content | Global, routed per country | Routing is by recipient country |
| AWS End User Messaging | SMS | Recipient phone number, message content | Follows the deployment | Secondary, for failover and cost |
| Meta (WhatsApp Cloud API) | WhatsApp OTP | Recipient phone number, message content | Global (Meta-operated) | Cheaper than SMS in most regions |

An SMS or WhatsApp recipient's number is disclosed to a carrier in their own country by the
nature of the service, so "regional routing" bounds cost and deliverability rather than anything
a privacy notice would call residency.

Email used to carry a hard requirement here: a cell's sending endpoint had to sit in the cell's
own jurisdiction, checked against `AWS_REGION` at boot, because a cell that sent from elsewhere
transferred personal data on every sign-in and undid the cell. With one deployment there is no
jurisdiction to match and the check is gone. What replaced it is a different control for a
different problem: the shared sender is a sandbox with a burst and a daily ceiling, and a
per-project bounce-rate breaker stops a project whose mail is damaging the SES account every
customer sends through (risks.md 2). Neither is about residency.

## Operations

| Subprocessor | Purpose | Data processed | Notes |
|---|---|---|---|
| Stripe | Billing | Customer billing contact, usage totals | No end-user data |
| PagerDuty | Incident alerting | Operational metadata only | No customer or end-user data |

## International transfers

**Nothing below is in place.** This section records what a transfer out of the EEA would need,
because the register previously recorded no transfer mechanism at all — which read as though
none were required.

One deployment, in one region. So for a customer in the EEA, the UK or Switzerland, **every**
piece of personal data reaching Idenzy is an international transfer unless the deployment itself
sits in their jurisdiction — and because there is only one deployment, it cannot sit in every
customer's. This is no longer a gap waiting on an EU cell to close: it is the architecture, and
it is a thing to be contracted for rather than engineered around.

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
- **There is no topology fix available.** The previous version of this file said an EU cell would
  narrow the problem to customer account data. There are no cells, so the whole of it —
  end-user data and customer account data alike — is covered by whatever the contract says and
  by nothing else.

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
