/**
 * Each project's webhook endpoints, and the deliveries made to them.
 *
 * Endpoints are saved like any setting. Deliveries are a different matter: nothing sends one
 * yet (`WEBHOOK_DELIVERY`), so `deliveriesFor` answers nothing, and a test event or a retry
 * does nothing, rather than the sample attempts kept below. An attempt on this screen would
 * be a claim that we called somebody's URL, and the note's acceptance check is that an
 * unavailable pipeline makes no such claim. The samples stay for the day it runs, and for
 * flipping the flag to see the workspace populated.
 *
 * The signing secret goes one way: the store hands it to the caller when it is made or
 * rotated and never keeps it.
 *
 * A placeholder until the management client exists, like every store here.
 */

import {
  ALL_EVENTS,
  type DeliveryAttempt,
  type DeliveryOutcome,
  MAX_ATTEMPTS,
  nextRetrySeconds,
  ROTATION_OVERLAP_HOURS,
  samplePayload,
  TEST_EVENT,
  WEBHOOK_DELIVERY,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

export type EndpointDraft = Pick<
  WebhookEndpoint,
  "url" | "description" | "events" | "allEvents" | "enabled"
>;

export const useWebhooksStore = defineStore("webhooks", () => {
  const account = useAccountStore();
  const endpoints = ref<Record<string, WebhookEndpoint[]>>({});
  const deliveries = ref<Record<string, WebhookDelivery[]>>({});
  const loading = ref(true);

  setTimeout(() => {
    endpoints.value = { prj_personal: [], prj_acme: acmeEndpoints() };
    deliveries.value = WEBHOOK_DELIVERY.running ? { prj_acme: sampleDeliveries(ACME_IDS) } : {};
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): WebhookEndpoint[] {
    return endpoints.value[projectId] ?? [];
  }

  function deliveriesFor(projectId: string): WebhookDelivery[] {
    if (!WEBHOOK_DELIVERY.running) return [];
    return deliveries.value[projectId] ?? [];
  }

  function write(projectId: string, next: WebhookEndpoint[]) {
    endpoints.value = { ...endpoints.value, [projectId]: next };
  }

  function writeDeliveries(projectId: string, next: WebhookDelivery[]) {
    deliveries.value = { ...deliveries.value, [projectId]: next };
  }

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
  }

  /** Creates the endpoint and hands back its signing secret, the only moment anybody has it. */
  async function add(
    projectId: string,
    draft: EndpointDraft,
  ): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    await settle();
    const now = new Date().toISOString();
    const endpoint: WebhookEndpoint = {
      ...draft,
      id: `whk_${randomHex(16)}`,
      disabled: draft.enabled ? null : { kind: "paused", at: now, by: account.profile.name },
      createdAt: now,
      rolledAt: null,
      previousSecretUntil: null,
    };
    write(projectId, [...forProject(projectId), endpoint]);
    return { endpoint, secret: newSecret() };
  }

  async function update(
    projectId: string,
    id: string,
    change: Partial<Omit<WebhookEndpoint, "id">>,
  ): Promise<void> {
    await settle();
    write(
      projectId,
      forProject(projectId).map((endpoint) =>
        endpoint.id === id ? { ...endpoint, ...change } : endpoint,
      ),
    );
  }

  /** Off by a person's hand, which the row names. Nothing queues while it is paused. */
  function pause(projectId: string, id: string) {
    return update(projectId, id, {
      enabled: false,
      disabled: { kind: "paused", at: new Date().toISOString(), by: account.profile.name },
    });
  }

  /** On again. What happened while it was off is not replayed. */
  function resume(projectId: string, id: string) {
    return update(projectId, id, { enabled: true, disabled: null });
  }

  /**
   * Replaces the secret. The previous one keeps signing beside it until the deadline, so a
   * receiver can deploy the new one without a delivery in between failing verification.
   */
  async function rotateSecret(
    projectId: string,
    id: string,
  ): Promise<{ secret: string; until: string }> {
    await settle();
    const until = new Date(Date.now() + ROTATION_OVERLAP_HOURS * 3_600_000).toISOString();
    write(
      projectId,
      forProject(projectId).map((endpoint) =>
        endpoint.id === id
          ? { ...endpoint, rolledAt: new Date().toISOString(), previousSecretUntil: until }
          : endpoint,
      ),
    );
    return { secret: newSecret(), until };
  }

  async function remove(projectId: string, id: string): Promise<void> {
    await settle();
    write(
      projectId,
      forProject(projectId).filter((endpoint) => endpoint.id !== id),
    );
    writeDeliveries(
      projectId,
      (deliveries.value[projectId] ?? []).filter((entry) => entry.endpointId !== id),
    );
  }

  /** A new delivery of the test event. Does nothing while delivery is not running. */
  async function sendTest(projectId: string, endpointId: string): Promise<void> {
    if (!WEBHOOK_DELIVERY.running) return;
    await settle();
    const id = `dlv_${randomHex(6)}`;
    const at = new Date().toISOString();
    const test: WebhookDelivery = {
      id,
      endpointId,
      event: TEST_EVENT,
      outcome: "delivered",
      attempts: [{ n: 1, at, status: 200, error: null, durationMs: 140, response: '{"ok":true}' }],
      nextRetryAt: null,
      payload: samplePayload(TEST_EVENT, id, at),
      createdAt: at,
      test: true,
    };
    writeDeliveries(projectId, [test, ...(deliveries.value[projectId] ?? [])]);
  }

  /** The same delivery again, same id, as one more attempt. Nothing while delivery is off. */
  async function retry(projectId: string, deliveryId: string): Promise<void> {
    if (!WEBHOOK_DELIVERY.running) return;
    await settle();
    writeDeliveries(
      projectId,
      (deliveries.value[projectId] ?? []).map((entry) => {
        if (entry.id !== deliveryId) return entry;
        const attempt: DeliveryAttempt = {
          n: entry.attempts.length + 1,
          at: new Date().toISOString(),
          status: 200,
          error: null,
          durationMs: 160,
          response: '{"received":true}',
        };
        return {
          ...entry,
          outcome: "delivered",
          attempts: [...entry.attempts, attempt],
          nextRetryAt: null,
        };
      }),
    );
  }

  return {
    loading,
    forProject,
    deliveriesFor,
    add,
    update,
    pause,
    resume,
    rotateSecret,
    remove,
    sendTest,
    retry,
  };
});

