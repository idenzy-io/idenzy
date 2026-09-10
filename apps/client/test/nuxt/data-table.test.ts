import { describe, expect, it } from "vitest";
import {
  arrangeColumns,
  type DataTableColumn,
  defaultColumnState,
  isDefaultColumnState,
  moveColumn,
  orderColumns,
  orderOf,
  reconcileColumnState,
  toggleHidden,
} from "../../app/utils/data-table";

const COLUMNS: readonly DataTableColumn<object>[] = [
  { key: "user", title: "User", fixed: true },
  { key: "id", title: "ID" },
  { key: "status", title: "Status" },
  { key: "created", title: "Created" },
  { key: "updated", title: "Updated", hidden: true },
];

const keys = (columns: readonly DataTableColumn<object>[]) => columns.map((column) => column.key);

describe("defaultColumnState", () => {
  it("lists every key in order and hides what asks to be hidden", () => {
    expect(defaultColumnState(COLUMNS)).toEqual({
      order: ["user", "id", "status", "created", "updated"],
      hidden: ["updated"],
    });
  });
});

describe("reconcileColumnState", () => {
  it("returns the default for nothing stored", () => {
    expect(reconcileColumnState(COLUMNS, null)).toEqual(defaultColumnState(COLUMNS));
    expect(reconcileColumnState(COLUMNS, undefined)).toEqual(defaultColumnState(COLUMNS));
  });

  it("drops keys the columns no longer have", () => {
    const state = reconcileColumnState(COLUMNS, {
      order: ["user", "gone", "created", "id", "status", "updated"],
      hidden: ["gone", "updated"],
    });
    expect(state).toEqual({
      order: ["user", "created", "id", "status", "updated"],
      hidden: ["updated"],
    });
  });

  it("slots a new column in after its default neighbour", () => {
    const state = reconcileColumnState(COLUMNS, {
      order: ["user", "created", "id", "updated"],
      hidden: [],
    });
    // `status` follows `id` by default, so it lands after `id` wherever `id` went.
    expect(state.order).toEqual(["user", "created", "id", "status", "updated"]);
  });

  it("never hides a fixed column and keeps it first", () => {
    const state = reconcileColumnState(COLUMNS, {
      order: ["id", "user", "status", "created", "updated"],
      hidden: ["user", "id"],
    });
    expect(state.order[0]).toBe("user");
    expect(state.hidden).toEqual(["id"]);
  });
});

describe("moveColumn", () => {
  const order = ["user", "id", "status", "created"];

  it("moves a key before another", () => {
    expect(moveColumn(order, "created", "id")).toEqual(["user", "created", "id", "status"]);
  });

  it("moves a key to the end for null", () => {
    expect(moveColumn(order, "id", null)).toEqual(["user", "status", "created", "id"]);
  });

  it("changes nothing for a move onto itself or an unknown key", () => {
    expect(moveColumn(order, "id", "id")).toEqual(order);
    expect(moveColumn(order, "nope", "id")).toEqual(order);
    expect(moveColumn(order, "id", "nope")).toEqual(order);
  });
});

describe("arrangeColumns", () => {
  it("draws the visible columns in the stored order with fixed ones first", () => {
    const arranged = arrangeColumns(COLUMNS, {
      order: ["created", "user", "id", "status", "updated"],
      hidden: ["id"],
    });
    expect(keys(arranged)).toEqual(["user", "created", "status", "updated"]);
  });

  it("lists hidden columns too when asked for the whole order", () => {
    const state = { order: ["user", "status", "id", "created", "updated"], hidden: ["id"] };
    expect(keys(orderColumns(COLUMNS, state))).toEqual([
      "user",
      "status",
      "id",
      "created",
      "updated",
    ]);
  });
});

describe("toggleHidden and isDefaultColumnState", () => {
  it("flips a key in and out of hidden without touching the order", () => {
    const start = defaultColumnState(COLUMNS);
    const hidden = toggleHidden(start, "id");
    expect(hidden.hidden).toEqual(["updated", "id"]);
    expect(hidden.order).toBe(start.order);
    expect(toggleHidden(hidden, "id").hidden).toEqual(["updated"]);
  });

  it("reads the default whatever order hidden keys are listed in", () => {
    const state = { ...defaultColumnState(COLUMNS), hidden: ["updated"] };
    expect(isDefaultColumnState(COLUMNS, state)).toBe(true);
    expect(isDefaultColumnState(COLUMNS, toggleHidden(state, "id"))).toBe(false);
    expect(
      isDefaultColumnState(COLUMNS, { ...state, order: moveColumn(state.order, "id", null) }),
    ).toBe(false);
  });
});

describe("orderOf", () => {
  it("reads Vuetify's boolean shorthand as ascending", () => {
    expect(orderOf([{ key: "id", order: true }], "id")).toBe("asc");
    expect(orderOf([{ key: "id", order: "desc" }], "id")).toBe("desc");
    expect(orderOf([{ key: "id" }], "id")).toBe("asc");
    expect(orderOf([{ key: "id" }], "status")).toBeNull();
  });
});
