import { Worker } from "node:worker_threads";
import { InternalError } from "@idenzy/core/errors";

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

/**
 * Bounded worker pool for CPU-bound work (PROJECT.md 9.6).
 *
 * Argon2 verification takes tens of milliseconds. Run inline, a burst of sign-ins
 * serializes the event loop and every unrelated request queues behind it, which shows
 * up as a latency incident rather than an obvious CPU one. This is why a synchronous
 * crypto call on the request path is a review rejection.
 *
 * The queue is bounded: past the limit, requests are rejected rather than allowed to
 * grow without end, because an unbounded queue converts CPU exhaustion into memory
 * exhaustion.
 */
export class WorkerPool {
  private readonly workers: Worker[] = [];
  private readonly idle: Worker[] = [];
  private readonly queue: { task: unknown; pending: Pending }[] = [];
  private readonly inFlight = new Map<Worker, Pending>();

  constructor(
    private readonly scriptUrl: URL,
    private readonly size: number,
    private readonly maxQueueDepth = 1000,
  ) {}

  start(): void {
    for (let i = 0; i < this.size; i += 1) {
      const worker = new Worker(this.scriptUrl);
      worker.on("message", (result: unknown) => this.settle(worker, result, null));
      worker.on("error", (error: Error) => this.settle(worker, null, error));
      this.workers.push(worker);
      this.idle.push(worker);
    }
  }

  run<TTask, TResult>(task: TTask): Promise<TResult> {
    if (this.queue.length >= this.maxQueueDepth) {
      return Promise.reject(
        new InternalError({
          detail: { reason: "worker_pool_saturated", depth: this.queue.length },
        }),
      );
    }
    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({ task, pending: { resolve: resolve as (v: unknown) => void, reject } });
      this.pump();
    });
  }

  async stop(): Promise<void> {
    await Promise.all(this.workers.map(async (worker) => worker.terminate()));
    this.workers.length = 0;
    this.idle.length = 0;
  }

  private pump(): void {
    while (this.idle.length > 0 && this.queue.length > 0) {
      const worker = this.idle.pop();
      const next = this.queue.shift();
      if (worker === undefined || next === undefined) return;
      this.inFlight.set(worker, next.pending);
      worker.postMessage(next.task);
    }
  }

  private settle(worker: Worker, result: unknown, error: Error | null): void {
    const pending = this.inFlight.get(worker);
    this.inFlight.delete(worker);
    this.idle.push(worker);
    if (pending !== undefined) {
      if (error === null) pending.resolve(result);
      else pending.reject(error);
    }
    this.pump();
  }
}