/*
 * The placeholder.
 */

function randomHex(bytes: number): string {
  let out = "";
  for (let index = 0; index < bytes * 2; index += 1) {
    out += Math.floor(Math.random() * 16).toString(16);
  }
  return out;
}

/** The shape a signing secret arrives in, prefixed the way every credential we mint is. */
function newSecret(): string {
  return `whsec_${randomHex(24)}`;
}

function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function pick<T>(next: () => number, values: readonly T[]): T {
  return values[Math.floor(next() * values.length)] ?? (values[0] as T);
}

const ACME_IDS = ["whk_a1b2c3d4e5f60718", "whk_9f8e7d6c5b4a3021", "whk_1122334455667788"];

function acmeEndpoints(): WebhookEndpoint[] {
  return [
    {
      id: "whk_a1b2c3d4e5f60718",
      url: "https://api.acme.com/hooks/idenzy",
      description: "Provisioning and account sync",
      enabled: true,
      disabled: null,
      events: [...ALL_EVENTS],
      allEvents: true,
      createdAt: "2026-06-11T09:20:00.000Z",
      rolledAt: "2026-08-30T14:02:00.000Z",
      previousSecretUntil: null,
    },
    {
      id: "whk_9f8e7d6c5b4a3021",
      url: "https://ops.acme.com/alerts/idenzy-security",
      description: "Pages the on-call for a token reuse",
      enabled: true,
      disabled: null,
      events: ["security.refresh_token_reused", "security.staff_access_granted", "mfa.removed"],
      allEvents: false,
      createdAt: "2026-07-02T11:45:00.000Z",
      rolledAt: null,
      previousSecretUntil: null,
    },
    {
      id: "whk_1122334455667788",
      url: "https://acme-staging.example.dev/hooks/idenzy",
      description: "Staging, paused while it is redeployed",
      enabled: false,
      disabled: { kind: "paused", at: "2026-09-03T08:15:00.000Z", by: "Mei Tanaka" },
      events: ["user.created", "user.updated", "session.created"],
      allEvents: false,
      createdAt: "2026-08-19T16:10:00.000Z",
      rolledAt: null,
      previousSecretUntil: null,
    },
  ];
}

