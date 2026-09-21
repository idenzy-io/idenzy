# Readiness for the US and the EU

Architecture only. **Idenzy holds no certification and claims none** (PROJECT.md 4.13.10), and
nothing here may be quoted to a customer. This is not legal advice: it is a record of which
obligations the *architecture* has to be shaped for, so that pursuing any of them later is an
examination of records rather than a rebuild.

Written against a concrete plan: a Wyoming company from 2027-01-01, serving customers in both the
United States and the EEA, with no intention of applying for a certificate until revenue justifies
the cost. That order — architecture first, programme later — is the whole reason this file exists.
The expensive mistake is not a missing audit; it is a schema that cannot answer an auditor's
question without a migration.

## Which side of each law we are on

| | Idenzy is | The customer is |
|---|---|---|
| GDPR | **processor** for end-user data; **controller** for the customer's own account data | controller |
| CCPA/CPRA and its followers | **service provider** | business |
| HIPAA (enterprise tier) | **business associate** | covered entity |

Almost every obligation below flows from that, and it is why so much of the work is contractual
rather than architectural: a processor acts on instructions, and the architecture's job is to make
the instructions executable and the execution provable.

## A US company does not escape the GDPR

Worth stating plainly, because it is the assumption most likely to be made and it is wrong. GDPR
Art. 3(2) reaches processing of EEA data subjects' data where goods or services are offered to
them, regardless of where the processor is established. A Wyoming entity serving a customer whose
users are in Europe is in scope. Incorporating in Wyoming changes the tax and corporate position
and changes nothing here.

Two consequences, neither of them architectural, recorded so they are not discovered late:

- **Art. 27 representative.** A processor outside the Union that is subject to the GDPR must
  designate a representative in the Union unless the processing is occasional, low risk and free
  of special categories. An authentication provider at any scale is none of those three. This is a
  service somebody is paid for, not something to build.
- **Transfers, with us as the importer.** Today every EEA customer's data reaches a US cell, which
  is a transfer needing a mechanism — see the Transfers section of
  [subprocessors.md](./subprocessors.md). As a US entity there are two paths: self-certify to the
  EU-US Data Privacy Framework, or sign Standard Contractual Clauses with each customer and carry
  out a transfer impact assessment. The first is markedly cheaper to operate; neither is built, and
  our subprocessors' own certifications do not cover us.

## What the architecture already satisfies

Not a claim that the programme is done — a list of the things that will not need rebuilding.

- **Per-column classification** (4.13.2) generating the Art. 30 record, the data map, the log
  allowlist and the data-subject field lists. A column that escapes it does not compile. This is
  the single most expensive thing to retrofit and it was done first.
- **Hash-chained, append-only audit** (4.13.3), which is what "evidence over time" means to a SOC 2
  examiner, and which no application code path can rewrite. The one deliberate exception is a
  project purge, and it records itself.
- **Residency by topology** (4.13.5): independent cells, `cell_id` immutable behind a trigger,
  cross-cell access refused on the key before any lookup, and a cell's transactional email unable
  to leave its own jurisdiction.
- **Disposal on demand** (Art. 28(3)(g), CCPA §1798.105): a project delete cascades 37 tables and
  purges the audit trail, leaving a `project_purges` row as the only evidence — which is the
  evidence the obligation actually requires.
- **Retention enforced by a job** rather than by a document, per subject, with the ages the panel
  shows being the ages the sweeper uses.
- **Deadlines per request, not per cell.** The correction worth naming: GDPR governs a *person*, so
  a cell in Iowa answers a European on Art. 12(3)'s one calendar month the moment a customer there
  has European users. `DsrDeadline` is therefore a family selected per request from the
  controller's determination, defaulting to the stricter rule. Adding a US state whose clock
  differs is a subclass, not a migration.

## The gaps, ordered by what they would cost to fix later

**1. No data-subject request pipeline, and one prerequisite is now in place.**
`DataSubjectRequestHandler` is still an abstract class with no implementation, so nothing assembles
an export or executes an erasure; the panel says so on its own screen rather than pretending
otherwise.

