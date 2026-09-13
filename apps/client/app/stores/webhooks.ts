/**
 * Each project's webhook endpoints and their deliveries, read and written through the management
 * API (ADR-0012).
 *
 * Three reads rather than one, because they answer different questions and cost different amounts.
 * The endpoints are a small list and load with the screen. The counters are a row per endpoint per
 * day and load with it too, which is what the figures strip is made of. The deliveries are the
 * expensive one — the latest fifty for one endpoint — so they load for the endpoint somebody
 * selected and not for all of them at once.
 *
 * A test event and a replay both write a delivery and answer with it, queued: the worker sends it a
 * moment later, like any other. So each puts the row it was given at the top of the list rather than
 * re-reading — the screen shows the delivery it just asked for, pending, and the next read of that
 * endpoint's deliveries shows what came of it.
 */

import { InternalError } from "@idenzy/core/errors";
import type {
  CreatedWebhook,
  QueuedWebhookDelivery,
  RotatedWebhookSecret,
  WebhookDeliveryList,
  WebhookDelivery as WebhookDeliveryPayload,
  WebhookEndpointList,
  WebhookEndpoint as WebhookEndpointPayload,
  WebhookStats,
} from "@idenzy/protocol/schemas/management";
import { managementMessage } from "~/utils/sign-in-errors";
import type { DayStats, DeliveryAttempt, WebhookDelivery, WebhookEndpoint } from "~/utils/webhooks";

/** What the add dialog hands over. The secret is ours to mint, not theirs to choose. */
export interface EndpointDraft {
  url: string;
  description: string;
  events: string[];
  allEvents: boolean;
  enabled: boolean;
}

