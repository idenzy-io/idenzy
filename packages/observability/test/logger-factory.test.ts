import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger-factory.js";

/**
 * The shape of a line, which is the whole contract with whatever collects it.
 *
 * Nothing here reads a log viewer, so what can be asserted is the JSON: the key a message lands
 * under, the severity a level becomes, and whether a service survives a line that names a
 * subsystem. Each of those is a way the line stops being filterable where it is actually read.
 */

function linesFrom(
  write: (log: ReturnType<typeof createLogger>) => void,
): Record<string, unknown>[] {
  const written: string[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _encoding, done) {
      written.push(chunk.toString());
      done();
    },
  });
  write(createLogger({ level: "debug", service: "workers", destination: sink }));
  return written
    .join("")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("a log line", () => {
  it("names the service that wrote it", () => {
    const [line] = linesFrom((log) => log.info("started"));
    expect(line?.["service"]).toBe("workers");
  });

  /**
   * The collision this field exists for.
   *
   * A line says which part of a service it came from, and a per-line field overrides a base one —
   * so while the service name was bound as `component`, it vanished from every line that named a
   * subsystem, which is every line worth reading.
   */
  it("keeps the service when a line names a component of its own", () => {
    const [line] = linesFrom((log) => log.info("batch inserted", { component: "analytics" }));
    expect(line?.["service"]).toBe("workers");
    expect(line?.["component"]).toBe("analytics");
  });

  /** `warn` and `fatal` are not severities Google recognises; both would land as DEFAULT. */
  it("uses Cloud Logging's severity names rather than pino's levels", () => {
    const lines = linesFrom((log) => {
      log.debug("d");
      log.info("i");
      log.warn("w");
      log.error("e");
    });
    expect(lines.map((line) => line["severity"])).toEqual(["DEBUG", "INFO", "WARNING", "ERROR"]);
    expect(lines[0]?.["level"]).toBeUndefined();
  });

  /** `message`, because that is the key promoted out of the payload into what a human reads. */
  it("puts the message where a log viewer looks for it", () => {
    const [line] = linesFrom((log) => log.info("batch inserted"));
    expect(line?.["message"]).toBe("batch inserted");
    expect(line?.["msg"]).toBeUndefined();
  });

  it("still drops a field the allowlist does not carry", () => {
    const [line] = linesFrom((log) => log.info("started", { ip: "203.0.113.1" }));
    expect(line?.["ip"]).toBeUndefined();
    expect(line?.["droppedFields"]).toBe(1);
  });
});
