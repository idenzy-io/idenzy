import type { AuthMethod } from "@idenzy/protocol/enums/auth";

/**
 * One authentication, as the analytics store records it.
 *
 * Public ids are deliberately *not* used here, unlike a webhook payload: nothing downstream hands
 * this to a customer, the row is joined against `users` and `sessions` when somebody explores it,
 * and a `usr_` prefix would have to be stripped to do that. The convention matches the outbox,
 * which is the other internal payload in this codebase.
 */
export interface AuthAnalyticsEvent {
  readonly projectId: string;
  /** The public event name, the same vocabulary a webhook carries. */
  readonly event: string;
  readonly method: AuthMethod | null;
  readonly outcome: "succeeded" | "challenged" | "refused";
  readonly userId: string | null;
  readonly sessionId: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly at: Date;
}

/**
 * Where an authentication goes to be counted later (todo.md 3.2).
 *
 * A port because there are two real implementations and the difference between them is a
 * deployment decision rather than a code one: one queues the event, and one does nothing at all
 * because this deployment has no analytics store configured. That second case is not a degraded
 * mode to be apologised for — nothing on the authentication path reads this store, so a cell
 * without one is a cell that serves sign-ins and draws no charts.
 *
 * **Recording never throws and never blocks anything important.** The implementations own that
 * rather than each call site remembering it: an event that cannot be queued is dropped, because
 * the alternative is a cache hiccup surfacing on somebody's sign-in. That is the same trade
 * `RateLimitStrategy.check` makes and the opposite of the SMS spend cap's, and what decides it in
 * all three is what sits on the other side. Here it is a chart.
 */
export abstract class AnalyticsRecorder {
  abstract record(event: AuthAnalyticsEvent): Promise<void>;
}

/**
 * The recorder for a deployment with no analytics store.
 *
 * Named for what it is rather than hidden behind a nullable dependency, so a service always has
 * one and no call site branches on whether analytics exist. The alternative — an optional
 * collaborator — puts an `if` at every call site and eventually one of them is missing.
 */
export class NullAnalyticsRecorder extends AnalyticsRecorder {
  override record(): Promise<void> {
    return Promise.resolve();
  }
}
