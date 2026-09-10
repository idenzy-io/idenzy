import type { DataTableSort } from "~/utils/data-table";

/**
 * The users list as the reader left it, held for the visit rather than for the URL.
 *
 * Split in two on purpose. The status and the filter facets are in the query string, so a
 * narrowed list is a link somebody can send and the totals over the table can point at the
 * rows they count. The search term, the sort and the page are here instead: a search term
 * is whichever person is being investigated, and an address in a URL is personal data in a
 * browser history, a proxy log and a chat message (notes/shared-experience.md).
 *
 * `query` is what the list last had in its URL, so one user's page can offer a way back to
 * the list rather than to an unnarrowed one.
 */
export interface UsersListState {
  search: Ref<string>;
  sort: Ref<DataTableSort[]>;
  page: Ref<number>;
  query: Ref<Record<string, string>>;
}

export function useUsersList(): UsersListState {
  return {
    search: useState("users.search", () => ""),
    sort: useState<DataTableSort[]>("users.sort", () => [{ key: "createdAt", order: "desc" }]),
    page: useState("users.page", () => 1),
    query: useState<Record<string, string>>("users.query", () => ({})),
  };
}
