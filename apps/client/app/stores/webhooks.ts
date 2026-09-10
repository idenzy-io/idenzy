/**
 * Each project's webhook endpoints and what happened when we called them.
 *
 * The signing secret goes one way. `webhooks.secret_hash` is a digest, so the value
 * exists on the wire once, at the moment it is made or rolled, and the store hands it to
 * the caller then and never keeps it. A placeholder that held the secret would be a
 * placeholder teaching the panel a habit the real client cannot have.
 *
 * A placeholder until the management client exists, like every store here.
 */

import {
  ALL_EVENTS,
  isSuccessStatus,
  type WebhookDelivery,
  type WebhookEndpoint,
} from "~/utils/webhooks";

const PLACEHOLDER_LATENCY = 700;
const SAVE_LATENCY = 600;

/** How long a rolled secret's predecessor keeps being accepted. */
const OVERLAP_HOURS = 24;

export const useWebhooksStore = defineStore("webhooks", () => {
  const endpoints = ref<Record<string, WebhookEndpoint[]>>({});
  const deliveries = ref<Record<string, WebhookDelivery[]>>({});
  const loading = ref(true);
  const lastSaved = ref<Record<string, string>>({});

  setTimeout(() => {
    endpoints.value = { prj_personal: [], prj_acme: acmeEndpoints() };
    deliveries.value = { prj_personal: [], prj_acme: acmeDeliveries() };
    loading.value = false;
  }, PLACEHOLDER_LATENCY);

  function forProject(projectId: string): WebhookEndpoint[] {
    return endpoints.value[projectId] ?? [];
  }

  function deliveriesFor(projectId: string): WebhookDelivery[] {
    return deliveries.value[projectId] ?? [];
  }

  function stamp(projectId: string) {
    lastSaved.value = { ...lastSaved.value, [projectId]: new Date().toISOString() };
  }

  function write(projectId: string, next: WebhookEndpoint[]) {
    endpoints.value = { ...endpoints.value, [projectId]: next };
    stamp(projectId);
  }

  /**
   * Creates the endpoint and hands back its signing secret, which is the only moment
   * anybody can have it. Disabled endpoints are not created: an endpoint made and left
   * off is one somebody meant to finish.
   */
  async function add(
    projectId: string,
    draft: Omit<WebhookEndpoint, "id" | "createdAt" | "rolledAt" | "previousSecretUntil">,
  ): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const endpoint: WebhookEndpoint = {
      ...draft,
      id: `whk_${randomHex(16)}`,
      createdAt: new Date().toISOString(),
      rolledAt: null,
      previousSecretUntil: null,
    };
    write(projectId, [...forProject(projectId), endpoint]);
    return { endpoint, secret: newSecret() };
  }

  async function patch(
    projectId: string,
    id: string,
    change: Partial<WebhookEndpoint>,
  ): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(
      projectId,
      forProject(projectId).map((endpoint) =>
        endpoint.id === id ? { ...endpoint, ...change } : endpoint,
      ),
    );
  }

  /**
   * Replaces the secret and keeps the old one working for a day, so a customer can deploy
   * the new one without dropping the deliveries that arrive in between. A roll that
   * invalidated the old secret at once would be an outage the panel had caused.
   */
  async function rollSecret(projectId: string, id: string): Promise<string> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const until = new Date(Date.now() + OVERLAP_HOURS * 3600_000).toISOString();
    write(
      projectId,
      forProject(projectId).map((endpoint) =>
        endpoint.id === id
          ? { ...endpoint, rolledAt: new Date().toISOString(), previousSecretUntil: until }
          : endpoint,
      ),
    );
    return newSecret();
  }

  async function remove(projectId: string, id: string): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    write(
      projectId,
      forProject(projectId).filter((endpoint) => endpoint.id !== id),
    );
    deliveries.value = {
      ...deliveries.value,
      [projectId]: deliveriesFor(projectId).filter((entry) => entry.endpointId !== id),
    };
  }

  /** Sends the same event again, as a fresh attempt with its own delivery id. */
  async function redeliver(projectId: string, delivery: WebhookDelivery): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, SAVE_LATENCY));
    const retried: WebhookDelivery = {
      ...delivery,
      id: `dlv_${randomHex(12)}`,
      outcome: "delivered",
      status: 200,
      error: null,
      attempt: 1,
      durationMs: 120 + Math.floor(Math.random() * 300),
      at: new Date().toISOString(),
    };
    deliveries.value = {
      ...deliveries.value,
      [projectId]: [retried, ...deliveriesFor(projectId)],
    };
    stamp(projectId);
  }

  function lastSavedAt(projectId: string): string | null {
    return lastSaved.value[projectId] ?? null;
  }

  return {
    endpoints,
    deliveries,
    loading,
    forProject,
    deliveriesFor,
    add,
    patch,
    rollSecret,
    remove,
    redeliver,
    lastSavedAt,
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

/** The shape a signing secret arrives in, prefixed the way every key we mint is. */
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

function acmeEndpoints(): WebhookEndpoint[] {
  return [
    {
      id: "whk_a1b2c3d4e5f60718",
      url: "https://api.acme.com/hooks/idenzy",
      description: "Provisioning and account sync",
      enabled: true,
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
      events: ["security.refresh_token_reused", "security.staff_access_granted", "mfa.removed"],
      allEvents: false,
      createdAt: "2026-07-02T11:45:00.000Z",
      rolledAt: null,
      previousSecretUntil: null,
    },
    {
      id: "whk_1122334455667788",
      url: "https://acme-staging.example.dev/hooks/idenzy",
      description: "Staging, switched off after a redeploy",
      enabled: false,
      events: ["user.created", "user.updated", "session.created"],
      allEvents: false,
      createdAt: "2026-08-19T16:10:00.000Z",
      rolledAt: null,
      previousSecretUntil: null,
    },
  ];
}

const EVENTS_SEEN = [
  "user.created",
  "user.updated",
  "session.created",
  "session.revoked",
  "email.bounced",
  "mfa.enrolled",
  "security.refresh_token_reused",
];

const FAILURES = [
  { status: 500, error: null },
  { status: 502, error: null },
  { status: 404, error: null },
  { status: null, error: "Timed out after 10s" },
  { status: null, error: "Connection refused" },
];

const ENDPOINT_IDS = ["whk_a1b2c3d4e5f60718", "whk_9f8e7d6c5b4a3021", "whk_1122334455667788"];

/** One attempt. Most land; the ones that do not are split between a retry and a give-up. */
function deliveryFrom(next: () => number, at: number): WebhookDelivery {
  const roll = next();
  const failed = roll > 0.86;
  const failure = pick(next, FAILURES);
  const status = failed ? failure.status : 200;

  return {
    id: `dlv_${randomHex(12)}`,
    endpointId: next() < 0.7 ? (ENDPOINT_IDS[0] ?? "") : pick(next, ENDPOINT_IDS.slice(1)),
    event: pick(next, EVENTS_SEEN),
    outcome: failed ? (roll > 0.94 ? "failed" : "pending") : "delivered",
    status,
    error: failed ? failure.error : null,
    attempt: failed ? 1 + Math.floor(next() * 3) : 1,
    durationMs: Math.round(60 + next() * (isSuccessStatus(status) ? 340 : 9000)),
    at: new Date(at).toISOString(),
  };
}

/** Two days of attempts across the three endpoints, newest first. */
function acmeDeliveries(): WebhookDelivery[] {
  const next = seeded(37);
  const out: WebhookDelivery[] = [];
  let at = Date.now() - 2 * 24 * 3600_000;

  for (let index = 0; index < 60; index += 1) {
    at += Math.round(next() * 55 * 60_000) + 60_000;
    out.push(deliveryFrom(next, Math.min(at, Date.now() - 30_000)));
  }
  return out.reverse();
}
