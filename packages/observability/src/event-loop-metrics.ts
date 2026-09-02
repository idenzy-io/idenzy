import { type IntervalHistogram, monitorEventLoopDelay } from "node:perf_hooks";

export interface EventLoopSample {
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
}

/**
 * Event-loop lag as a first-class SLO (PROJECT.md 6.3): p99 under 20 ms, alert at 50 ms.
 *
 * A Node service that violates this is failing even while returning 200s, which is why
 * it is monitored like an error rate rather than a nice-to-have.
 */
export class EventLoopMonitor {
  private readonly histogram: IntervalHistogram;

  constructor(resolutionMs = 10) {
    this.histogram = monitorEventLoopDelay({ resolution: resolutionMs });
  }

  start(): void {
    this.histogram.enable();
  }

  stop(): void {
    this.histogram.disable();
  }

  /** Reads and resets, so each sample covers one interval rather than all time. */
  sample(): EventLoopSample {
    const toMs = (nanoseconds: number): number => Math.round(nanoseconds / 10_000) / 100;
    const result = {
      p50Ms: toMs(this.histogram.percentile(50)),
      p99Ms: toMs(this.histogram.percentile(99)),
      maxMs: toMs(this.histogram.max),
    };
    this.histogram.reset();
    return result;
  }
}