export const useWebhooksStore = defineStore("webhooks", () => {
  const projects = useProjectStore();

  const byProject = ref<Record<string, WebhookEndpoint[]>>({});
  /** Deliveries by project, filled per endpoint as each is selected. */
  const deliveries = ref<Record<string, WebhookDelivery[]>>({});
  /** Which endpoints' deliveries have been read, so a second visit does not re-read them. */
  const loadedFor = ref<Record<string, string[]>>({});
  const stats = ref<Record<string, DayStats[]>>({});
  const loading = ref(false);
  /** Whether the selected endpoint's deliveries are on their way. */
  const loadingDeliveries = ref(false);
  /** Why the list could not be read, for a screen that must not claim it knows. */
  const refusal = ref<string | null>(null);

  function basePath(projectId: string): string | null {
    const org = projects.orgOf(projectId);
    return org === null ? null : `/v1/orgs/${org.id}/projects/${projectId}/webhooks`;
  }

  /**
   * The same route for a write, or a throw.
   *
   * Thrown rather than returned quietly: every caller is a dialog, and a silent no-op would close
   * one as though an endpoint had been saved.
   */
  function writePath(projectId: string): string {
    const path = basePath(projectId);
    if (path === null)
      throw new InternalError({ detail: { reason: "the project's organisation is not loaded" } });
    return path;
  }

  /** The endpoints and the counters, which are what the screen needs before it can draw. */
  async function load(projectId: string): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    loading.value = true;
    refusal.value = null;
    try {
      const api = useManagementApi();
      const [endpoints, counters] = await Promise.all([
        api(path).get().json<WebhookEndpointList>(),
        api(`${path}/stats`).get().json<WebhookStats>(),
      ]);
      if (endpoints.error.value !== null) throw endpoints.error.value;
      if (counters.error.value !== null) throw counters.error.value;

      byProject.value = {
        ...byProject.value,
        [projectId]: (endpoints.data.value?.endpoints ?? []).map(presentEndpoint),
      };
      stats.value = {
        ...stats.value,
        [projectId]: (counters.data.value?.days ?? []).map((day) => ({
          endpointId: day.endpointId,
          day: day.day,
          delivered: day.delivered,
          failed: day.failed,
          attempts: day.attempts,
        })),
      };
    } catch (cause: unknown) {
      refusal.value = managementMessage(cause);
    } finally {
      loading.value = false;
    }
  }

  function forProject(projectId: string): WebhookEndpoint[] {
    return byProject.value[projectId] ?? [];
  }

  function statsFor(projectId: string): DayStats[] {
    return stats.value[projectId] ?? [];
  }

  /**
   * Every delivery this store has read for the project.
   *
   * Per endpoint underneath, joined here because the screen asks its questions per endpoint anyway
   * and a caller that had to know which endpoints were loaded would be a caller that had to load
   * them. What it is not is every delivery a project ever made: the window behind it is three days
   * and this is the latest fifty of what is in it (ADR-0012).
   */
  function deliveriesFor(projectId: string): WebhookDelivery[] {
    return deliveries.value[projectId] ?? [];
  }

  /**
   * Reads one endpoint's deliveries, unless they are already held.
   *
   * `force` is for after a write that changes them — a retry, when it exists — where the held copy
   * is the thing being replaced rather than a saving.
   */
  async function loadDeliveries(
    projectId: string,
    endpointId: string,
    force = false,
  ): Promise<void> {
    const path = basePath(projectId);
    if (path === null) return;
    const held = loadedFor.value[projectId] ?? [];
    if (!force && held.includes(endpointId)) return;

    loadingDeliveries.value = true;
    try {
      const api = useManagementApi();
      const { data, error } = await api(`${path}/${endpointId}/deliveries`)
        .get()
        .json<WebhookDeliveryList>();
      if (error.value !== null) throw error.value;

      const fresh = (data.value?.deliveries ?? []).map(presentDelivery);
      const others = deliveriesFor(projectId).filter((entry) => entry.endpointId !== endpointId);
      deliveries.value = { ...deliveries.value, [projectId]: [...others, ...fresh] };
      loadedFor.value = {
        ...loadedFor.value,
        [projectId]: held.includes(endpointId) ? held : [...held, endpointId],
      };
    } catch (cause: unknown) {
      // The endpoint list is the screen; its deliveries are a panel on it. A refusal here says so
      // in the same place a failed read of the list would, rather than emptying the screen.
      refusal.value = managementMessage(cause);
    } finally {
      loadingDeliveries.value = false;
    }
  }

  /** Creates an endpoint and hands back the secret, the only moment anybody has it. */
  async function add(
    projectId: string,
    draft: EndpointDraft,
  ): Promise<{ endpoint: WebhookEndpoint; secret: string }> {
    const api = useManagementApi();
    const { data, error } = await api(writePath(projectId)).post(draft).json<CreatedWebhook>();
    if (error.value !== null) throw error.value;
    const created = data.value;
    if (created === null)
      throw new InternalError({ detail: { reason: "the server returned no endpoint" } });

    const endpoint = presentEndpoint(created.endpoint);
    byProject.value = { ...byProject.value, [projectId]: [...forProject(projectId), endpoint] };
    // The secret travels to the caller and is never written into the store, for the same reason the
    // keys store does not keep one: a ref holding it is a ref something could log.
    return { endpoint, secret: created.secret };
  }

  async function update(
    projectId: string,
    id: string,
    change: Partial<Pick<WebhookEndpoint, "url" | "description" | "events" | "allEvents">>,
  ): Promise<void> {
    const api = useManagementApi();
    const { data, error } = await api(`${writePath(projectId)}/${id}`)
      .patch(change)
      .json<WebhookEndpointPayload>();
    if (error.value !== null) throw error.value;
    if (data.value !== null) replace(projectId, presentEndpoint(data.value));
  }

  /** Off by a person's hand, which the row names. Nothing queues while it is paused. */
  function pause(projectId: string, id: string): Promise<void> {
    return act(projectId, id, "pause");
  }

  /**
   * On again, which also clears the run of failures.
   *
   * What happened while it was off is not replayed, and nothing was queued for it: the fan-out
   * writes a delivery for enabled endpoints only.
   */
  function resume(projectId: string, id: string): Promise<void> {
    return act(projectId, id, "resume");
  }

  /**
   * Replaces the secret. The previous one keeps signing beside it until the deadline, so a receiver
   * can deploy the new one without a delivery in between failing verification.
   */
  async function rotateSecret(
    projectId: string,
    id: string,
  ): Promise<{ secret: string; until: string }> {
    const api = useManagementApi();
    const { data, error } = await api(`${writePath(projectId)}/${id}/rotate-secret`)
      .post({})
      .json<RotatedWebhookSecret>();
    if (error.value !== null) throw error.value;
    const rotated = data.value;
    if (rotated === null)
      throw new InternalError({ detail: { reason: "the server returned no secret" } });
    replace(projectId, presentEndpoint(rotated.endpoint));
    return { secret: rotated.secret, until: rotated.previousSecretUntil };
  }

  async function remove(projectId: string, id: string): Promise<void> {
    const api = useManagementApi();
    // Deliberately not `.json()`: success is 204 with no body, and asking for JSON reads an empty
    // body as a parse failure — reporting a removal that happened as one that did not.
    const { error } = await api(`${writePath(projectId)}/${id}`).delete();
    if (error.value !== null) throw error.value;
    byProject.value = {
      ...byProject.value,
      [projectId]: forProject(projectId).filter((entry) => entry.id !== id),
    };
    // Its deliveries went with it in the database, and they go here too rather than lingering as
    // rows pointing at an endpoint the screen no longer lists.
    deliveries.value = {
      ...deliveries.value,
      [projectId]: deliveriesFor(projectId).filter((entry) => entry.endpointId !== id),
    };
  }

  /**
   * Asks for a test event and puts it at the top of the list.
   *
   * The delivery comes back queued rather than delivered, which is what 202 means: sending is the
   * worker's and happens after the answer. Holding the row it gave us is how the screen shows a
   * pending test immediately instead of an empty table until the next read.
   */
  async function sendTest(projectId: string, endpointId: string): Promise<WebhookDelivery> {
    const api = useManagementApi();
    const { data, error } = await api(`${writePath(projectId)}/${endpointId}/test`)
      .post({})
      .json<QueuedWebhookDelivery>();
    if (error.value !== null) throw error.value;
    const queued = data.value;
    if (queued === null)
      throw new InternalError({ detail: { reason: "the server returned no delivery" } });
    const delivery = presentDelivery(queued.delivery);
    prepend(projectId, delivery);
    return delivery;
  }

  /**
   * Sends a finished delivery again, with the same id.
   *
   * The row that comes back replaces the one on screen rather than joining it: the same delivery id
   * means the same delivery, now pending again with the attempts it already made.
   */
  async function replay(
    projectId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<WebhookDelivery> {
    const api = useManagementApi();
    const { data, error } = await api(
      `${writePath(projectId)}/${endpointId}/deliveries/${deliveryId}/replay`,
    )
      .post({})
      .json<QueuedWebhookDelivery>();
    if (error.value !== null) throw error.value;
    const queued = data.value;
    if (queued === null)
      throw new InternalError({ detail: { reason: "the server returned no delivery" } });
    const delivery = presentDelivery(queued.delivery);
    prepend(projectId, delivery);
    return delivery;
  }

  /** Newest first, and one row per delivery id: a replay replaces rather than duplicates. */
  function prepend(projectId: string, delivery: WebhookDelivery) {
    const rest = deliveriesFor(projectId).filter((entry) => entry.id !== delivery.id);
    deliveries.value = { ...deliveries.value, [projectId]: [delivery, ...rest] };
  }

  async function act(projectId: string, id: string, action: "pause" | "resume"): Promise<void> {
    const api = useManagementApi();
    const { data, error } = await api(`${writePath(projectId)}/${id}/${action}`)
      .post({})
      .json<WebhookEndpointPayload>();
    if (error.value !== null) throw error.value;
    if (data.value !== null) replace(projectId, presentEndpoint(data.value));
  }

  function replace(projectId: string, endpoint: WebhookEndpoint) {
    byProject.value = {
      ...byProject.value,
      [projectId]: forProject(projectId).map((entry) =>
        entry.id === endpoint.id ? endpoint : entry,
      ),
    };
  }

  return {
    loading,
    loadingDeliveries,
    refusal,
    load,
    loadDeliveries,
    forProject,
    statsFor,
    deliveriesFor,
    add,
    update,
    pause,
    resume,
    rotateSecret,
    remove,
    sendTest,
    replay,
  };
});

