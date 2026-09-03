import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageRefreshTokenStore } from "../src/session/local-storage-refresh-token-store.js";
import { MemoryRefreshTokenStore } from "../src/session/refresh-token-store.js";

/** Node has no `localStorage`, so the tests bring one and can also take it away. */
class StubStorage {
  private readonly entries = new Map<string, string>();

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, value);
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  get size(): number {
    return this.entries.size;
  }
}

// The global is typed as `Storage` and this implements the four members these tests touch.
// Assigning a full `Storage` would mean stubbing `clear`, `key` and `length` for nothing.
function install(storage: StubStorage | undefined): void {
  (globalThis as { localStorage?: unknown }).localStorage = storage;
}

afterEach(() => {
  install(undefined);
});

describe("MemoryRefreshTokenStore", () => {
  it("holds a token for this tab and nothing longer", () => {
    const store = new MemoryRefreshTokenStore();
    store.write("refresh.one");

    expect(store.read()).toBe("refresh.one");
    expect(new MemoryRefreshTokenStore().read()).toBeNull();
  });
});

describe("LocalStorageRefreshTokenStore", () => {
  it("keeps two projects on one origin apart", () => {
    install(new StubStorage());
    const first = new LocalStorageRefreshTokenStore("pk_test_one");
    const second = new LocalStorageRefreshTokenStore("pk_test_two");

    first.write("refresh.one");

    expect(second.read()).toBeNull();
    expect(first.read()).toBe("refresh.one");
  });

  /** A token left behind after sign-out is the whole reason not to leave this to customers. */
  it("removes the entry on sign-out rather than blanking it", () => {
    const storage = new StubStorage();
    install(storage);
    const store = new LocalStorageRefreshTokenStore("pk_test_one");
    store.write("refresh.one");

    store.clear();

    expect(store.read()).toBeNull();
    expect(storage.size).toBe(0);
  });

  it("survives a browser that refuses site data, for this tab at least", () => {
    install(undefined);
    const store = new LocalStorageRefreshTokenStore("pk_test_one");

    store.write("refresh.one");
    expect(store.read()).toBe("refresh.one");

    store.clear();
    expect(store.read()).toBeNull();
  });

  it("reads what a previous page load wrote, which is the point of it", () => {
    const storage = new StubStorage();
    install(storage);
    new LocalStorageRefreshTokenStore("pk_test_one").write("refresh.one");

    // A second instance is what the next page load builds.
    expect(new LocalStorageRefreshTokenStore("pk_test_one").read()).toBe("refresh.one");
  });
});