const EVENTS_SEEN = ["user.created", "user.updated", "session.created", "session.revoked"];

const FAILURES = [
  {
    status: 500,
    error: null,
    response: "<html><head><title>500 Internal Server Error</title></head></html>",
  },
  { status: 502, error: null, response: "<html><body><h1>502 Bad Gateway</h1></body></html>" },
  { status: 404, error: null, response: "Cannot POST /hooks/idenzy" },
  { status: null, error: "Timed out after 10s", response: "" },
  { status: null, error: "Connection refused", response: "" },
];

function outcomeFrom(roll: number): DeliveryOutcome {
  if (roll > 0.9) return "failed";
  return roll > 0.8 ? "pending" : "delivered";
}

function triesFor(outcome: DeliveryOutcome, next: () => number): number {
  if (outcome === "failed") return MAX_ATTEMPTS;
  return outcome === "pending" ? 2 + Math.floor(next() * 3) : 1;
}

/** Every try of one delivery, the gaps from the schedule, only the last of a delivered one landing. */
function attemptsFor(
  next: () => number,
  outcome: DeliveryOutcome,
  created: number,
  now: number,
): DeliveryAttempt[] {
  const tries = triesFor(outcome, next);
  const failure = pick(next, FAILURES);
  let at = created;
  return Array.from({ length: tries }, (_, index): DeliveryAttempt => {
    if (index > 0) at += (nextRetrySeconds(index) ?? 0) * 1000;
    const landed = outcome === "delivered" && index === tries - 1;
    return {
      n: index + 1,
      at: new Date(Math.min(at, now)).toISOString(),
      status: landed ? 200 : failure.status,
      error: landed ? null : failure.error,
      durationMs: Math.round(landed ? 80 + next() * 300 : 400 + next() * 9000),
      response: landed ? '{"received":true}' : failure.response,
    };
  });
}

/** A week of deliveries, only loaded while `WEBHOOK_DELIVERY.running` is true. */
function sampleDeliveries(endpointIds: readonly string[]): WebhookDelivery[] {
  const next = seeded(37);
  const now = Date.now();
  return Array.from({ length: 36 }, (): WebhookDelivery => {
    const created = now - Math.round(next() * 6 * 86_400_000) - 60_000;
    const outcome = outcomeFrom(next());
    const attempts = attemptsFor(next, outcome, created, now);
    const tries = attempts.length;
    const id = `dlv_${Math.floor(next() * 0xffffffffffff)
      .toString(16)
      .padStart(12, "0")}`;
    const event = pick(next, EVENTS_SEEN);
    const delay = nextRetrySeconds(tries);
    return {
      id,
      endpointId: next() < 0.7 ? (endpointIds[0] ?? "") : pick(next, endpointIds.slice(1)),
      event,
      outcome,
      attempts,
      nextRetryAt:
        outcome === "pending" && delay !== null ? new Date(now + delay * 1000).toISOString() : null,
      payload: samplePayload(event, id, new Date(created).toISOString()).replace(
        '"id": "usr_2f9c41e0b7d84a63"',
        '"id": "usr_2f9c41e0b7d84a63",\n    "email": "ana@acme.com"',
      ),
      createdAt: new Date(created).toISOString(),
      test: false,
    };
  });
}