/** An endpoint as the API answers it. The shapes agree; the mapper is where that is checked. */
function presentEndpoint(payload: WebhookEndpointPayload): WebhookEndpoint {
  return {
    id: payload.id,
    url: payload.url,
    description: payload.description,
    enabled: payload.enabled,
    disabled:
      payload.disabled === null
        ? null
        : {
            kind: payload.disabled.kind,
            at: payload.disabled.at,
            byMemberId: payload.disabled.byMemberId,
          },
    events: [...payload.events],
    allEvents: payload.allEvents,
    createdAt: payload.createdAt,
    rolledAt: payload.rolledAt,
    previousSecretUntil: payload.previousSecretUntil,
  };
}

function presentDelivery(payload: WebhookDeliveryPayload): WebhookDelivery {
  return {
    id: payload.id,
    endpointId: payload.endpointId,
    event: payload.event,
    outcome: payload.outcome,
    attempts: payload.attempts.map(
      (attempt): DeliveryAttempt => ({
        n: attempt.n,
        at: attempt.at,
        status: attempt.status,
        error: attempt.error,
        durationMs: attempt.durationMs,
        response: attempt.response,
      }),
    ),
    nextRetryAt: payload.nextRetryAt,
    // The body as sent, and null once the delivery is finished: it is cleared on a terminal outcome
    // rather than kept for a month, which is why a replay of a finished delivery is refused.
    payload: payload.payload === null ? "" : JSON.stringify(payload.payload, null, 2),
    createdAt: payload.createdAt,
    test: payload.test,
  };
}
