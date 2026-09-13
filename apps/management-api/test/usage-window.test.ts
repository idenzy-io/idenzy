import { ValidationFailedError } from "@idenzy/core/errors";
import { describe, expect, it } from "vitest";
// From `dist`, like every other app test: Vitest transforms with Rolldown, which does not apply
// the decorator semantics NestJS needs.
import { UsageService } from "../dist/usage/usage-service.js";

const MID_MONTH = new Date("2026-09-13T10:00:00Z");

describe("the usage window", () => {
  it("defaults to the calendar month in progress, which is what the bill resets on", () => {
    expect(UsageService.windowOf({}, MID_MONTH)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("ends a February on the 28th or the 29th rather than on a fixed length", () => {
    expect(UsageService.windowOf({}, new Date("2026-02-10T00:00:00Z")).to).toBe("2026-02-28");
    expect(UsageService.windowOf({}, new Date("2028-02-10T00:00:00Z")).to).toBe("2028-02-29");
  });

  it("takes either end on its own and defaults the other", () => {
    expect(UsageService.windowOf({ from: "2026-09-05" }, MID_MONTH).to).toBe("2026-09-30");
    expect(UsageService.windowOf({ to: "2026-09-05" }, MID_MONTH).from).toBe("2026-09-01");
  });

  /**
   * The case the cap exists for, and the reason it is not a field-level rule in the schema: one
   * end given and the other defaulted passes every check a single field can make, and asks for
   * every daily row a project has ever had.
   */
  it("refuses a window longer than a year, including one only half given", () => {
    expect(() => UsageService.windowOf({ from: "2020-01-01" }, MID_MONTH)).toThrow(
      ValidationFailedError,
    );
    expect(() =>
      UsageService.windowOf({ from: "2025-09-01", to: "2026-09-30" }, MID_MONTH),
    ).toThrow(ValidationFailedError);
  });

  /* The hourly twin defaults the same way and caps tighter, because its rows are twenty-four
     times as dense and the question is what happened today rather than this year. */
  it("caps an hourly window at a month and defaults it like the daily one", () => {
    expect(UsageService.hourWindowOf({}, MID_MONTH)).toEqual({
      from: "2026-09-01",
      to: "2026-09-30",
    });
    expect(UsageService.hourWindowOf({ from: "2026-08-01", to: "2026-08-31" }, MID_MONTH)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(() =>
      UsageService.hourWindowOf({ from: "2026-08-01", to: "2026-09-30" }, MID_MONTH),
    ).toThrow(ValidationFailedError);
  });

  it("allows a leap year exactly, because both ends are inclusive", () => {
    expect(UsageService.windowOf({ from: "2027-10-01", to: "2028-09-30" }, MID_MONTH)).toEqual({
      from: "2027-10-01",
      to: "2028-09-30",
    });
  });
});