What was missing underneath it has been fixed, because it was the part that would have been
expensive later. `subjectField` declared *which* columns belong to a data subject and `erasure`
declared what to do with them, and **nothing declared how to find one person's rows** — so a
handler built on the generated lists would have carried a hand-written join per table across 13
tables, which is the maintained list that generating the lists exists to abolish. Nor did anything
separate the two populations: `users.email` and `org_invitations.email` are both PII marked
`subjectField`, and one is a customer's end user while the other is somebody on the customer's own
team. Answering one from the other's rows is a breach in either direction.

Each table now declares its `TableSubject` — population and locator — a test refuses a table with
subject columns and no declaration, and the generated data map prints it above the columns, which
is the question an auditor asks first: *"you hold an email address for a data subject; show me how
you would find mine."* The awkward cases are named rather than glossed: `otp_challenges` holds a
hash of the address, so it is reachable only by hashing the identifier the same way, and
`audit_events` is export-only because the trail keeps a pseudonymous id precisely so an erasure
stays provable (Art. 17(3)(b) against Art. 17(1)).

**Access and portability are separately blocked, which is worth knowing before promising them.**
An export has to land somewhere and there is no object storage anywhere in the estate — no bucket,
no storage port, no configuration for one. `data_subject_requests.artifact_uri` has nothing to
point at. Erasure has no such dependency: it acts in place.

**2. Nothing pages anybody when a request goes overdue.** 4.13.6 says an overdue request pages
someone, and the clock is monitored by nothing. A missed statutory deadline is the finding an
auditor writes down.

**3. No "who was affected" query for a breach.** GDPR gives 72 hours to notify a supervisory
authority; US state laws vary in both deadline and trigger. The data map and the audit trail
between them hold the answer, and nothing composes it. Cheap now, frantic during an incident.

**4. Age is nowhere in the schema. This is the expensive one.** There is no date of birth, no age
band, no minor flag anywhere. COPPA reaches under-13s in the US; GDPR Art. 8 sets a digital consent
age that member states may place anywhere from 13 to 16. An authentication provider is precisely
where age gating would have to live. Adding it later means a new classified column with a lawful
basis, a verification flow, a migration over live user rows, and a re-answer to every customer who
had already been told what we hold. **This deserves a decision before the first customer, even if
the decision is that we never hold it and customers must gate their own sign-up.** Recorded as an
open decision rather than quietly deferred.

**5. Subject location is deliberately absent, and should stay a decision.** `users` holds no
country, so Idenzy genuinely cannot tell which law governs a given person — which is exactly why
the deadline rule is the controller's to state. That is a defensible processor position and it is
now a designed one. If we ever want to infer it, that is a new classified column, a new lawful
basis, and a new answer on the data map: not a small change dressed as a convenience.

## Two answers worth writing down before somebody asks

- **Passkeys do not put us in scope for biometric data.** CPRA treats biometric information as
  sensitive personal information, and a security questionnaire will ask. WebAuthn keeps the
  biometric on the user's own device; what reaches us is a public key and a signed assertion. We
  never receive, store or process a fingerprint or a face. This is architecturally load-bearing
  rather than a happy accident, and it is why offering passkeys does not widen our SPI scope.
- **We sell and share nothing.** The US state laws' central mechanic — opt-out of sale, of sharing,
  and of targeted advertising, including honouring Global Privacy Control — has no subject matter
  here. There is no advertising, no analytics vendor with access to customer data, and no
  third-party script anywhere near an authentication flow (PROJECT.md 1.1, 10.3). Recorded as not
  applicable *with the reason*, because an unanswered question reads worse than a negative answer.

## On deferring the certificates

Nothing above requires an audit to be useful. What an audit later asks for is evidence produced
over time, and 4.13.9 already emits it per release: SBOM and provenance, the advisory report, the
regenerated data map and RoPA, the migration diff, and an access-review extract. The cost of a
certificate is the examination; the cost of being *unable* to be examined is a quarter-long
migration, and that is the one this architecture was shaped to avoid.
